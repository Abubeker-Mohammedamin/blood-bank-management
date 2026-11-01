import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { buildInventorySnapshot, parseExpiryWarningDays, parseThresholds } from '../src/workflows/inventory-routes.js';

const clientOrigin = 'http://localhost:5173';
const sessionSecret = 'inventory-test-secret-with-at-least-32-bytes';
const userId = '00000000-0000-4000-8000-000000000001';
const hospitalId = '00000000-0000-4000-8000-000000000002';
const bloodTypeId = '00000000-0000-4000-8000-000000000003';
const unitId = '00000000-0000-4000-8000-000000000004';
const requestId = '00000000-0000-4000-8000-000000000005';
const locationId = '00000000-0000-4000-8000-000000000006';
const password = 'inventory-test-password';
const futureDate = new Date('2036-05-15T10:00:00.000Z');

function createUnit(overrides = {}) {
  const bloodType = {
    id: bloodTypeId,
    code: 'A_POS',
    aboGroup: 'A',
    rhFactor: '+',
  };
  return {
    id: unitId,
    donationId: '00000000-0000-4000-8000-000000000007',
    unitCode: 'UNIT-0001',
    componentType: 'red_cells',
    unitStatus: 'available',
    collectedAt: new Date('2026-04-15T10:00:00.000Z'),
    expiresAt: futureDate,
    currentStorageLocationId: null,
    currentStorageLocation: null,
    donation: {
      id: '00000000-0000-4000-8000-000000000007',
      donationNumber: 'DONATION-0001',
      hospitalId,
      hospital: { name: 'Test Hospital' },
      bloodType: { bloodTypeId, bloodType, verifiedAt: new Date('2026-04-15T12:00:00.000Z') },
    },
    laboratoryTests: [{
      id: '00000000-0000-4000-8000-000000000008',
      testType: 'SCREEN_A',
      attemptNo: 1,
      testStatus: 'completed',
      reviewStatus: 'approved',
      resultCode: 'RECORDED',
      performedAt: new Date('2026-04-15T11:00:00.000Z'),
      reviewedAt: new Date('2026-04-15T12:00:00.000Z'),
    }],
    ...overrides,
  };
}

