import { Router } from 'express';
import { requireAuthentication } from '../auth/auth-middleware.js';
import { buildOwnershipFilter, requirePermission } from '../auth/authorization.js';
import { isUuid, writeAudit } from '../management/management-utils.js';

const components = ['whole_blood', 'red_cells', 'plasma', 'platelets'];
const currentStatuses = ['quarantined', 'available', 'reserved', 'issued', 'expired', 'discarded'];
const allowedLocationTypes = ['refrigerator', 'freezer', 'platelet_incubator', 'other'];
const pageLimit = 100;

class InventoryError extends Error {}

function badRequest(response, message) {
  return response.status(400).json({ error: { code: 'INVALID_INVENTORY_DATA', message } });
}

function conflict(response, message) {
  return response.status(409).json({ error: { code: 'INVENTORY_CONFLICT', message } });
}

function parsePage(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= maximum ? parsed : null;
}

function parseOptionalDate(value, field) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new InventoryError(`${field} must be a valid date.`);
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) throw new InventoryError(`${field} must be a valid date.`);
  return result;
}

function requiredText(value, field, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new InventoryError(`${field} is required and must be 1 to ${maximum} characters.`);
  }
  return value.trim();
}

function parseThresholds(value) {
  if (!value) return {};
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  const thresholds = {};
  for (const entry of entries) {
    const match = /^((?:AB|A|B|O)[+-])\|([a-z_]+):(\d+)$/.exec(entry);
    if (!match || !components.includes(match[2]) || Number(match[3]) < 0) {
      throw new Error('INVENTORY_LOW_STOCK_THRESHOLDS must use BLOOD_GROUP|component:count entries.');
    }
    const key = `${match[1]}|${match[2]}`;
    if (Object.hasOwn(thresholds, key)) throw new Error('INVENTORY_LOW_STOCK_THRESHOLDS contains a duplicate blood-group/component key.');
    thresholds[key] = Number(match[3]);
  }
  return thresholds;
}

function parseExpiryWarningDays(value) {
  if (value === undefined || value === '') return null;
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 365) {
    throw new Error('INVENTORY_EXPIRY_WARNING_DAYS must be a whole number between 1 and 365.');
  }
  return Number(value);
}

function latestTestsByType(tests = []) {
  const latest = new Map();
  for (const test of tests) {
    const current = latest.get(test.testType);
    if (!current || test.attemptNo > current.attemptNo) latest.set(test.testType, test);
  }
  return latest;
}

function unitReleaseBlockers(unit, requiredTestTypes, now = new Date()) {
  const blockers = [];
  if (unit.unitStatus !== 'quarantined' && unit.unitStatus !== 'available') blockers.push('unit_not_releasable');
  if (unit.expiresAt <= now) blockers.push('expired');
  if (!unit.donation?.bloodType?.bloodType?.code) blockers.push('blood_group_unconfirmed');
  if (!requiredTestTypes.length) blockers.push('release_policy_not_configured');

  const testsByType = latestTestsByType(unit.laboratoryTests);
  for (const type of requiredTestTypes) {
    const test = testsByType.get(type);
    if (!test) {
      blockers.push(`required_test_missing:${type}`);
    } else if (test.testStatus !== 'completed') {
      blockers.push(`required_test_not_completed:${type}`);
    } else if (test.reviewStatus === 'rejected') {
      blockers.push(`required_test_rejected:${type}`);
    } else if (test.reviewStatus !== 'approved') {
      blockers.push(`required_test_not_approved:${type}`);
    } else if (!test.resultCode) {
      blockers.push(`required_test_result_missing:${type}`);
    }
  }
  for (const [type, test] of testsByType) {
    if (
      test.testStatus !== 'completed'
      || test.reviewStatus !== 'approved'
      || !test.resultCode
    ) {
      blockers.push(`latest_test_not_approved:${type}`);
    }
  }
  return [...new Set(blockers)];
}

