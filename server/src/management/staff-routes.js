import { Router } from 'express';
import { requireAuthentication } from '../auth/auth-middleware.js';
import { requirePermission } from '../auth/authorization.js';
import {
  ManagementValidationError,
  isUuid,
  parsePage,
  sendValidationError,
  staffStatuses,
  userStatuses,
  validateStaffCreate,
  validateStaffUpdate,
  writeAudit,
} from './management-utils.js';

const staffInclude = {
  user: {
    select: {
      id: true,
      displayName: true,
      email: true,
      phoneE164: true,
      accountStatus: true,
      disabledAt: true,
    },
  },
  hospital: {
    select: {
      id: true,
      name: true,
      registrationNumber: true,
      isActive: true,
    },
  },
};

function isAdmin(request) {
  if (request.auth.user.roles.includes('ADMIN')) return true;
  return false;
}

function requireAdministrator(request, response, next) {
  if (!isAdmin(request)) {
    return response.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Administrator access is required.' },
    });
  }
  return next();
}

function requireStaffId(request, response, next) {
  if (!isUuid(request.params.id)) {
    return response.status(400).json({
      error: { code: 'INVALID_MANAGEMENT_DATA', message: 'Staff ID must be a valid UUID.' },
    });
  }
  return next();
}

function validateStatusFilter(value, options, field, response) {
  if (value !== undefined && (typeof value !== 'string' || !options.includes(value))) {
    response.status(400).json({
      error: { code: 'INVALID_MANAGEMENT_DATA', message: `${field} is not a supported filter.` },
    });
    return false;
  }
  return true;
}