function createInventoryApp({
  units = [createUnit()],
  locations = [],
  role = 'ADMIN',
  requestStatus = 'approved',
  compatibilityApproval = {
    id: '00000000-0000-4000-8000-000000000012',
    reviewedAt: new Date('2029-01-01T00:00:00.000Z'),
    policyVersion: 'reviewed-v1',
  },
} = {}) {
  const passwordHash = bcrypt.hashSync(password, 4);
  const user = {
    id: userId,
    email: 'inventory@example.test',
    displayName: 'Inventory Operator',
    passwordHash,
    accountStatus: 'active',
    disabledAt: null,
    roleAssignments: [{ role: { code: role } }],
    donorProfile: null,
    staffProfile: null,
    hospitalMemberships: [],
  };
  const state = {
    units,
    locations,
    allocations: [],
    audits: [],
    movements: [],
    bloodRequest: {
      id: requestId,
      hospitalId,
      bloodTypeId,
      componentType: 'red_cells',
      quantityRequested: 1,
      requestStatus,
      reviewedByUserId: userId,
      reviewedAt: new Date('2030-01-01T00:00:00.000Z'),
      bloodType: { id: bloodTypeId, code: 'A_POS', aboGroup: 'A', rhFactor: '+' },
    },
  };
  let transactionQueue = Promise.resolve();

  function matches(unit, where = {}) {
    if (where.AND && !where.AND.every((item) => matches(unit, item))) return false;
    if (where.OR && !where.OR.some((item) => matches(unit, item))) return false;
    if (typeof where.unitStatus === 'string' && unit.unitStatus !== where.unitStatus) return false;
    if (where.unitStatus?.in && !where.unitStatus.in.includes(unit.unitStatus)) return false;
    if (where.unitStatus?.notIn?.includes(unit.unitStatus)) return false;
    if (where.componentType && unit.componentType !== where.componentType) return false;
    if (where.expiresAt?.gt && unit.expiresAt <= where.expiresAt.gt) return false;
    if (where.expiresAt?.lte && unit.expiresAt > where.expiresAt.lte) return false;
    const bloodTypeFilter = where.donation?.bloodType?.is?.bloodType?.is;
    if (bloodTypeFilter) {
      const actual = unit.donation.bloodType?.bloodType;
      if (!actual || actual.aboGroup !== bloodTypeFilter.aboGroup || actual.rhFactor !== bloodTypeFilter.rhFactor) return false;
    }
    return true;
  }

  const prisma = {
    user: {
      findFirst: async () => user,
      findUnique: async () => user,
    },
    hospital: {
      findFirst: async () => ({ id: hospitalId, name: 'Test Hospital', isActive: true }),
    },
    bloodUnit: {
      findFirst: async ({ where }) => {
        const id = where.AND?.find((item) => item.id)?.id || where.id;
        return state.units.find((unit) => unit.id === id) || null;
      },
      findUnique: async ({ where }) => state.units.find((unit) => unit.id === where.id) || null,
      findMany: async ({ where } = {}) => state.units.filter((unit) => matches(unit, where)),
      count: async ({ where } = {}) => state.units.filter((unit) => matches(unit, where)).length,
      updateMany: async ({ where, data }) => {
        const unit = state.units.find((record) => record.id === where.id && record.unitStatus === where.unitStatus);
        if (!unit) return { count: 0 };
        Object.assign(unit, data);
        return { count: 1 };
      },
      update: async ({ where, data, include }) => {
        const unit = state.units.find((record) => record.id === where.id);
        Object.assign(unit, data);
        if (include?.currentStorageLocation) {
          unit.currentStorageLocation = state.locations.find((item) => item.id === unit.currentStorageLocationId) || null;
        }
        return unit;
      },
    },
    storageLocation: {
      findFirst: async ({ where }) => {
        const id = where.AND?.find((item) => item.id)?.id || where.id;
        return state.locations.find((location) => (
          location.id === id
          && (where.hospitalId === undefined || location.hospitalId === where.hospitalId)
          && (where.isActive === undefined || location.isActive === where.isActive)
        )) || null;
      },
      findMany: async () => state.locations,
      count: async () => state.locations.length,
      create: async ({ data }) => {
        const location = {
          id: '00000000-0000-4000-8000-000000000011',
          ...data,
          isActive: true,
          hospital: { id: data.hospitalId, name: 'Test Hospital' },
          _count: { currentUnits: 0 },
        };
        state.locations.push(location);
        return location;
      },
      update: async ({ where, data }) => {
        const location = state.locations.find((item) => item.id === where.id);
        Object.assign(location, data);
        return location;
      },
    },
    bloodUnitMovement: {
      create: async ({ data }) => {
        state.movements.push(data);
        return data;
      },
    },
    bloodRequest: {
      findFirst: async ({ where }) => {
        const conditions = where.AND || [];
        const statusFilter = conditions.find((item) => item.requestStatus)?.requestStatus;
        const reviewerFilter = conditions.find((item) => item.reviewedByUserId)?.reviewedByUserId;
        if (
          !conditions.some((item) => item.id === state.bloodRequest.id)
          || (statusFilter?.in && !statusFilter.in.includes(state.bloodRequest.requestStatus))
          || (reviewerFilter?.not === null && !state.bloodRequest.reviewedByUserId)
        ) return null;
        return state.bloodRequest;
      },
      update: async ({ data }) => {
        Object.assign(state.bloodRequest, data);
        return state.bloodRequest;
      },
    },
    bloodCompatibilityApproval: {
      findFirst: async () => compatibilityApproval,
    },
    allocation: {
      count: async () => state.allocations.filter((item) => ['reserved', 'fulfilled'].includes(item.allocationStatus)).length,
      create: async ({ data }) => {
        const allocation = {
          id: `00000000-0000-4000-8000-${String(state.allocations.length + 20).padStart(12, '0')}`,
          ...data,
          bloodRequest: { requestNumber: 'REQUEST-0001' },
        };
        state.allocations.push(allocation);
        return allocation;
      },
    },
    auditLog: {
      create: async ({ data }) => {
        state.audits.push(data);
        return data;
      },
    },
    $queryRaw: async () => [],
    $transaction: async (callback) => {
      const previous = transactionQueue;
      let release;
      transactionQueue = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        return await callback(prisma);
      } finally {
        release();
      }
    },
  };
  const app = createApp({
    prisma,
    sessionSecret,
    clientOrigin,
    bloodUnitRequiredTestTypes: 'SCREEN_A',
    inventoryLowStockThresholds: 'A+|red_cells:2',
    inventoryExpiryWarningDays: '30',
  });
  return { app, state };
}

async function login(app) {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/auth/login')
    .set('Origin', clientOrigin)
    .send({ email: 'inventory@example.test', password });
  assert.equal(response.status, 200);
  return agent;
}

test('parses organization-defined inventory thresholds and expiry windows', () => {
  assert.deepEqual(parseThresholds('A+|red_cells:5,O-|platelets:2'), {
    'A+|red_cells': 5,
    'O-|platelets': 2,
  });
  assert.equal(parseExpiryWarningDays('14'), 14);
  assert.throws(() => parseThresholds('A+|unknown:2'), /component:count/);
  assert.throws(() => parseExpiryWarningDays('0'), /between 1 and 365/);
});