function buildInventorySnapshot(units, { thresholds, expiryWarningDays, now = new Date(), requiredTestTypes }) {
  const availableByKey = new Map();
  const expiringUnits = [];
  const blockedUnits = [];
  const expiryCutoff = expiryWarningDays === null
    ? null
    : new Date(now.getTime() + expiryWarningDays * 24 * 60 * 60 * 1000);

  for (const unit of units) {
    const blockers = unitReleaseBlockers(unit, requiredTestTypes, now);
    const bloodType = unit.donation?.bloodType?.bloodType;
    const bloodGroup = bloodType ? `${bloodType.aboGroup}${bloodType.rhFactor}` : null;
    if (unit.unitStatus === 'available' && blockers.length === 0 && bloodGroup) {
      const key = `${bloodGroup}|${unit.componentType}`;
      availableByKey.set(key, (availableByKey.get(key) || 0) + 1);
    }
    if (
      expiryCutoff
      && unit.expiresAt > now
      && unit.expiresAt <= expiryCutoff
      && !['expired', 'discarded', 'issued'].includes(unit.unitStatus)
    ) {
      expiringUnits.push({ id: unit.id, unitCode: unit.unitCode, expiresAt: unit.expiresAt });
    }
    if (blockers.length && ['quarantined', 'available', 'expired'].includes(unit.unitStatus)) {
      blockedUnits.push({ id: unit.id, unitCode: unit.unitCode, blockers });
    }
  }

  const lowStock = Object.entries(thresholds)
    .map(([key, threshold]) => ({
      bloodGroup: key.split('|')[0],
      componentType: key.split('|')[1],
      threshold,
      available: availableByKey.get(key) || 0,
    }))
    .filter((stock) => stock.available < stock.threshold);

  return {
    stock: [...availableByKey.entries()].map(([key, available]) => ({
      bloodGroup: key.split('|')[0],
      componentType: key.split('|')[1],
      available,
    })),
    lowStock,
    expiringUnits,
    blockedUnits,
  };
}

function combineScope(scope, filters = []) {
  return { AND: [...(scope && Object.keys(scope).length ? [scope] : []), ...filters] };
}

async function lockUnit(transaction, id) {
  await transaction.$queryRaw`SELECT "id" FROM "blood_units" WHERE "id" = ${id} FOR UPDATE`;
}

async function lockRequest(transaction, id) {
  await transaction.$queryRaw`SELECT "id" FROM "blood_requests" WHERE "id" = ${id} FOR UPDATE`;
}

const staffUnitSelect = {
  id: true,
  donationId: true,
  unitCode: true,
  componentType: true,
  unitStatus: true,
  collectedAt: true,
  expiresAt: true,
  currentStorageLocationId: true,
  createdAt: true,
  updatedAt: true,
  currentStorageLocation: {
    select: { id: true, code: true, name: true, hospitalId: true, isActive: true },
  },
  donation: {
    select: {
      id: true,
      donationNumber: true,
      hospitalId: true,
      hospital: { select: { name: true } },
      bloodType: {
        select: {
          bloodType: { select: { id: true, code: true, aboGroup: true, rhFactor: true } },
          verifiedAt: true,
        },
      },
    },
  },
  laboratoryTests: {
    select: {
      id: true,
      testType: true,
      attemptNo: true,
      testStatus: true,
      reviewStatus: true,
      resultCode: true,
      performedAt: true,
      reviewedAt: true,
    },
    orderBy: [{ testType: 'asc' }, { attemptNo: 'desc' }],
  },
};

const hospitalUnitSelect = {
  id: true,
  donationId: true,
  unitCode: true,
  componentType: true,
  unitStatus: true,
  collectedAt: true,
  expiresAt: true,
  currentStorageLocationId: true,
  createdAt: true,
  updatedAt: true,
  currentStorageLocation: {
    select: { id: true, code: true, name: true, hospitalId: true, isActive: true },
  },
  donation: {
    select: {
      id: true,
      donationNumber: true,
      hospitalId: true,
      hospital: { select: { name: true } },
      bloodType: {
        select: {
          bloodType: { select: { id: true, code: true, aboGroup: true, rhFactor: true } },
          verifiedAt: true,
        },
      },
    },
  },
};