function createStaffRouter({ prisma }) {
  const router = Router();
  const authenticate = requireAuthentication(prisma);

  router.get(
    '/linkable-accounts',
    authenticate,
    requirePermission(prisma, 'staff', 'view'),
    requireAdministrator,
    async (request, response) => {
      const search = typeof request.query.search === 'string' ? request.query.search.trim() : '';
      if (search.length > 120) {
        return response.status(400).json({
          error: { code: 'INVALID_MANAGEMENT_DATA', message: 'search must be 120 characters or fewer.' },
        });
      }
      const accounts = await prisma.user.findMany({
        where: {
          staffProfile: null,
          ...(search
            ? {
              OR: [
                { displayName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
            : {}),
        },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        take: 100,
        select: {
          id: true,
          displayName: true,
          email: true,
          phoneE164: true,
          accountStatus: true,
          staffProfile: { select: { id: true } },
        },
      });
      return response.json({ accounts });
    },
  );

  router.get(
    '/',
    authenticate,
    requirePermission(prisma, 'staff', 'view'),
    requireAdministrator,
    async (request, response) => {
      const page = parsePage(request.query.page, 1, 1000000);
      const pageSize = parsePage(request.query.pageSize, 20, 100);
      if (page === null || pageSize === null) {
        return response.status(400).json({
          error: { code: 'INVALID_MANAGEMENT_DATA', message: 'page and pageSize must be valid positive numbers.' },
        });
      }
      if (!validateStatusFilter(request.query.status, staffStatuses, 'status', response)) return response;
      if (!validateStatusFilter(request.query.accountStatus, userStatuses, 'accountStatus', response)) return response;
      if (request.query.hospitalId !== undefined && !isUuid(request.query.hospitalId)) {
        return response.status(400).json({
          error: { code: 'INVALID_MANAGEMENT_DATA', message: 'hospitalId must be a valid UUID.' },
        });
      }
      const search = typeof request.query.search === 'string' ? request.query.search.trim() : '';
      if (search.length > 120) {
        return response.status(400).json({
          error: { code: 'INVALID_MANAGEMENT_DATA', message: 'search must be 120 characters or fewer.' },
        });
      }

      const filters = [];
      if (request.query.status) filters.push({ staffStatus: request.query.status });
      if (request.query.accountStatus) filters.push({ user: { accountStatus: request.query.accountStatus } });
      if (request.query.hospitalId) filters.push({ hospitalId: request.query.hospitalId });
      if (search) {
        filters.push({
          OR: [
            { employeeNumber: { contains: search, mode: 'insensitive' } },
            { jobTitle: { contains: search, mode: 'insensitive' } },
            { user: { displayName: { contains: search, mode: 'insensitive' } } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
            { hospital: { name: { contains: search, mode: 'insensitive' } } },
          ],
        });
      }
      const where = filters.length ? { AND: filters } : {};
      const [staff, totalItems] = await Promise.all([
        prisma.staff.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          include: staffInclude,
        }),
        prisma.staff.count({ where }),
      ]);
      return response.json({
        staff,
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
    requirePermission(prisma, 'staff', 'create'),
    requireAdministrator,
    async (request, response) => {
      const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? request.body
        : {};
      try {
        const details = validateStaffCreate(body);
        const staff = await prisma.$transaction(async (transaction) => {
          let roleAssigned = false;
          const hospital = await transaction.hospital.findFirst({
            where: { id: details.hospitalId, isActive: true },
            select: { id: true },
          });
          if (!hospital) {
            const error = new Error('The selected hospital does not exist or is inactive.');
            error.code = 'MANAGEMENT_HOSPITAL_UNAVAILABLE';
            throw error;
          }

          const role = await transaction.role.upsert({
            where: { code: 'STAFF' },
            update: {},
            create: { code: 'STAFF', name: 'Blood bank staff' },
          });

          let user;
          if (details.userId) {
            user = await transaction.user.findUnique({
              where: { id: details.userId },
              select: { id: true, staffProfile: { select: { id: true } } },
            });
            if (!user) {
              const error = new Error('The selected account was not found.');
              error.code = 'MANAGEMENT_USER_NOT_FOUND';
              throw error;
            }
            if (user.staffProfile) {
              const error = new Error('The selected account is already linked to a staff profile.');
              error.code = 'MANAGEMENT_STAFF_ACCOUNT_LINKED';
              throw error;
            }
            const userUpdates = {};
            if (details.accountStatus !== undefined) {
              userUpdates.accountStatus = details.accountStatus;
              userUpdates.disabledAt = details.accountStatus === 'disabled' ? new Date() : null;
            }
            if (details.staffStatus === 'inactive') {
              userUpdates.accountStatus = 'disabled';
              userUpdates.disabledAt = new Date();
            }
            if (Object.keys(userUpdates).length) {
              await transaction.user.update({
                where: { id: user.id },
                data: userUpdates,
              });
            }
            const activeRole = await transaction.userRole.findFirst({
              where: { userId: user.id, roleId: role.id, revokedAt: null },
              select: { id: true },
            });
            if (!activeRole) {
              await transaction.userRole.create({
                data: {
                  userId: user.id,
                  roleId: role.id,
                  assignedByUserId: request.auth.user.id,
                },
              });
              roleAssigned = true;
            }
          } else {
            user = await transaction.user.create({
              data: {
                ...details.contact,
                accountStatus: details.staffStatus === 'inactive' ? 'disabled' : details.accountStatus,
                disabledAt: details.staffStatus === 'inactive' || details.accountStatus === 'disabled'
                  ? new Date()
                  : null,
                roleAssignments: {
                  create: {
                    assignedByUserId: request.auth.user.id,
                    role: { connect: { id: role.id } },
                  },
                },
              },
              select: { id: true },
            });
            roleAssigned = true;
          }

          const record = await transaction.staff.create({
            data: {
              userId: user.id,
              hospitalId: details.hospitalId,
              employeeNumber: details.employeeNumber,
              jobTitle: details.jobTitle,
              staffStatus: details.staffStatus,
            },
            include: staffInclude,
          });
          await writeAudit(transaction, request, {
            action: 'CREATE',
            entityType: 'STAFF',
            entityId: record.id,
            changedFields: [
              'employeeNumber',
              'jobTitle',
              'staffStatus',
              'hospitalId',
              ...(details.userId
                ? ['userId', ...(details.accountStatus ? ['accountStatus'] : []), 'role']
                : ['displayName', 'email', 'phoneE164', 'accountStatus', 'role']),
            ],
          });
          await writeAudit(transaction, request, {
            action: details.userId ? 'account.staff_linked' : 'account.staff_created',
            entityType: 'user',
            entityId: user.id,
            changedFields: details.userId
              ? ['staffProfile', ...(details.accountStatus ? ['accountStatus'] : [])]
              : ['accountStatus', 'staffProfile'],
            metadata: { changeCategory: 'account', roleCode: 'STAFF', source: 'staff_management' },
          });
          if (roleAssigned) {
            await writeAudit(transaction, request, {
              action: 'permission.role_assigned',
              entityType: 'user',
              entityId: user.id,
              changedFields: ['roleAssignments'],
              metadata: { changeCategory: 'permission', roleCode: 'STAFF', source: 'staff_management' },
            });
          }
          return record;
        });
        return response.status(201).json({ staff });
      } catch (error) {
        if (error instanceof ManagementValidationError) return sendValidationError(response, error);
        if (error.code === 'P2002') {
          return response.status(409).json({
            error: { code: 'STAFF_IDENTIFIER_CONFLICT', message: 'That email or employee identifier is already in use.' },
          });
        }
        if (error.code === 'MANAGEMENT_HOSPITAL_UNAVAILABLE') {
          return response.status(400).json({
            error: { code: 'HOSPITAL_UNAVAILABLE', message: error.message },
          });
        }
        if (error.code === 'MANAGEMENT_USER_NOT_FOUND' || error.code === 'MANAGEMENT_STAFF_ACCOUNT_LINKED') {
          return response.status(error.code === 'MANAGEMENT_USER_NOT_FOUND' ? 404 : 409).json({
            error: { code: error.code, message: error.message },
          });
        }
        throw error;
      }
    },
  );

  router.get(
    '/:id',
    authenticate,
    requireStaffId,
    requirePermission(prisma, 'staff', 'view', { recordDelegate: 'staff' }),
    requireAdministrator,
    async (request, response) => {
      const staff = await prisma.staff.findUnique({
        where: { id: request.authorizedRecord.id },
        include: staffInclude,
      });
      return response.json({ staff });
    },
  );

  router.put(
    '/:id',
    authenticate,
    requireStaffId,
    requirePermission(prisma, 'staff', 'update', { recordDelegate: 'staff' }),
    requireAdministrator,
    async (request, response) => {
      const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? request.body
        : {};
      try {
        const updates = validateStaffUpdate(body);
        const staff = await prisma.$transaction(async (transaction) => {
          let accountChangedFields = [];
          if (updates.data.hospitalId) {
            const hospital = await transaction.hospital.findFirst({
              where: { id: updates.data.hospitalId, isActive: true },
              select: { id: true },
            });
            if (!hospital) {
              const error = new Error('The selected hospital does not exist or is inactive.');
              error.code = 'MANAGEMENT_HOSPITAL_UNAVAILABLE';
              throw error;
            }
          }
          if (Object.keys(updates.user).length || updates.data.accountStatus !== undefined
              || updates.data.staffStatus === 'inactive') {
            const userData = { ...updates.user };
            if (updates.data.accountStatus !== undefined) {
              userData.accountStatus = updates.data.accountStatus;
              userData.disabledAt = updates.data.accountStatus === 'disabled' ? new Date() : null;
            }
            if (updates.data.staffStatus === 'inactive') {
              userData.accountStatus = 'disabled';
              userData.disabledAt = new Date();
            }
            await transaction.user.update({
              where: { id: request.authorizedRecord.userId },
              data: userData,
            });
            accountChangedFields = Object.keys(userData).filter((field) => field !== 'disabledAt');
          }
          const data = { ...updates.data };
          delete data.accountStatus;
          const changedFields = Object.keys(body);
          if (updates.data.staffStatus === 'inactive' && !changedFields.includes('accountStatus')) {
            changedFields.push('accountStatus');
          }
          const record = await transaction.staff.update({
            where: { id: request.authorizedRecord.id },
            data,
            include: staffInclude,
          });
          await writeAudit(transaction, request, {
            action: body.staffStatus === 'inactive' ? 'DEACTIVATE' : 'UPDATE',
            entityType: 'STAFF',
            entityId: record.id,
            changedFields,
          });
          if (accountChangedFields.length) {
            await writeAudit(transaction, request, {
              action: 'account.staff_account_updated',
              entityType: 'user',
              entityId: request.authorizedRecord.userId,
              changedFields: accountChangedFields,
              metadata: { changeCategory: 'account', source: 'staff_management' },
            });
          }
          if (updates.data.hospitalId !== undefined) {
            await writeAudit(transaction, request, {
              action: 'permission.staff_scope_changed',
              entityType: 'user',
              entityId: request.authorizedRecord.userId,
              changedFields: ['staffHospitalAssignment'],
              metadata: { changeCategory: 'permission', roleCode: 'STAFF' },
            });
          }
          return record;
        });
        return response.json({ staff });
      } catch (error) {
        if (error instanceof ManagementValidationError) return sendValidationError(response, error);
        if (error.code === 'P2002') {
          return response.status(409).json({
            error: { code: 'STAFF_IDENTIFIER_CONFLICT', message: 'That email or employee identifier is already in use.' },
          });
        }
        if (error.code === 'MANAGEMENT_HOSPITAL_UNAVAILABLE') {
          return response.status(400).json({
            error: { code: 'HOSPITAL_UNAVAILABLE', message: error.message },
          });
        }
        throw error;
      }
    },
  );

  router.delete('/:id', authenticate, requireStaffId, requirePermission(prisma, 'staff', 'update'), requireAdministrator, (_request, response) => (
    response.status(405).json({
      error: {
        code: 'STAFF_RECORDS_ARE_HISTORICAL',
        message: 'Staff records cannot be deleted. Deactivate the staff profile instead.',
      },
    })
  ));

  return router;
}

export { createStaffRouter };
