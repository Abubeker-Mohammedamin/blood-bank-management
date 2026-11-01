import { Router } from 'express';
import { requireAuthentication } from '../auth/auth-middleware.js';
import { requirePermission } from '../auth/authorization.js';
import {
  ManagementValidationError,
  isUuid,
  parsePage,
  sendValidationError,
  validateHospital,
  writeAudit,
} from './management-utils.js';

const hospitalSelect = {
  id: true,
  name: true,
  registrationNumber: true,
  phone: true,
  email: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  region: true,
  postalCode: true,
  countryCode: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      staff: true,
      hospitalUsers: true,
      bloodRequests: true,
    },
  },
};

function requireAdministrator(request, response, next) {
  if (!request.auth.user.roles.includes('ADMIN')) {
    return response.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Administrator access is required.' },
    });
  }
  return next();
}

function requireHospitalId(request, response, next) {
  if (!isUuid(request.params.id)) {
    return response.status(400).json({
      error: { code: 'INVALID_MANAGEMENT_DATA', message: 'Hospital ID must be a valid UUID.' },
    });
  }
  return next();
}

function createHospitalRouter({ prisma }) {
  const router = Router();
  const authenticate = requireAuthentication(prisma);

  router.get(
    '/',
    authenticate,
    requirePermission(prisma, 'hospitals', 'view'),
    requireAdministrator,
    async (request, response) => {
      const page = parsePage(request.query.page, 1, 1000000);
      const pageSize = parsePage(request.query.pageSize, 20, 100);
      if (page === null || pageSize === null) {
        return response.status(400).json({
          error: { code: 'INVALID_MANAGEMENT_DATA', message: 'page and pageSize must be valid positive numbers.' },
        });
      }
      if (request.query.isActive !== undefined && !['true', 'false'].includes(request.query.isActive)) {
        return response.status(400).json({
          error: { code: 'INVALID_MANAGEMENT_DATA', message: 'isActive filter must be true or false.' },
        });
      }
      const search = typeof request.query.search === 'string' ? request.query.search.trim() : '';
      if (search.length > 120) {
        return response.status(400).json({
          error: { code: 'INVALID_MANAGEMENT_DATA', message: 'search must be 120 characters or fewer.' },
        });
      }
      const filters = [];
      if (request.query.isActive !== undefined) filters.push({ isActive: request.query.isActive === 'true' });
      if (search) {
        filters.push({
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { registrationNumber: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { city: { contains: search, mode: 'insensitive' } },
            { region: { contains: search, mode: 'insensitive' } },
          ],
        });
      }
      const where = filters.length ? { AND: filters } : {};
      const [hospitals, totalItems] = await Promise.all([
        prisma.hospital.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          select: hospitalSelect,
        }),
        prisma.hospital.count({ where }),
      ]);
      return response.json({
        hospitals,
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
    requirePermission(prisma, 'hospitals', 'create'),
    requireAdministrator,
    async (request, response) => {
      const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? request.body
        : {};
      try {
        const data = validateHospital(body, { creating: true });
        const hospital = await prisma.$transaction(async (transaction) => {
          const record = await transaction.hospital.create({
            data: { ...data, isActive: data.isActive ?? true },
            select: hospitalSelect,
          });
          await writeAudit(transaction, request, {
            action: 'CREATE',
            entityType: 'HOSPITAL',
            entityId: record.id,
            changedFields: Object.keys(data),
          });
          return record;
        });
        return response.status(201).json({ hospital });
      } catch (error) {
        if (error instanceof ManagementValidationError) return sendValidationError(response, error);
        if (error.code === 'P2002') {
          return response.status(409).json({
            error: { code: 'HOSPITAL_IDENTIFIER_CONFLICT', message: 'That hospital registration identifier is already in use.' },
          });
        }
        throw error;
      }
    },
  );

  router.get(
    '/:id/users',
    authenticate,
    requirePermission(prisma, 'hospitalUsers', 'view'),
    requireAdministrator,
    requireHospitalId,
    async (request, response) => {
      const hospital = await prisma.hospital.findUnique({
        where: { id: request.params.id },
        select: { id: true },
      });
      if (!hospital) {
        return response.status(404).json({
          error: { code: 'RECORD_NOT_FOUND', message: 'The hospital was not found.' },
        });
      }
      const memberships = await prisma.hospitalUser.findMany({
        where: { hospitalId: hospital.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          userId: true,
          hospitalId: true,
          isActive: true,
          createdAt: true,
          user: {
            select: {
              displayName: true,
              email: true,
              accountStatus: true,
            },
          },
        },
      });
      return response.json({ memberships });
    },
  );

  router.get(
    '/:id/linkable-accounts',
    authenticate,
    requirePermission(prisma, 'hospitalUsers', 'view'),
    requireAdministrator,
    requireHospitalId,
    async (request, response) => {
      const search = typeof request.query.search === 'string' ? request.query.search.trim() : '';
      if (search.length > 120) {
        return response.status(400).json({
          error: { code: 'INVALID_MANAGEMENT_DATA', message: 'search must be 120 characters or fewer.' },
        });
      }
      const hospital = await prisma.hospital.findFirst({
        where: { id: request.params.id, isActive: true },
        select: { id: true },
      });
      if (!hospital) {
        return response.status(404).json({
          error: { code: 'RECORD_NOT_FOUND', message: 'The active hospital was not found.' },
        });
      }
      const accounts = await prisma.user.findMany({
        where: {
          accountStatus: 'active',
          ...(search
            ? {
              OR: [
                { displayName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
            : {}),
          hospitalMemberships: { none: { hospitalId: hospital.id, isActive: true } },
        },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        take: 100,
        select: {
          id: true,
          displayName: true,
          email: true,
          accountStatus: true,
        },
      });
      return response.json({ accounts });
    },
  );

  router.post(
    '/:id/users',
    authenticate,
    requirePermission(prisma, 'hospitalUsers', 'create'),
    requireAdministrator,
    requireHospitalId,
    async (request, response) => {
      const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? request.body
        : {};
      const userId = body.userId;
      if (Object.keys(body).some((field) => field !== 'userId') || !isUuid(userId)) {
        return response.status(400).json({
          error: { code: 'INVALID_MANAGEMENT_DATA', message: 'Provide only a valid userId.' },
        });
      }
      try {
        const membership = await prisma.$transaction(async (transaction) => {
          const hospital = await transaction.hospital.findFirst({
            where: { id: request.params.id, isActive: true },
            select: { id: true },
          });
          if (!hospital) {
            const error = new Error('The active hospital was not found.');
            error.code = 'MANAGEMENT_HOSPITAL_UNAVAILABLE';
            throw error;
          }
          const user = await transaction.user.findUnique({
            where: { id: userId },
            select: { id: true, accountStatus: true },
          });
          if (!user || user.accountStatus !== 'active') {
            const error = new Error('Select an existing active user account.');
            error.code = 'MANAGEMENT_USER_UNAVAILABLE';
            throw error;
          }
          const existing = await transaction.hospitalUser.findUnique({
            where: { userId_hospitalId: { userId, hospitalId: hospital.id } },
            select: { id: true, isActive: true },
          });
          if (existing?.isActive) {
            const error = new Error('This account is already linked to the hospital.');
            error.code = 'MANAGEMENT_MEMBERSHIP_EXISTS';
            throw error;
          }
          const role = await transaction.role.upsert({
            where: { code: 'HOSPITAL' },
            update: {},
            create: { code: 'HOSPITAL', name: 'Hospital user' },
          });
          const activeRole = await transaction.userRole.findFirst({
            where: { userId, roleId: role.id, revokedAt: null },
            select: { id: true },
          });
          let roleAssigned = false;
          if (!activeRole) {
            await transaction.userRole.create({
              data: {
                userId,
                roleId: role.id,
                assignedByUserId: request.auth.user.id,
              },
            });
            roleAssigned = true;
          }
          const record = existing
            ? await transaction.hospitalUser.update({
              where: { id: existing.id },
              data: { isActive: true },
              include: { user: { select: { displayName: true, email: true, accountStatus: true } } },
            })
            : await transaction.hospitalUser.create({
              data: { userId, hospitalId: hospital.id, isActive: true },
              include: { user: { select: { displayName: true, email: true, accountStatus: true } } },
            });
          await writeAudit(transaction, request, {
            action: existing ? 'ACTIVATE' : 'CREATE',
            entityType: 'HOSPITAL_USER',
            entityId: record.id,
            changedFields: existing ? ['isActive'] : ['userId', 'hospitalId', 'isActive', 'role'],
          });
          if (roleAssigned) {
            await writeAudit(transaction, request, {
              action: 'permission.role_assigned',
              entityType: 'user',
              entityId: userId,
              changedFields: ['roleAssignments'],
              metadata: { changeCategory: 'permission', roleCode: 'HOSPITAL', source: 'hospital_membership' },
            });
          }
          return record;
        });
        return response.status(201).json({ membership });
      } catch (error) {
        if (error.code === 'MANAGEMENT_HOSPITAL_UNAVAILABLE') {
          return response.status(404).json({ error: { code: error.code, message: error.message } });
        }
        if (error.code === 'MANAGEMENT_USER_UNAVAILABLE') {
          return response.status(400).json({ error: { code: error.code, message: error.message } });
        }
        if (error.code === 'MANAGEMENT_MEMBERSHIP_EXISTS') {
          return response.status(409).json({ error: { code: error.code, message: error.message } });
        }
        if (error.code === 'P2002') {
          return response.status(409).json({
            error: { code: 'HOSPITAL_MEMBERSHIP_CONFLICT', message: 'The account is already associated with this hospital.' },
          });
        }
        throw error;
      }
    },
  );

  router.patch(
    '/:id/users/:membershipId',
    authenticate,
    requirePermission(prisma, 'hospitalUsers', 'update'),
    requireAdministrator,
    requireHospitalId,
    async (request, response) => {
      const { membershipId } = request.params;
      const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? request.body
        : {};
      if (!isUuid(membershipId) || typeof body.isActive !== 'boolean'
          || Object.keys(body).some((field) => field !== 'isActive')) {
        return response.status(400).json({
          error: {
            code: 'INVALID_MANAGEMENT_DATA',
            message: 'Provide only isActive as true or false and a valid membership ID.',
          },
        });
      }
      const current = await prisma.hospitalUser.findFirst({
        where: { id: membershipId, hospitalId: request.params.id },
        select: { id: true, isActive: true, userId: true },
      });
      if (!current) {
        return response.status(404).json({
          error: { code: 'RECORD_NOT_FOUND', message: 'The hospital membership was not found.' },
        });
      }
      if (body.isActive) {
        const hospital = await prisma.hospital.findFirst({
          where: { id: request.params.id, isActive: true },
          select: { id: true },
        });
        if (!hospital) {
          return response.status(400).json({
            error: { code: 'HOSPITAL_UNAVAILABLE', message: 'An inactive hospital cannot receive active user memberships.' },
          });
        }
      }
      const membership = await prisma.$transaction(async (transaction) => {
        const record = await transaction.hospitalUser.update({
          where: { id: current.id },
          data: { isActive: body.isActive },
          include: { user: { select: { displayName: true, email: true, accountStatus: true } } },
        });
        await writeAudit(transaction, request, {
          action: body.isActive ? 'ACTIVATE' : 'DEACTIVATE',
          entityType: 'HOSPITAL_USER',
          entityId: record.id,
          changedFields: ['isActive'],
        });
        if (!body.isActive) {
          await writeAudit(transaction, request, {
            action: 'permission.hospital_access_revoked',
            entityType: 'user',
            entityId: current.userId,
            changedFields: ['hospitalMemberships'],
            metadata: { changeCategory: 'permission', roleCode: 'HOSPITAL', source: 'hospital_membership' },
          });
        }
        return record;
      });
      return response.json({ membership });
    },
  );

  router.get(
    '/:id',
    authenticate,
    requirePermission(prisma, 'hospitals', 'view'),
    requireAdministrator,
    requireHospitalId,
    async (request, response) => {
      const hospital = await prisma.hospital.findUnique({
        where: { id: request.params.id },
        select: hospitalSelect,
      });
      if (!hospital) {
        return response.status(404).json({
          error: { code: 'RECORD_NOT_FOUND', message: 'The hospital was not found.' },
        });
      }
      return response.json({ hospital });
    },
  );

  router.put(
    '/:id',
    authenticate,
    requirePermission(prisma, 'hospitals', 'update'),
    requireAdministrator,
    requireHospitalId,
    async (request, response) => {
      const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? request.body
        : {};
      try {
        const data = validateHospital(body);
        const hospital = await prisma.$transaction(async (transaction) => {
          const record = await transaction.hospital.update({
            where: { id: request.params.id },
            data,
            select: hospitalSelect,
          });
          await writeAudit(transaction, request, {
            action: data.isActive === false ? 'DEACTIVATE' : data.isActive === true ? 'ACTIVATE' : 'UPDATE',
            entityType: 'HOSPITAL',
            entityId: record.id,
            changedFields: Object.keys(data),
          });
          if (data.isActive !== undefined) {
            await writeAudit(transaction, request, {
              action: 'permission.hospital_scope_changed',
              entityType: 'hospital',
              entityId: record.id,
              changedFields: ['isActive'],
              metadata: { changeCategory: 'permission' },
            });
          }
          return record;
        });
        return response.json({ hospital });
      } catch (error) {
        if (error instanceof ManagementValidationError) return sendValidationError(response, error);
        if (error.code === 'P2002') {
          return response.status(409).json({
            error: { code: 'HOSPITAL_IDENTIFIER_CONFLICT', message: 'That hospital registration identifier is already in use.' },
          });
        }
        if (error.code === 'P2025') {
          return response.status(404).json({
            error: { code: 'RECORD_NOT_FOUND', message: 'The hospital was not found.' },
          });
        }
        throw error;
      }
    },
  );

  router.delete('/:id', authenticate, requirePermission(prisma, 'hospitals', 'update'), requireAdministrator, (_request, response) => (
    response.status(405).json({
      error: {
        code: 'HOSPITAL_RECORDS_ARE_HISTORICAL',
        message: 'Hospital records cannot be deleted. Deactivate the hospital instead.',
      },
    })
  ));

  return router;
}

export { createHospitalRouter };
