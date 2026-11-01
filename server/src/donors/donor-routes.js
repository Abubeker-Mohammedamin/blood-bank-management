import { Router } from 'express';
import { requireAuthentication } from '../auth/auth-middleware.js';
import { requirePermission } from '../auth/authorization.js';
import { writeAudit, writeAuditAccess } from '../management/management-utils.js';
import {
  createDonorNumber,
  DonorValidationError,
  donorStatuses,
  publicDonor,
  validateProfileUpdate,
  validateRegistration,
} from './donor-utils.js';

const donorInclude = {
  user: {
    select: {
      id: true,
      displayName: true,
      email: true,
      phoneE164: true,
    },
  },
  _count: { select: { donations: true } },
  donations: {
    orderBy: { collectedAt: 'desc' },
    take: 1,
    select: {
      donationNumber: true,
      collectedAt: true,
      donationStatus: true,
    },
  },
};

const donationHistorySelect = {
  id: true,
  donationNumber: true,
  donationStatus: true,
  collectedAt: true,
  volumeMl: true,
};

function sendBadRequest(response, message) {
  return response.status(400).json({
    error: { code: 'INVALID_DONOR_DATA', message },
  });
}

function parsePage(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= maximum ? parsed : null;
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requireDonorId(request, response, next) {
  if (!isUuid(request.params.id)) {
    return sendBadRequest(response, 'Donor ID must be a valid UUID.');
  }
  return next();
}

function createDonorRouter({ prisma }) {
  const router = Router();
  const authenticate = requireAuthentication(prisma);

  router.get(
    '/',
    authenticate,
    requirePermission(prisma, 'donors', 'view', { scoped: true }),
    async (request, response) => {
      const page = parsePage(request.query.page, 1, 1000000);
      const pageSize = parsePage(request.query.pageSize, 20, 100);
      if (page === null || pageSize === null) {
        return sendBadRequest(response, 'page must be a positive number and pageSize must be between 1 and 100.');
      }

      const search = typeof request.query.search === 'string' ? request.query.search.trim() : '';
      if (search.length > 120) return sendBadRequest(response, 'search must be 120 characters or fewer.');

      const donorStatus = request.query.status;
      const canViewScreening = request.auth.user.roles
        .some((role) => ['ADMIN', 'STAFF'].includes(role));
      if (donorStatus !== undefined && !canViewScreening) {
        return response.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Screening status filters are available only to authorized staff.',
          },
        });
      }
      if (donorStatus !== undefined && !donorStatuses.includes(donorStatus)) {
        return sendBadRequest(response, `status must be one of: ${donorStatuses.join(', ')}.`);
      }

      const filters = [];
      if (request.auth.resourceScope && Object.keys(request.auth.resourceScope).length) {
        filters.push(request.auth.resourceScope);
      }
      if (donorStatus) filters.push({ donorStatus });
      if (search) {
        filters.push({
          OR: [
            { donorNumber: { contains: search, mode: 'insensitive' } },
            { user: { displayName: { contains: search, mode: 'insensitive' } } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
            { user: { phoneE164: { contains: search } } },
          ],
        });
      }

      const where = filters.length ? { AND: filters } : {};
      const [donors, totalItems] = await Promise.all([
        prisma.donor.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          include: donorInclude,
        }),
        prisma.donor.count({ where }),
      ]);
      await Promise.all(donors.map((donor) => writeAuditAccess(prisma, request, {
        action: 'donor.sensitive_information_viewed',
        entityType: 'donor',
        entityId: donor.id,
        metadata: { accessScope: 'donor_profile' },
      })));
      const includeRestricted = request.auth.user.roles.some((role) => ['ADMIN', 'STAFF'].includes(role));
      return response.json({
        donors: donors.map((donor) => publicDonor(donor, { includeRestricted })),
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize),
        },
      });
    },
  );

  router.post(
    '/',
    authenticate,
    requirePermission(prisma, 'donors', 'create'),
    async (request, response) => {
      const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? request.body
        : {};
      const isDonor = request.auth.user.roles.includes('DONOR')
        && !request.auth.user.roles.some((role) => ['ADMIN', 'STAFF'].includes(role));

      try {
        if (isDonor) {
          const details = validateProfileUpdate(body, false, { allowEmpty: true });
          if (Object.keys(details).some((field) => field !== 'dateOfBirth')) {
            return sendBadRequest(response, 'Donor registration may only include dateOfBirth.');
          }
          const donor = await prisma.$transaction(async (transaction) => {
            const created = await transaction.donor.create({
              data: {
                userId: request.auth.user.id,
                donorNumber: createDonorNumber(),
                dateOfBirth: details.dateOfBirth,
              },
              include: donorInclude,
            });
            await writeAudit(transaction, request, {
              action: 'donor.profile_created',
              entityType: 'donor',
              entityId: created.id,
              changedFields: ['donor_profile'],
              metadata: { changeCategory: 'donor_profile' },
            });
            return created;
          });
          return response.status(201).json({ donor: publicDonor(donor) });
        }

        const details = validateRegistration(body);
        const isStaffOnly = request.auth.user.roles.includes('STAFF')
          && !request.auth.user.roles.includes('ADMIN');
        const registrationHospitalId = isStaffOnly
          ? request.auth.user.hospitalIds[0]
          : null;
        if (isStaffOnly && !registrationHospitalId) {
          return response.status(403).json({
            error: {
              code: 'FORBIDDEN',
              message: 'Your staff account is not assigned to an active hospital.',
            },
          });
        }

        const donor = await prisma.$transaction(async (transaction) => {
          const donorRole = await transaction.role.upsert({
            where: { code: 'DONOR' },
            update: {},
            create: {
              code: 'DONOR',
              name: 'Donor',
              description: 'Donor account role.',
            },
          });

          const created = await transaction.user.create({
            data: {
              email: details.email,
              displayName: details.displayName,
              phoneE164: details.phoneE164,
              accountStatus: 'active',
              roleAssignments: {
                create: { role: { connect: { id: donorRole.id } } },
              },
              donorProfile: {
                create: {
                  donorNumber: createDonorNumber(),
                  registrationHospitalId,
                  dateOfBirth: details.dateOfBirth,
                },
              },
            },
            select: {
              id: true,
              displayName: true,
              email: true,
              phoneE164: true,
              donorProfile: {
                include: {
                  _count: { select: { donations: true } },
                },
              },
            },
          });
          await writeAudit(transaction, request, {
            action: 'account.donor_created',
            entityType: 'user',
            entityId: created.id,
            changedFields: ['accountStatus', 'roleAssignments'],
            metadata: { changeCategory: 'account', roleCode: 'DONOR', source: 'staff_management' },
          });
          await writeAudit(transaction, request, {
            action: 'permission.role_assigned',
            entityType: 'user',
            entityId: created.id,
            changedFields: ['roleAssignments'],
            metadata: { changeCategory: 'permission', roleCode: 'DONOR', source: 'staff_management' },
          });
          await writeAudit(transaction, request, {
            action: 'donor.profile_created',
            entityType: 'donor',
            entityId: created.donorProfile.id,
            changedFields: ['donor_profile'],
            metadata: { changeCategory: 'donor_profile' },
          });
          return created;
        });

        return response.status(201).json({
          donor: {
            id: donor.donorProfile.id,
            donorNumber: donor.donorProfile.donorNumber,
            dateOfBirth: donor.donorProfile.dateOfBirth,
            user: {
              id: donor.id,
              displayName: donor.displayName,
              email: donor.email,
              phoneE164: donor.phoneE164,
            },
            donationCount: donor.donorProfile._count.donations,
            latestDonation: null,
          },
        });
      } catch (error) {
        if (error instanceof DonorValidationError) {
          return sendBadRequest(response, error.message);
        }
        if (error.code === 'P2002') {
          return response.status(409).json({
            error: {
              code: 'DONOR_ALREADY_EXISTS',
              message: 'The email or donor profile is already registered.',
            },
          });
        }
        throw error;
      }
    },
  );

  router.get(
    '/:id/donations',
    authenticate,
    requireDonorId,
    requirePermission(prisma, 'donors', 'view', { recordDelegate: 'donor' }),
    async (request, response) => {
      const donations = await prisma.donation.findMany({
        where: { donorId: request.authorizedRecord.id },
        orderBy: [{ collectedAt: 'desc' }, { id: 'asc' }],
        select: donationHistorySelect,
      });
      await writeAuditAccess(prisma, request, {
        action: 'donor.sensitive_information_viewed',
        entityType: 'donor',
        entityId: request.authorizedRecord.id,
        metadata: { accessScope: 'donation_history' },
      });
      return response.json({ donations });
    },
  );

  router.get(
    '/:id',
    authenticate,
    requireDonorId,
    requirePermission(prisma, 'donors', 'view', { recordDelegate: 'donor' }),
    async (request, response) => {
      const donor = await prisma.donor.findUnique({
        where: { id: request.authorizedRecord.id },
        include: donorInclude,
      });
      const includeRestricted = request.auth.user.roles.some((role) => ['ADMIN', 'STAFF'].includes(role));
      await writeAuditAccess(prisma, request, {
        action: 'donor.sensitive_information_viewed',
        entityType: 'donor',
        entityId: donor.id,
        metadata: { accessScope: 'donor_profile' },
      });
      return response.json({ donor: publicDonor(donor, { includeRestricted }) });
    },
  );

  router.put(
    '/:id',
    authenticate,
    requireDonorId,
    requirePermission(prisma, 'donors', 'update', { recordDelegate: 'donor' }),
    async (request, response) => {
      const isStaff = request.auth.user.roles.some((role) => ['ADMIN', 'STAFF'].includes(role));
      const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? request.body
        : {};
      try {
        const updates = validateProfileUpdate(body, isStaff);
        const { displayName, email, phoneE164, dateOfBirth, ...screening } = updates;
        const donor = await prisma.$transaction(async (transaction) => {
          if (displayName !== undefined || email !== undefined || phoneE164 !== undefined) {
            await transaction.user.update({
              where: { id: request.authorizedRecord.userId },
              data: {
                ...(displayName !== undefined ? { displayName } : {}),
                ...(email !== undefined ? { email } : {}),
                ...(phoneE164 !== undefined ? { phoneE164 } : {}),
              },
            });
          }

          const updated = await transaction.donor.update({
            where: { id: request.authorizedRecord.id },
            data: {
              ...(dateOfBirth !== undefined ? { dateOfBirth } : {}),
              ...screening,
            },
            include: donorInclude,
          });
          if (displayName !== undefined || email !== undefined || phoneE164 !== undefined) {
            await writeAudit(transaction, request, {
              action: 'account.contact_updated',
              entityType: 'user',
              entityId: request.authorizedRecord.userId,
              changedFields: [
                ...(displayName !== undefined ? ['displayName'] : []),
                ...(email !== undefined ? ['email'] : []),
                ...(phoneE164 !== undefined ? ['phoneE164'] : []),
              ],
              metadata: { changeCategory: 'account' },
            });
          }
          if (dateOfBirth !== undefined || Object.keys(screening).length) {
            await writeAudit(transaction, request, {
              action: 'donor.profile_updated',
              entityType: 'donor',
              entityId: updated.id,
              changedFields: [
                ...(dateOfBirth !== undefined ? ['donor_profile'] : []),
                ...(Object.keys(screening).length ? ['donor_screening_metadata'] : []),
              ],
              metadata: {
                changeCategory: Object.keys(screening).length ? 'donor_screening_metadata' : 'donor_profile',
              },
            });
          }
          return updated;
        });
        return response.json({
          donor: publicDonor(donor, { includeRestricted: isStaff }),
        });
      } catch (error) {
        if (error instanceof DonorValidationError) {
          return sendBadRequest(response, error.message);
        }
        if (error.code === 'P2002') {
          return response.status(409).json({
            error: {
              code: 'EMAIL_ALREADY_REGISTERED',
              message: 'That email address is already associated with another account.',
            },
          });
        }
        throw error;
      }
    },
  );

  router.use((request, response) => {
    response.status(404).json({
      error: { code: 'NOT_FOUND', message: 'The requested donor endpoint was not found.' },
    });
  });

  return router;
}

export { createDonorRouter };