test('denies inventory reads to roles without blood-unit permissions', async () => {
  const { app } = createInventoryApp({ role: 'DONOR' });
  const agent = await login(app);
  const response = await agent.get('/api/blood-units').set('Origin', clientOrigin);
  assert.equal(response.status, 403);
});

test('counts only eligible released units and reports low stock and release blockers', () => {
  const now = new Date('2030-01-01T00:00:00.000Z');
  const units = [
    createUnit({ id: 'eligible', expiresAt: new Date('2030-01-20T00:00:00.000Z') }),
    createUnit({ id: 'reserved', unitStatus: 'reserved' }),
    createUnit({
      id: 'rejected',
      laboratoryTests: [{ testType: 'SCREEN_A', attemptNo: 1, testStatus: 'completed', reviewStatus: 'rejected', resultCode: 'RECORDED' }],
    }),
    createUnit({ id: 'expired', expiresAt: new Date('2029-12-30T00:00:00.000Z') }),
    createUnit({ id: 'quarantined', unitStatus: 'quarantined', laboratoryTests: [] }),
  ];
  const snapshot = buildInventorySnapshot(units, {
    thresholds: { 'A+|red_cells': 2 },
    expiryWarningDays: 30,
    requiredTestTypes: ['SCREEN_A'],
    now,
  });

  assert.deepEqual(snapshot.stock, [{ bloodGroup: 'A+', componentType: 'red_cells', available: 1 }]);
  assert.deepEqual(snapshot.lowStock, [{
    bloodGroup: 'A+',
    componentType: 'red_cells',
    threshold: 2,
    available: 1,
  }]);
  assert.equal(snapshot.expiringUnits.some((unit) => unit.id === 'eligible'), true);
  assert.equal(snapshot.blockedUnits.some((unit) => unit.id === 'rejected'), true);
  assert.equal(snapshot.blockedUnits.some((unit) => unit.id === 'expired'), true);
  assert.equal(snapshot.stock.some((stock) => stock.available > 1), false);
});

test('serves the static storage-location route and validates location creation', async () => {
  const existingLocation = {
    id: locationId,
    hospitalId,
    code: 'FRIDGE-01',
    name: 'Main refrigerator',
    locationType: 'refrigerator',
    isActive: true,
    minTemperatureC: null,
    maxTemperatureC: null,
    hospital: { id: hospitalId, name: 'Test Hospital' },
    _count: { currentUnits: 0 },
  };
  const { app, state } = createInventoryApp({ locations: [existingLocation] });
  const agent = await login(app);

  const listResponse = await agent.get('/api/blood-units/locations').set('Origin', clientOrigin);
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.body.locations[0].code, 'FRIDGE-01');

  const invalidResponse = await agent
    .post('/api/blood-units/locations')
    .set('Origin', clientOrigin)
    .send({ hospitalId, code: 'BAD-01', name: 'Unknown location', locationType: 'unknown' });
  assert.equal(invalidResponse.status, 400);
  assert.equal(state.locations.length, 1);

  const createResponse = await agent
    .post('/api/blood-units/locations')
    .set('Origin', clientOrigin)
    .send({ hospitalId, code: 'freezer-02', name: 'Overflow freezer', locationType: 'freezer' });
  assert.equal(createResponse.status, 201);
  assert.equal(createResponse.body.location.code, 'FREEZER-02');
  assert.equal(state.locations.length, 2);

  const assignResponse = await agent
    .patch(`/api/blood-units/${unitId}/location`)
    .set('Origin', clientOrigin)
    .send({ storageLocationId: locationId });
  assert.equal(assignResponse.status, 200);
  assert.equal(state.movements.length, 1);
  assert.equal(state.units[0].currentStorageLocationId, locationId);

  const deactivateResponse = await agent
    .put(`/api/blood-units/locations/${locationId}`)
    .set('Origin', clientOrigin)
    .send({ isActive: false });
  assert.equal(deactivateResponse.status, 200);
  assert.equal(state.locations[0].isActive, false);

  const inactiveAssignResponse = await agent
    .patch(`/api/blood-units/${unitId}/location`)
    .set('Origin', clientOrigin)
    .send({ storageLocationId: locationId });
  assert.equal(inactiveAssignResponse.status, 409);
});

test('filters inventory by ABO/Rh fields rather than internal blood-type codes', async () => {
  const { app } = createInventoryApp({
    units: [
      createUnit(),
      createUnit({
        id: '00000000-0000-4000-8000-000000000009',
        donation: {
          ...createUnit().donation,
          bloodType: {
            bloodTypeId: '00000000-0000-4000-8000-000000000010',
            bloodType: { id: '00000000-0000-4000-8000-000000000010', code: 'O_NEG', aboGroup: 'O', rhFactor: '-' },
          },
        },
      }),
    ],
  });
  const agent = await login(app);

  const response = await agent.get('/api/blood-units?bloodGroup=A%2B').set('Origin', clientOrigin);

  assert.equal(response.status, 200);
  assert.equal(response.body.units.length, 1);
  assert.equal(response.body.units[0].id, unitId);
});