function validateLocationBody(body, partial = false) {
  const allowedFields = new Set([
    'hospitalId',
    'code',
    'name',
    'locationType',
    'minTemperatureC',
    'maxTemperatureC',
    'isActive',
  ]);
  const unknown = Object.keys(body).filter((key) => !allowedFields.has(key));
  if (unknown.length) throw new InventoryError(`Unsupported storage-location field(s): ${unknown.join(', ')}.`);
  const data = {};
  if (!partial || body.hospitalId !== undefined) {
    if (!isUuid(body.hospitalId)) throw new InventoryError('hospitalId must be a valid UUID.');
    data.hospitalId = body.hospitalId;
  }
  for (const [field, maximum] of [['code', 40], ['name', 100]]) {
    if (!partial || body[field] !== undefined) data[field] = requiredText(body[field], field, maximum);
    if (field === 'code' && data[field]) data[field] = data[field].toUpperCase();
  }
  if (!partial || body.locationType !== undefined) {
    data.locationType = requiredText(body.locationType, 'locationType', 30);
    if (!allowedLocationTypes.includes(data.locationType)) {
      throw new InventoryError(`locationType must be one of: ${allowedLocationTypes.join(', ')}.`);
    }
  }
  for (const field of ['minTemperatureC', 'maxTemperatureC']) {
    if (body[field] === undefined && partial) continue;
    if (body[field] === undefined || body[field] === null || body[field] === '') data[field] = null;
    else if (typeof body[field] !== 'number' || !Number.isFinite(body[field]) || body[field] < -99 || body[field] > 99) {
      throw new InventoryError(`${field} must be a number between -99 and 99.`);
    } else data[field] = body[field];
  }
  const minimum = data.minTemperatureC;
  const maximum = data.maxTemperatureC;
  if (minimum !== undefined && maximum !== undefined && minimum !== null && maximum !== null && maximum <= minimum) {
    throw new InventoryError('maxTemperatureC must be greater than minTemperatureC.');
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') throw new InventoryError('isActive must be true or false.');
    data.isActive = body.isActive;
  }
  if (partial && Object.keys(data).length === 0) {
    throw new InventoryError('At least one storage-location field must be provided.');
  }
  return data;
}

