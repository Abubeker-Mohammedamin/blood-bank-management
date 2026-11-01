import { Router } from 'express';
import { requireAuthentication } from '../auth/auth-middleware.js';
import { buildOwnershipFilter, requirePermission } from '../auth/authorization.js';
import { isUuid, writeAudit, writeAuditAccess } from '../management/management-utils.js';

const componentTypes = ['whole_blood', 'red_cells', 'plasma', 'platelets'];
const testStatuses = ['pending', 'completed', 'failed', 'invalid'];
const reviewStatuses = ['approved', 'rejected'];
const maximumPageSize = 100;

class WorkflowValidationError extends Error {}

function badRequest(response, message) {
  return response.status(400).json({
    error: { code: 'INVALID_WORKFLOW_DATA', message },
  });
}

function conflict(response, message) {
  return response.status(409).json({
    error: { code: 'WORKFLOW_CONFLICT', message },
  });
}

function requireRecordId(request, response, next) {
  if (!isUuid(request.params.id)) return badRequest(response, 'id must be a valid UUID.');
  return next();
}

function parsePage(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= maximum ? parsed : null;
}

function requiredText(value, field, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new WorkflowValidationError(`${field} is required and must be 1 to ${maximum} characters.`);
  }
  return value.trim();
}

function parseDate(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WorkflowValidationError(`${field} must be a valid date and time.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new WorkflowValidationError(`${field} must be a valid date and time.`);
  return date;
}

function parseRequiredTestTypes(value) {
  const types = typeof value === 'string'
    ? value.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean)
    : Array.isArray(value)
      ? value.map((item) => String(item).trim().toUpperCase()).filter(Boolean)
      : [];
  if (types.some((type) => !/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(type))) {
    throw new Error('BLOOD_UNIT_REQUIRED_TEST_TYPES must be comma-separated test type codes.');
  }
  return [...new Set(types)];
}

function validateDonationBody(body) {
  const allowed = new Set([
    'donationNumber',
    'donorId',
    'hospitalId',
    'collectedByStaffId',
    'collectedAt',
    'volumeMl',
    'units',
  ]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length) throw new WorkflowValidationError(`Unsupported donation field(s): ${unknown.join(', ')}.`);
  if (!isUuid(body.donorId) || !isUuid(body.hospitalId) || !isUuid(body.collectedByStaffId)) {
    throw new WorkflowValidationError('donorId, hospitalId, and collectedByStaffId must be valid UUIDs.');
  }
  if (!Number.isInteger(body.volumeMl) || body.volumeMl < 1 || body.volumeMl > 32767) {
    throw new WorkflowValidationError('volumeMl must be a positive whole number.');
  }
  if (!Array.isArray(body.units) || body.units.length < 1) {
    throw new WorkflowValidationError('At least one blood unit identifier is required.');
  }
  const collectedAt = parseDate(body.collectedAt, 'collectedAt');
  const units = body.units.map((unit, index) => {
    if (!unit || typeof unit !== 'object' || Array.isArray(unit)) {
      throw new WorkflowValidationError(`units[${index}] must be an object.`);
    }
    const unitFields = new Set(['unitCode', 'componentType', 'expiresAt', 'storageLocationId']);
    const unsupported = Object.keys(unit).filter((key) => !unitFields.has(key));
    if (unsupported.length) {
      throw new WorkflowValidationError(`units[${index}] contains unsupported field(s): ${unsupported.join(', ')}.`);
    }
    if (unit.storageLocationId != null && !isUuid(unit.storageLocationId)) {
      throw new WorkflowValidationError(`units[${index}].storageLocationId must be a valid UUID.`);
    }
    const componentType = requiredText(unit.componentType, `units[${index}].componentType`, 30);
    if (!componentTypes.includes(componentType)) {
      throw new WorkflowValidationError(`units[${index}].componentType must be one of: ${componentTypes.join(', ')}.`);
    }
    const expiresAt = parseDate(unit.expiresAt, `units[${index}].expiresAt`);
    if (expiresAt <= collectedAt) {
      throw new WorkflowValidationError(`units[${index}].expiresAt must be later than collectedAt.`);
    }
    return {
      unitCode: requiredText(unit.unitCode, `units[${index}].unitCode`, 60).toUpperCase(),
      componentType,
      expiresAt,
      currentStorageLocationId: unit.storageLocationId || null,
    };
  });
  if (new Set(units.map((unit) => unit.unitCode.toUpperCase())).size !== units.length) {
    throw new WorkflowValidationError('Unit identifiers must be unique within the donation.');
  }
  return {
    donationNumber: requiredText(body.donationNumber, 'donationNumber', 40).toUpperCase(),
    donorId: body.donorId,
    hospitalId: body.hospitalId,
    collectedByStaffId: body.collectedByStaffId,
    collectedAt,
    volumeMl: body.volumeMl,
    units,
  };
}

function validateTestBody(body) {
  const allowed = new Set([
    'bloodUnitId',
    'testType',
    'testStatus',
    'resultCode',
    'performedAt',
    'performedByStaffId',
  ]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length) throw new WorkflowValidationError(`Unsupported test field(s): ${unknown.join(', ')}.`);
  if (!isUuid(body.bloodUnitId) || !isUuid(body.performedByStaffId)) {
    throw new WorkflowValidationError('bloodUnitId and performedByStaffId must be valid UUIDs.');
  }
  const testType = requiredText(body.testType, 'testType', 40).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(testType)) {
    throw new WorkflowValidationError('testType must use letters, numbers, underscores, or hyphens.');
  }
  const testStatus = body.testStatus;
  if (!testStatuses.includes(testStatus)) {
    throw new WorkflowValidationError(`testStatus must be one of: ${testStatuses.join(', ')}.`);
  }
  const resultCode = body.resultCode === undefined || body.resultCode === null
    ? null
    : requiredText(body.resultCode, 'resultCode', 40);
  if (testStatus === 'completed' && !resultCode) {
    throw new WorkflowValidationError('Completed tests must include a result code.');
  }
  return {
    bloodUnitId: body.bloodUnitId,
    performedByStaffId: body.performedByStaffId,
    testType,
    testStatus,
    resultCode,
    performedAt: parseDate(body.performedAt, 'performedAt'),
    completedAt: testStatus === 'completed' ? parseDate(body.performedAt, 'performedAt') : null,
  };
}

function combineScope(scope, filters = []) {
  return {
    AND: [
      ...(scope && Object.keys(scope).length ? [scope] : []),
      ...filters,
    ],
  };
}

async function lockUnit(transaction, id) {
  await transaction.$queryRawUnsafe(
    'SELECT "id" FROM "blood_units" WHERE "id" = $1 FOR UPDATE',
    id,
  );
}

function createDonationRouter({ prisma }) {
  const router = Router();
  const authenticate = requireAuthentication(prisma);

  router.get(
    '/',
    authenticate,
    requirePermission(prisma, 'donations', 'view', { scoped: true }),
    async (request, response) => {
      const page = parsePage(request.query.page, 1, 1000000);
      const pageSize = parsePage(request.query.pageSize, 20, maximumPageSize);
      if (page === null || pageSize === null) return badRequest(response, 'page and pageSize must be valid positive numbers.');
      const search = typeof request.query.search === 'string' ? request.query.search.trim() : '';
      if (search.length > 120) return badRequest(response, 'search must be 120 characters or fewer.');
      const filters = search
        ? [{
          OR: [
            { donationNumber: { contains: search, mode: 'insensitive' } },
            { donor: { donorNumber: { contains: search, mode: 'insensitive' } } },
            { bloodUnits: { some: { unitCode: { contains: search, mode: 'insensitive' } } } },
          ],
        }]
        : [];
      const where = combineScope(request.auth.resourceScope, filters);
      const [donations, totalItems] = await Promise.all([
        prisma.donation.findMany({
          where,
          orderBy: [{ collectedAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            donationNumber: true,
            donationStatus: true,
            collectedAt: true,
            volumeMl: true,
            donor: { select: { donorNumber: true, user: { select: { displayName: true } } } },
            hospital: { select: { id: true, name: true } },
            bloodUnits: { select: { id: true, unitCode: true, componentType: true, unitStatus: true } },
          },
        }),
        prisma.donation.count({ where }),
      ]);
      return response.json({
        donations,
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
    requirePermission(prisma, 'donations', 'create', { organizationField: 'hospitalId' }),
    async (request, response) => {
      let data;
      try {
        data = validateDonationBody(request.body || {});
      } catch (error) {
        if (error instanceof WorkflowValidationError) return badRequest(response, error.message);
        throw error;
      }

      try {
        const donation = await prisma.$transaction(async (transaction) => {
          const hospital = await transaction.hospital.findFirst({
            where: { id: data.hospitalId, isActive: true },
            select: { id: true },
          });
          const staff = await transaction.staff.findFirst({
            where: {
              id: data.collectedByStaffId,
              hospitalId: data.hospitalId,
              staffStatus: 'active',
              hospital: { isActive: true },
            },
            select: { id: true },
          });
          const donorScope = request.auth.user.roles.includes('ADMIN')
            ? {}
            : {
              OR: [
                { registrationHospitalId: data.hospitalId },
                { appointments: { some: { hospitalId: data.hospitalId } } },
                { donations: { some: { hospitalId: data.hospitalId } } },
              ],
            };
          const donor = await transaction.donor.findFirst({
            where: { AND: [{ id: data.donorId, deactivatedAt: null }, donorScope] },
            select: { id: true },
          });
          const locationIds = [...new Set(data.units.map((unit) => unit.currentStorageLocationId).filter(Boolean))];
          const locations = locationIds.length
            ? await transaction.storageLocation.findMany({
              where: { id: { in: locationIds }, hospitalId: data.hospitalId, isActive: true },
              select: { id: true },
            })
            : [];
          if (!hospital || !staff || !donor || locations.length !== locationIds.length) {
            throw new WorkflowValidationError('The selected donor, collection staff, facility, or storage location is unavailable in this facility.');
          }

          const record = await transaction.donation.create({
            data: {
              donationNumber: data.donationNumber,
              donorId: data.donorId,
              hospitalId: data.hospitalId,
              collectedByStaffId: data.collectedByStaffId,
              collectedAt: data.collectedAt,
              volumeMl: data.volumeMl,
              donationStatus: 'collected',
              bloodUnits: {
                create: data.units.map((unit) => ({
                  unitCode: unit.unitCode,
                  componentType: unit.componentType,
                  collectedAt: data.collectedAt,
                  expiresAt: unit.expiresAt,
                  currentStorageLocationId: unit.currentStorageLocationId,
                  unitStatus: 'quarantined',
                })),
              },
            },
            include: {
              bloodUnits: { select: { id: true, unitCode: true, componentType: true, unitStatus: true } },
            },
          });
          await writeAudit(transaction, request, {
            action: 'donation.collected',
            entityType: 'donation',
            entityId: record.id,
            changedFields: ['donationNumber', 'donorId', 'hospitalId', 'collectedByStaffId', 'collectedAt', 'volumeMl', 'bloodUnits'],
          });
          for (const unit of record.bloodUnits) {
            await writeAudit(transaction, request, {
              action: 'blood_unit.created_quarantined',
              entityType: 'blood_unit',
              entityId: unit.id,
              changedFields: ['unitCode', 'componentType', 'unitStatus'],
            });
          }
          return record;
        });
        return response.status(201).json({ donation });
      } catch (error) {
        if (error instanceof WorkflowValidationError) return conflict(response, error.message);
        if (error.code === 'P2002') return conflict(response, 'The donation or blood-unit identifier is already in use.');
        throw error;
      }
    },
  );

  router.get(
    '/:id',
    authenticate,
    requireRecordId,
    requirePermission(prisma, 'donations', 'view', { recordDelegate: 'donation' }),
    async (request, response) => {
      const donation = await prisma.donation.findUnique({
        where: { id: request.authorizedRecord.id },
        include: {
          donor: { select: { donorNumber: true, user: { select: { displayName: true } } } },
          hospital: { select: { id: true, name: true } },
          bloodUnits: {
            select: {
              id: true,
              unitCode: true,
              componentType: true,
              unitStatus: true,
              collectedAt: true,
              expiresAt: true,
            },
          },
        },
      });
      return response.json({ donation });
    },
  );

  return router;
}

function createLaboratoryRouter({ prisma }) {
  const router = Router();
  const authenticate = requireAuthentication(prisma);

  router.get(
    '/',
    authenticate,
    requirePermission(prisma, 'laboratoryTests', 'view', { scoped: true }),
    async (request, response) => {
      const page = parsePage(request.query.page, 1, 1000000);
      const pageSize = parsePage(request.query.pageSize, 20, maximumPageSize);
      if (page === null || pageSize === null) return badRequest(response, 'page and pageSize must be valid positive numbers.');
      if (request.query.bloodUnitId !== undefined && !isUuid(request.query.bloodUnitId)) {
        return badRequest(response, 'bloodUnitId must be a valid UUID.');
      }
      const filters = request.query.bloodUnitId ? [{ bloodUnitId: request.query.bloodUnitId }] : [];
      const where = combineScope(request.auth.resourceScope, filters);
      const [tests, totalItems] = await Promise.all([
        prisma.laboratoryTest.findMany({
          where,
          orderBy: [{ recordedAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            bloodUnit: { select: { id: true, unitCode: true, unitStatus: true } },
            donation: {
              select: {
                id: true,
                donationNumber: true,
                hospital: { select: { id: true, name: true } },
              },
            },
            performedBy: { select: { id: true, employeeNumber: true } },
            reviewedBy: { select: { id: true, employeeNumber: true } },
          },
        }),
        prisma.laboratoryTest.count({ where }),
      ]);
      await Promise.all(tests.map((test) => writeAuditAccess(prisma, request, {
        action: 'laboratory_test.viewed',
        entityType: 'laboratory_test',
        entityId: test.id,
        metadata: { accessScope: 'laboratory_test' },
      })));
      return response.json({
        tests,
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
    requirePermission(prisma, 'laboratoryTests', 'create'),
    async (request, response) => {
      let data;
      try {
        data = validateTestBody(request.body || {});
      } catch (error) {
        if (error instanceof WorkflowValidationError) return badRequest(response, error.message);
        throw error;
      }
      try {
        const test = await prisma.$transaction(async (transaction) => {
          await lockUnit(transaction, data.bloodUnitId);
          const scope = buildOwnershipFilter(request.auth.user, 'bloodUnits');
          const unit = await transaction.bloodUnit.findFirst({
            where: combineScope(scope, [{ id: data.bloodUnitId }]),
            select: { id: true, donationId: true, unitStatus: true, donation: { select: { hospitalId: true } } },
          });
          if (!unit) throw new WorkflowValidationError('Blood unit was not found in your authorized facility scope.');
          if (unit.unitStatus !== 'quarantined') {
            throw new WorkflowValidationError('Laboratory tests can only be added while a unit is quarantined.');
          }
          const performer = await transaction.staff.findFirst({
            where: {
              id: data.performedByStaffId,
              hospitalId: unit.donation.hospitalId,
              staffStatus: 'active',
              hospital: { isActive: true },
            },
            select: { id: true },
          });
          if (!performer) throw new WorkflowValidationError('The responsible staff member is unavailable at this facility.');
          const lastTest = await transaction.laboratoryTest.findFirst({
            where: {
              donationId: unit.donationId,
              testType: data.testType,
            },
            orderBy: { attemptNo: 'desc' },
            select: { attemptNo: true },
          });
          const record = await transaction.laboratoryTest.create({
            data: {
              ...data,
              donationId: unit.donationId,
              attemptNo: (lastTest?.attemptNo || 0) + 1,
              reviewStatus: 'pending',
            },
            select: {
              id: true,
              bloodUnitId: true,
              testType: true,
              attemptNo: true,
              testStatus: true,
              reviewStatus: true,
              resultCode: true,
              performedAt: true,
              completedAt: true,
              performedByStaffId: true,
            },
          });
          await writeAudit(transaction, request, {
            action: 'laboratory_test.recorded',
            entityType: 'laboratory_test',
            entityId: record.id,
            changedFields: ['bloodUnitId', 'attemptNo', 'testStatus', 'reviewStatus', 'performedAt'],
            metadata: { changeCategory: 'laboratory_result', toStatus: record.testStatus },
          });
          return record;
        });
        return response.status(201).json({ test });
      } catch (error) {
        if (error instanceof WorkflowValidationError) return conflict(response, error.message);
        if (error.code === 'P2002') return conflict(response, 'A test attempt with this identifier already exists.');
        throw error;
      }
    },
  );

  router.patch(
    '/:id/review',
    authenticate,
    requireRecordId,
    requirePermission(prisma, 'laboratoryTests', 'approve', { recordDelegate: 'laboratoryTest' }),
    async (request, response) => {
      const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? request.body
        : {};
      if (Object.keys(body).some((key) => key !== 'reviewStatus' && key !== 'reviewedByStaffId')) {
        return badRequest(response, 'Only reviewStatus and reviewedByStaffId may be provided.');
      }
      if (!reviewStatuses.includes(body.reviewStatus)) {
        return badRequest(response, `reviewStatus must be one of: ${reviewStatuses.join(', ')}.`);
      }
      if (body.reviewedByStaffId !== undefined && !isUuid(body.reviewedByStaffId)) {
        return badRequest(response, 'reviewedByStaffId must be a valid UUID.');
      }
      try {
        const test = await prisma.$transaction(async (transaction) => {
          const existing = await transaction.laboratoryTest.findUnique({
            where: { id: request.authorizedRecord.id },
            select: {
              id: true,
              bloodUnitId: true,
              donation: { select: { hospitalId: true } },
              testStatus: true,
              reviewStatus: true,
              resultCode: true,
            },
          });
          if (!existing || !existing.bloodUnitId) {
            throw new WorkflowValidationError('Only unit-level laboratory tests can be reviewed.');
          }
          await lockUnit(transaction, existing.bloodUnitId);
          if (existing.reviewStatus !== 'pending') {
            throw new WorkflowValidationError('This test has already received a final review.');
          }
          if (body.reviewStatus === 'approved' && (existing.testStatus !== 'completed' || !existing.resultCode)) {
            throw new WorkflowValidationError('Only completed tests with a result can be approved.');
          }
          const reviewerId = body.reviewedByStaffId || request.auth.user.staffId;
          if (!reviewerId) throw new WorkflowValidationError('An active staff profile is required to review a laboratory result.');
          const reviewer = await transaction.staff.findFirst({
            where: {
              id: reviewerId,
              hospitalId: existing.donation.hospitalId,
              staffStatus: 'active',
              hospital: { isActive: true },
            },
            select: { id: true },
          });
          if (!reviewer) throw new WorkflowValidationError('The reviewing staff member is unavailable at this facility.');
          const review = await transaction.laboratoryTest.updateMany({
            where: { id: existing.id, reviewStatus: 'pending' },
            data: {
              reviewStatus: body.reviewStatus,
              reviewedByStaffId: reviewer.id,
              reviewedAt: new Date(),
            },
          });
          if (review.count !== 1) {
            throw new WorkflowValidationError('This test has already received a final review.');
          }
          const updated = await transaction.laboratoryTest.findUnique({
            where: { id: existing.id },
            select: {
              id: true,
              bloodUnitId: true,
              testType: true,
              testStatus: true,
              reviewStatus: true,
              performedAt: true,
              reviewedAt: true,
              reviewedByStaffId: true,
            },
          });
          await writeAudit(transaction, request, {
            action: `laboratory_test.${body.reviewStatus}`,
            entityType: 'laboratory_test',
            entityId: updated.id,
            changedFields: ['reviewStatus', 'reviewedByStaffId', 'reviewedAt'],
            metadata: {
              changeCategory: 'laboratory_result',
              fromStatus: existing.reviewStatus,
              toStatus: body.reviewStatus,
            },
          });
          return updated;
        });
        return response.json({ test });
      } catch (error) {
        if (error instanceof WorkflowValidationError) return conflict(response, error.message);
        throw error;
      }
    },
  );
  return router;
}

function createBloodUnitRouter({ prisma, requiredTestTypes }) {
  const router = Router();
  const authenticate = requireAuthentication(prisma);

  router.get(
    '/',
    authenticate,
    requirePermission(prisma, 'bloodUnits', 'view', { scoped: true }),
    async (request, response) => {
      const page = parsePage(request.query.page, 1, 1000000);
      const pageSize = parsePage(request.query.pageSize, 20, maximumPageSize);
      if (page === null || pageSize === null) return badRequest(response, 'page and pageSize must be valid positive numbers.');
      const where = combineScope(request.auth.resourceScope);
      const [units, totalItems] = await Promise.all([
        prisma.bloodUnit.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            donation: { select: { id: true, donationNumber: true, hospital: { select: { name: true } } } },
            ...(request.auth.user.roles.some((role) => ['ADMIN', 'STAFF'].includes(role))
              ? {
                laboratoryTests: {
                  select: { id: true, testType: true, testStatus: true, reviewStatus: true },
                  orderBy: [{ testType: 'asc' }, { attemptNo: 'desc' }],
                },
              }
              : {}),
          },
        }),
        prisma.bloodUnit.count({ where }),
      ]);
      return response.json({
        units,
        requiredTestTypes,
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
    '/:id/release',
    authenticate,
    requireRecordId,
    requirePermission(prisma, 'bloodUnits', 'approve', { recordDelegate: 'bloodUnit' }),
    async (request, response) => {
      if (requiredTestTypes.length === 0) {
        return conflict(response, 'Unit release is disabled until BLOOD_UNIT_REQUIRED_TEST_TYPES is configured.');
      }
      try {
        const unit = await prisma.$transaction(async (transaction) => {
          await lockUnit(transaction, request.authorizedRecord.id);
          const current = await transaction.bloodUnit.findUnique({
            where: { id: request.authorizedRecord.id },
            select: {
              id: true,
              unitStatus: true,
              expiresAt: true,
              donation: { select: { bloodType: { select: { bloodTypeId: true } } } },
            },
          });
          if (!current || current.unitStatus !== 'quarantined') {
            throw new WorkflowValidationError('Only quarantined units can be released.');
          }
          if (current.expiresAt <= new Date()) {
            throw new WorkflowValidationError('Expired units cannot be released.');
          }
          if (!current.donation?.bloodType) {
            throw new WorkflowValidationError('A blood group must be confirmed before a unit can be released.');
          }
          const tests = await transaction.laboratoryTest.findMany({
            where: { bloodUnitId: current.id },
            orderBy: [{ testType: 'asc' }, { attemptNo: 'desc' }],
            select: { testType: true, attemptNo: true, testStatus: true, reviewStatus: true, resultCode: true },
          });
          const latestByType = new Map();
          for (const test of tests) {
            const previous = latestByType.get(test.testType);
            if (!previous || test.attemptNo > previous.attemptNo) latestByType.set(test.testType, test);
          }
          const requirementsPassed = requiredTestTypes.every((type) => {
            const result = latestByType.get(type);
            return result
              && result.testStatus === 'completed'
              && result.reviewStatus === 'approved'
              && Boolean(result.resultCode);
          });
          const latestAttemptsPassed = [...latestByType.values()].every((test) => (
            test.testStatus === 'completed'
            && test.reviewStatus === 'approved'
            && Boolean(test.resultCode)
          ));
          if (!requirementsPassed || !latestAttemptsPassed) {
            throw new WorkflowValidationError('Release is blocked until the latest attempt for every configured and recorded test type is completed and approved.');
          }
          const updated = await transaction.bloodUnit.update({
            where: { id: current.id },
            data: { unitStatus: 'available' },
            select: { id: true, unitCode: true, unitStatus: true },
          });
          await writeAudit(transaction, request, {
            action: 'blood_unit.released',
            entityType: 'blood_unit',
            entityId: updated.id,
            changedFields: ['unitStatus'],
            metadata: {
              changeCategory: 'inventory_status',
              fromStatus: current.unitStatus,
              toStatus: updated.unitStatus,
            },
          });
          return updated;
        });
        return response.json({ unit });
      } catch (error) {
        if (error instanceof WorkflowValidationError) return conflict(response, error.message);
        throw error;
      }
    },
  );
  return router;
}

export {
  createBloodUnitRouter,
  createDonationRouter,
  createLaboratoryRouter,
  parseRequiredTestTypes,
};