test('serializes competing allocations so only one request can reserve a unit', async () => {
  const { app, state } = createInventoryApp();
  const agent = await login(app);
  const path = `/api/blood-units/${unitId}/allocate`;

  const responses = await Promise.all([
    agent.post(path).set('Origin', clientOrigin).send({ bloodRequestId: requestId }),
    agent.post(path).set('Origin', clientOrigin).send({ bloodRequestId: requestId }),
  ]);

  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(state.allocations.length, 1);
  assert.equal(state.units[0].unitStatus, 'reserved');
  assert.equal(state.bloodRequest.requestStatus, 'partially_fulfilled');
});

test('allows only the supported discard transition from quarantined or available units', async () => {
  const { app, state } = createInventoryApp({ units: [createUnit({ unitStatus: 'quarantined' })] });
  const agent = await login(app);
  const invalidResponse = await agent
    .patch(`/api/blood-units/${unitId}/status`)
    .set('Origin', clientOrigin)
    .send({ unitStatus: 'issued' });
  assert.equal(invalidResponse.status, 400);
  assert.equal(state.units[0].unitStatus, 'quarantined');

  const discardResponse = await agent
    .patch(`/api/blood-units/${unitId}/status`)
    .set('Origin', clientOrigin)
    .send({ unitStatus: 'discarded' });
  assert.equal(discardResponse.status, 200);
  assert.equal(state.units[0].unitStatus, 'discarded');
  const discardAudit = state.audits.find((entry) => entry.action === 'blood_unit.discarded');
  assert.deepEqual(discardAudit.metadata, {
    changeCategory: 'inventory_status',
    fromStatus: 'quarantined',
    toStatus: 'discarded',
  });

  const { app: reservedApp, state: reservedState } = createInventoryApp({
    units: [createUnit({ unitStatus: 'reserved' })],
  });
  const reservedAgent = await login(reservedApp);
  const reservedResponse = await reservedAgent
    .patch(`/api/blood-units/${unitId}/status`)
    .set('Origin', clientOrigin)
    .send({ unitStatus: 'discarded' });
  assert.equal(reservedResponse.status, 409);
  assert.equal(reservedState.units[0].unitStatus, 'reserved');
});

test('rejects expired, unapproved, or mismatched units during allocation', async (context) => {
  const invalidUnits = [
    createUnit({ expiresAt: new Date('2000-01-01T00:00:00.000Z') }),
    createUnit({
      laboratoryTests: [{ testType: 'SCREEN_A', attemptNo: 1, testStatus: 'completed', reviewStatus: 'rejected', resultCode: 'RECORDED' }],
    }),
    createUnit({ componentType: 'plasma' }),
    createUnit({
      donation: {
        ...createUnit().donation,
        bloodType: {
          bloodTypeId: '00000000-0000-4000-8000-000000000010',
          bloodType: { id: '00000000-0000-4000-8000-000000000010', code: 'O_NEG', aboGroup: 'O', rhFactor: '-' },
        },
      },
    }),
  ];

  for (const [index, unit] of invalidUnits.entries()) {
    await context.test(`invalid inventory case ${index + 1}`, async () => {
      const { app, state } = createInventoryApp({ units: [unit] });
      const agent = await login(app);
      const response = await agent
        .post(`/api/blood-units/${unit.id}/allocate`)
        .set('Origin', clientOrigin)
        .send({ bloodRequestId: requestId });

      assert.equal(response.status, 409);
      assert.equal(state.allocations.length, 0);
      assert.equal(state.units[0].unitStatus, 'available');
    });

  }
});

test('requires a staff-approved request and active compatibility attestation before allocation', async (context) => {
  const cases = [
    { requestStatus: 'open', compatibilityApproval: { policyVersion: 'reviewed-v1' } },
    { requestStatus: 'approved', compatibilityApproval: null },
  ];
  for (const [index, options] of cases.entries()) {
    await context.test(`request gate case ${index + 1}`, async () => {
      const { app, state } = createInventoryApp(options);
      const agent = await login(app);
      const response = await agent
        .post(`/api/blood-units/${unitId}/allocate`)
        .set('Origin', clientOrigin)
        .send({ bloodRequestId: requestId });
      assert.equal(response.status, 409);
      assert.equal(state.allocations.length, 0);
      assert.equal(state.units[0].unitStatus, 'available');
    });
  }
});