function createInventoryRouter({ prisma, requiredTestTypes, lowStockThresholds, expiryWarningDays }) {
  const router = Router();
  const authenticate = requireAuthentication(prisma);

  router.get(
    '/',
    authenticate,
    requirePermission(prisma, 'bloodUnits', 'view', { scoped: true }),
    async (request, response) => {
      const page = parsePage(request.query.page, 1, 1000000);
      const pageSize = parsePage(request.query.pageSize, 20, pageLimit);
      if (page === null || pageSize === null) return badRequest(response, 'page and pageSize must be valid positive numbers.');
      for (const key of ['bloodGroup', 'component', 'status']) {
        if (request.query[key] !== undefined && (typeof request.query[key] !== 'string' || request.query[key].length > 40)) {
          return badRequest(response, `${key} must be a short text value.`);
        }
      }
      if (request.query.component && !components.includes(request.query.component)) {
        return badRequest(response, `component must be one of: ${components.join(', ')}.`);
      }
      if (request.query.status && !currentStatuses.includes(request.query.status)) {
        return badRequest(response, `status must be one of: ${currentStatuses.join(', ')}.`);
      }
      if (request.query.locationId !== undefined && !isUuid(request.query.locationId)) {
        return badRequest(response, 'locationId must be a valid UUID.');
      }
      if (request.query.search !== undefined && (
        typeof request.query.search !== 'string'
        || request.query.search.length > 120
      )) return badRequest(response, 'search must be 120 characters or fewer.');
      const search = request.query.search?.trim() || '';
      let expiresBefore;
      try {
        expiresBefore = parseOptionalDate(request.query.expiresBefore, 'expiresBefore');
      } catch (error) {
        return badRequest(response, error.message);
      }

      const filters = [];
      const now = new Date();
      if (request.query.status === 'expired') {
        filters.push({
          OR: [
            { unitStatus: 'expired' },
            { unitStatus: 'available', expiresAt: { lte: now } },
          ],
        });
      } else if (request.query.status === 'available') {
        filters.push({ unitStatus: 'available', expiresAt: { gt: now } });
      } else if (request.query.status) {
        filters.push({ unitStatus: request.query.status });
      }
      if (request.query.component) filters.push({ componentType: request.query.component });
      if (request.query.locationId) filters.push({ currentStorageLocationId: request.query.locationId });
      if (expiresBefore) filters.push({ expiresAt: { lte: expiresBefore } });
      if (request.query.bloodGroup) {
        const code = request.query.bloodGroup.toUpperCase();
        if (!/^(A|B|AB|O)[+-]$/.test(code)) return badRequest(response, 'bloodGroup must be an ABO/Rh code such as A+ or O-.');
        filters.push({
          donation: {
            bloodType: {
              is: {
                bloodType: {
                  is: { aboGroup: code.slice(0, -1), rhFactor: code.slice(-1) },
                },
              },
            },
          },
        });
      }
      if (search) {
        filters.push({
          OR: [
            { unitCode: { contains: search, mode: 'insensitive' } },
            { donation: { donationNumber: { contains: search, mode: 'insensitive' } } },
          ],
        });
      }
      const where = combineScope(request.auth.resourceScope, filters);
      const isStaff = request.auth.user.roles.some((role) => ['ADMIN', 'STAFF'].includes(role));
      const [units, totalItems] = await Promise.all([
        prisma.bloodUnit.findMany({
          where,
          orderBy: [{ expiresAt: 'asc' }, { unitCode: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: isStaff ? staffUnitSelect : hospitalUnitSelect,
        }),
        prisma.bloodUnit.count({ where }),
      ]);
      const normalizedUnits = units.map((unit) => ({
        ...unit,
        operationalStatus: unit.unitStatus === 'available' && unit.expiresAt <= now
          ? 'expired'
          : unit.unitStatus,
        eligibleForAllocation: isStaff
          && unit.unitStatus === 'available'
          && unitReleaseBlockers(unit, requiredTestTypes, now).length === 0,
        releaseBlockers: isStaff && ['quarantined', 'available', 'expired'].includes(unit.unitStatus)
          ? unitReleaseBlockers(unit, requiredTestTypes, now)
          : undefined,
      }));
      const availableUnits = await prisma.bloodUnit.findMany({
        where: combineScope(request.auth.resourceScope, [{ unitStatus: { in: ['available', 'quarantined', 'expired'] } }]),
        select: staffUnitSelect,
      });
      const snapshot = buildInventorySnapshot(availableUnits, {
        thresholds: lowStockThresholds,
        expiryWarningDays,
        now,
        requiredTestTypes,
      });
      const expiringUnits = expiryWarningDays === null
        ? []
        : await prisma.bloodUnit.findMany({
            where: combineScope(request.auth.resourceScope, [
              { expiresAt: { gt: now, lte: new Date(now.getTime() + expiryWarningDays * 86400000) } },
              { unitStatus: { notIn: ['expired', 'discarded', 'issued'] } },
            ]),
            orderBy: { expiresAt: 'asc' },
            select: staffUnitSelect,
          });
      if (isStaff && expiryWarningDays !== null) {
        snapshot.expiringUnits = expiringUnits.map((unit) => ({
          id: unit.id,
          unitCode: unit.unitCode,
          expiresAt: unit.expiresAt,
          bloodGroup: unit.donation.bloodType
            ? `${unit.donation.bloodType.bloodType.aboGroup}${unit.donation.bloodType.bloodType.rhFactor}`
            : null,
          componentType: unit.componentType,
          storageLocation: unit.currentStorageLocation?.name || null,
          operationalStatus: unit.expiresAt <= now ? 'expired' : unit.unitStatus,
        }));
      }
      return response.json({
        units: normalizedUnits,
        requiredTestTypes: isStaff ? requiredTestTypes : [],
        summary: isStaff
          ? snapshot
          : { stock: snapshot.stock, lowStock: snapshot.lowStock, expiringUnits: [], blockedUnits: [] },
        configuration: {
          lowStockConfigured: Object.keys(lowStockThresholds).length > 0,
          expiryWarningDays,
          releaseConfigured: requiredTestTypes.length > 0,
        },
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize),
        },
      });
    },
  );

  router.get(
    '/:id',
    authenticate,
    (request, _response, next) => (isUuid(request.params.id) ? next() : next('route')),
    requirePermission(prisma, 'bloodUnits', 'view', { recordDelegate: 'bloodUnit' }),
    async (request, response) => {
      const isStaff = request.auth.user.roles.some((role) => ['ADMIN', 'STAFF'].includes(role));
      const unit = await prisma.bloodUnit.findUnique({
        where: { id: request.authorizedRecord.id },
        select: isStaff ? staffUnitSelect : hospitalUnitSelect,
      });
      if (unit && isStaff) {
        unit.operationalStatus = unit.unitStatus === 'available' && unit.expiresAt <= new Date()
          ? 'expired'
          : unit.unitStatus;
        unit.eligibleForAllocation = unit.unitStatus === 'available'
          && unitReleaseBlockers(unit, requiredTestTypes).length === 0;
        unit.releaseBlockers = ['quarantined', 'available', 'expired'].includes(unit.unitStatus)
          ? unitReleaseBlockers(unit, requiredTestTypes)
          : [];
      }
      return response.json({ unit });
    },
  );

  router.get(
    '/locations',
    authenticate,
    requirePermission(prisma, 'storageLocations', 'view', { scoped: true }),
    async (request, response) => {
      const page = parsePage(request.query.page, 1, 1000000);
      const pageSize = parsePage(request.query.pageSize, 20, pageLimit);
      if (page === null || pageSize === null) return badRequest(response, 'page and pageSize must be valid positive numbers.');
      if (request.query.search !== undefined && (
        typeof request.query.search !== 'string'
        || request.query.search.length > 120
      )) return badRequest(response, 'search must be 120 characters or fewer.');
      const search = request.query.search?.trim() || '';
      const filters = search
        ? [{ OR: [{ name: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }] }]
        : [];
      if (request.query.isActive !== undefined) {
        if (!['true', 'false'].includes(request.query.isActive)) return badRequest(response, 'isActive must be true or false.');
        filters.push({ isActive: request.query.isActive === 'true' });
      }
      const where = combineScope(request.auth.resourceScope, filters);
      const [locations, totalItems] = await Promise.all([
        prisma.storageLocation.findMany({
          where,
          orderBy: [{ hospitalId: 'asc' }, { name: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            hospital: { select: { id: true, name: true } },
            _count: { select: { currentUnits: true } },
          },
        }),
        prisma.storageLocation.count({ where }),
      ]);
      return response.json({
        locations,
        pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) },
      });
    },
  );

  router.post(
    '/locations',
    authenticate,
    requirePermission(prisma, 'storageLocations', 'create', { organizationField: 'hospitalId' }),
    async (request, response) => {
      let data;
      try {
        data = validateLocationBody(request.body || {});
      } catch (error) {
        if (error instanceof InventoryError) return badRequest(response, error.message);
        throw error;
      }
      try {
        const location = await prisma.$transaction(async (transaction) => {
          const hospital = await transaction.hospital.findFirst({
            where: {
              id: data.hospitalId,
              isActive: true,
              ...(request.auth.user.roles.includes('ADMIN')
                ? {}
                : { id: { in: request.auth.user.hospitalIds } }),
            },
            select: { id: true },
          });
          if (!hospital) throw new InventoryError('The selected facility is not active or is outside your assigned scope.');
          const created = await transaction.storageLocation.create({ data, include: { hospital: true } });
          await writeAudit(transaction, request, {
            action: 'storage_location.created',
            entityType: 'storage_location',
            entityId: created.id,
            changedFields: Object.keys(data),
          });
          return created;
        });
        return response.status(201).json({ location });
      } catch (error) {
        if (error instanceof InventoryError) return conflict(response, error.message);
        if (error.code === 'P2002') return conflict(response, 'A storage location with this code already exists at the facility.');
        throw error;
      }
    },
  );

  router.put(
    '/locations/:id',
    authenticate,
    requirePermission(prisma, 'storageLocations', 'update', {
      recordDelegate: 'storageLocation',
      scoped: true,
    }),
    async (request, response) => {
      let data;
      try {
        data = validateLocationBody(request.body || {}, true);
      } catch (error) {
        if (error instanceof InventoryError) return badRequest(response, error.message);
        throw error;
      }
      try {
        const location = await prisma.$transaction(async (transaction) => {
          if (data.hospitalId && data.hospitalId !== request.authorizedRecord.hospitalId) {
            throw new InventoryError('A storage location cannot be moved to another facility.');
          }
          const current = request.authorizedRecord;
          const minimum = data.minTemperatureC === undefined ? current.minTemperatureC : data.minTemperatureC;
          const maximum = data.maxTemperatureC === undefined ? current.maxTemperatureC : data.maxTemperatureC;
          if (minimum !== null && maximum !== null && Number(maximum) <= Number(minimum)) {
            throw new InventoryError('maxTemperatureC must be greater than minTemperatureC.');
          }
          const updated = await transaction.storageLocation.update({
            where: { id: request.authorizedRecord.id },
            data,
            include: { hospital: true },
          });
          await writeAudit(transaction, request, {
            action: 'storage_location.updated',
            entityType: 'storage_location',
            entityId: updated.id,
            changedFields: Object.keys(data),
          });
          return updated;
        });
        return response.json({ location });
      } catch (error) {
        if (error instanceof InventoryError) return conflict(response, error.message);
        if (error.code === 'P2002') return conflict(response, 'A storage location with this code already exists at the facility.');
        throw error;
      }
    },
  );

  router.patch(
    '/:id/location',
    authenticate,
    requirePermission(prisma, 'bloodUnits', 'update', { recordDelegate: 'bloodUnit' }),
    async (request, response) => {
      const { storageLocationId } = request.body || {};
      if (!isUuid(storageLocationId)) return badRequest(response, 'storageLocationId must be a valid UUID.');
      try {
        const unit = await prisma.$transaction(async (transaction) => {
          await lockUnit(transaction, request.authorizedRecord.id);
          const current = await transaction.bloodUnit.findUnique({
            where: { id: request.authorizedRecord.id },
            select: {
              id: true,
              currentStorageLocationId: true,
              unitStatus: true,
              donation: { select: { hospitalId: true } },
            },
          });
          if (!current || ['issued', 'discarded', 'expired'].includes(current.unitStatus)) {
            throw new InventoryError('Storage cannot be changed for an issued, expired, or discarded unit.');
          }
          const location = await transaction.storageLocation.findFirst({
            where: {
              id: storageLocationId,
              hospitalId: current.donation.hospitalId,
              isActive: true,
            },
            select: { id: true },
          });
          if (!location) throw new InventoryError('The storage location must be active and belong to the unit facility.');
          const updated = await transaction.bloodUnit.update({
            where: { id: current.id },
            data: { currentStorageLocationId: location.id },
            include: { currentStorageLocation: { select: { id: true, code: true, name: true } } },
          });
          await transaction.bloodUnitMovement.create({
            data: {
              bloodUnitId: current.id,
              fromStorageLocationId: current.currentStorageLocationId,
              toStorageLocationId: location.id,
              movedByStaffId: request.auth.user.staffId,
              reasonCode: 'inventory_assignment',
            },
          });
          await writeAudit(transaction, request, {
            action: 'blood_unit.location_assigned',
            entityType: 'blood_unit',
            entityId: current.id,
            changedFields: ['currentStorageLocationId'],
            metadata: { changeCategory: 'inventory_location' },
          });
          return updated;
        });
        return response.json({ unit });
      } catch (error) {
        if (error instanceof InventoryError) return conflict(response, error.message);
        throw error;
      }
    },
  );

  router.patch(
    '/:id/status',
    authenticate,
    requirePermission(prisma, 'bloodUnits', 'update', { recordDelegate: 'bloodUnit' }),
    async (request, response) => {
      if (request.body?.unitStatus !== 'discarded') {
        return badRequest(response, 'Only the discarded transition is supported here; release and allocation use dedicated endpoints.');
      }
      try {
        const unit = await prisma.$transaction(async (transaction) => {
          await lockUnit(transaction, request.authorizedRecord.id);
          const current = await transaction.bloodUnit.findUnique({
            where: { id: request.authorizedRecord.id },
            select: { id: true, unitCode: true, unitStatus: true },
          });
          if (!current || !['quarantined', 'available'].includes(current.unitStatus)) {
            throw new InventoryError('Only quarantined or available units can be discarded.');
          }
          const previousStatus = current.unitStatus;
          const updatedCount = await transaction.bloodUnit.updateMany({
            where: { id: current.id, unitStatus: current.unitStatus },
            data: { unitStatus: 'discarded' },
          });
          if (updatedCount.count !== 1) throw new InventoryError('The unit status changed; refresh the inventory and try again.');
          const updated = { ...current, unitStatus: 'discarded' };
          await writeAudit(transaction, request, {
            action: 'blood_unit.discarded',
            entityType: 'blood_unit',
            entityId: current.id,
            changedFields: ['unitStatus'],
            metadata: {
              changeCategory: 'inventory_status',
              fromStatus: previousStatus,
              toStatus: 'discarded',
            },
          });
          return updated;
        });
        return response.json({ unit });
      } catch (error) {
        if (error instanceof InventoryError) return conflict(response, error.message);
        throw error;
      }
    },
  );

  router.post(
    '/:id/allocate',
    authenticate,
    (request, response, next) => (
      isUuid(request.params.id)
        ? next()
        : badRequest(response, 'id must be a valid UUID.')
    ),
    requirePermission(prisma, 'bloodUnits', 'allocate', { recordDelegate: 'bloodUnit' }),
    async (request, response) => {
      const { bloodRequestId } = request.body || {};
      if (!isUuid(bloodRequestId)) return badRequest(response, 'bloodRequestId must be a valid UUID.');
      try {
        const allocation = await prisma.$transaction(async (transaction) => {
          await lockRequest(transaction, bloodRequestId);
          await lockUnit(transaction, request.authorizedRecord.id);
          const unit = await transaction.bloodUnit.findUnique({
            where: { id: request.authorizedRecord.id },
            select: {
              id: true,
              unitCode: true,
              unitStatus: true,
              componentType: true,
              expiresAt: true,
              laboratoryTests: {
                select: { testType: true, attemptNo: true, testStatus: true, reviewStatus: true, resultCode: true },
                orderBy: [{ testType: 'asc' }, { attemptNo: 'desc' }],
              },
              donation: {
                select: {
                  hospitalId: true,
                  bloodType: {
                    select: {
                      bloodTypeId: true,
                      bloodType: { select: { code: true, aboGroup: true, rhFactor: true } },
                    },
                  },
                },
              },
            },
          });
          if (!unit || unit.unitStatus !== 'available') {
            throw new InventoryError('Only available units can be allocated.');
          }
          if (unit.expiresAt <= new Date()) throw new InventoryError('Expired units cannot be allocated.');
          const blockers = unitReleaseBlockers(unit, requiredTestTypes);
          if (blockers.length) {
            throw new InventoryError(`This unit is not eligible for allocation: ${blockers.join(', ')}.`);
          }
          const requestScope = request.auth.user.roles.includes('ADMIN')
            ? {}
            : { hospitalId: { in: request.auth.user.hospitalIds } };
          const bloodRequest = await transaction.bloodRequest.findFirst({
            where: {
              AND: [
                {
                  id: bloodRequestId,
                  requestStatus: { in: ['approved', 'partially_fulfilled'] },
                  reviewedByUserId: { not: null },
                  reviewedAt: { not: null },
                },
                requestScope,
              ],
            },
            select: {
              id: true,
              hospitalId: true,
              bloodTypeId: true,
              componentType: true,
              quantityRequested: true,
              requestStatus: true,
              reviewedByUserId: true,
              reviewedAt: true,
              bloodType: { select: { code: true, aboGroup: true, rhFactor: true } },
            },
          });
          if (!bloodRequest) throw new InventoryError('The blood request is not approved or is outside your assigned facility scope.');
          await transaction.$queryRaw`SELECT "id" FROM "blood_compatibility_approvals" WHERE "is_active" = true FOR SHARE`;
          const compatibilityApproval = await transaction.bloodCompatibilityApproval.findFirst({
            where: { isActive: true },
            select: { id: true, reviewedAt: true, policyVersion: true },
          });
          if (!compatibilityApproval) {
            throw new InventoryError('Allocation is disabled until an administrator records an active qualified review of the exact ABO/Rh policy.');
          }
          const unitBloodGroup = unit.donation.bloodType;
          if (
            !unitBloodGroup
            || unitBloodGroup.bloodTypeId !== bloodRequest.bloodTypeId
            || unitBloodGroup.bloodType?.code !== bloodRequest.bloodType.code
            || unitBloodGroup.bloodType?.aboGroup !== bloodRequest.bloodType.aboGroup
            || unitBloodGroup.bloodType?.rhFactor !== bloodRequest.bloodType.rhFactor
            || unit.componentType !== bloodRequest.componentType
          ) {
            throw new InventoryError('The unit blood group and component must match the request.');
          }
          const allocated = await transaction.allocation.count({
            where: { bloodRequestId: bloodRequest.id, allocationStatus: { in: ['reserved', 'fulfilled'] } },
          });
          if (allocated >= bloodRequest.quantityRequested) {
            throw new InventoryError('This request already has its requested quantity allocated.');
          }
          const created = await transaction.allocation.create({
            data: {
              bloodRequestId: bloodRequest.id,
              bloodUnitId: unit.id,
              allocatedByUserId: request.auth.user.id,
              allocationStatus: 'reserved',
            },
            include: { bloodRequest: { select: { requestNumber: true } } },
          });
          const changed = await transaction.bloodUnit.updateMany({
            where: { id: unit.id, unitStatus: 'available', expiresAt: { gt: new Date() } },
            data: { unitStatus: 'reserved' },
          });
          if (changed.count !== 1) throw new InventoryError('The unit is no longer available for allocation.');
          await transaction.bloodRequest.update({
            where: { id: bloodRequest.id },
            data: {
              requestStatus: 'partially_fulfilled',
              statusHistory: {
                create: {
                  changedByUserId: request.auth.user.id,
                  previousStatus: bloodRequest.requestStatus,
                  newStatus: 'partially_fulfilled',
                  note: `Unit allocated under compatibility policy ${compatibilityApproval.policyVersion}.`,
                },
              },
            },
          });
          await writeAudit(transaction, request, {
            action: 'blood_unit.allocated',
            entityType: 'blood_unit',
            entityId: unit.id,
            changedFields: ['unitStatus', 'bloodRequestId', 'requestStatus'],
            metadata: {
              changeCategory: 'inventory_status',
              fromStatus: 'available',
              toStatus: 'reserved',
            },
          });
          await writeAudit(transaction, request, {
            action: 'allocation.created',
            entityType: 'allocation',
            entityId: created.id,
            changedFields: ['allocationStatus', 'bloodUnitId', 'bloodRequestId'],
            metadata: { changeCategory: 'allocation', toStatus: 'reserved' },
          });
          return created;
        }, { isolationLevel: 'Serializable' });
        return response.status(201).json({ allocation });
      } catch (error) {
        if (error instanceof InventoryError) return conflict(response, error.message);
        if (error.code === 'P2002' || error.code === 'P2034') {
          return conflict(response, 'This unit or request changed during allocation. Refresh the inventory and try again.');
        }
        throw error;
      }
    },
  );

  return router;
}

export {
  buildInventorySnapshot,
  createInventoryRouter,
  parseExpiryWarningDays,
  parseThresholds,
  unitReleaseBlockers,
};
