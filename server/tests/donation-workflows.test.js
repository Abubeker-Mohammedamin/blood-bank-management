import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';

const clientOrigin = 'http://localhost:5173';
const sessionSecret = 'workflow-test-secret-with-at-least-32-bytes';
const adminId = '00000000-0000-4000-8000-000000000001';
const hospitalId = '00000000-0000-4000-8000-000000000002';
const donorId = '00000000-0000-4000-8000-000000000003';
const staffId = '00000000-0000-4000-8000-000000000004';
const unitId = '00000000-0000-4000-8000-000000000005';
const bloodTypeId = '00000000-0000-4000-8000-000000000006';
const password = 'correct-password';

function createWorkflowApp({ role = 'ADMIN', requiredTestTypes = [] } = {}) {
  const passwordHash = bcrypt.hashSync(password, 4);
  const user = {
    id: adminId,
    email: 'operator@example.test',
    displayName: 'Test Operator',
    passwordHash,
    accountStatus: 'active',
    disabledAt: null,
    roleAssignments: [{ role: { code: role } }],
    donorProfile: role === 'DONOR' ? { id: donorId } : null,
    staffProfile: role === 'STAFF'
      ? { id: staffId, hospitalId, staffStatus: 'active', hospital: { isActive: true } }
      : null,
    hospitalMemberships: [],
  };
  const state = {
    donation: null,
    units: [],
    tests: [],
    audits: [],
    nextId: 10,
  };
  const nextId = () => `00000000-0000-4000-8000-${String(state.nextId++).padStart(12, '0')}`;
  const prisma = {
    user: {
      findFirst: async () => user,
      findUnique: async () => user,
    },
    hospital: {
      findFirst: async () => ({ id: hospitalId }),
    },
    donor: {
      findFirst: async () => ({ id: donorId }),
    },
    staff: {
      findFirst: async () => ({ id: staffId }),
    },
    storageLocation: {
      findMany: async () => [],
    },
    donation: {
      create: async ({ data, include }) => {
        state.donation = {
          id: nextId(),
          donationNumber: data.donationNumber,
          donorId: data.donorId,
          hospitalId: data.hospitalId,
          collectedByStaffId: data.collectedByStaffId,
          collectedAt: data.collectedAt,
          volumeMl: data.volumeMl,
          donationStatus: data.donationStatus,
        };
        state.units = data.bloodUnits.create.map((unit) => ({
          id: nextId(),
          donationId: state.donation.id,
          ...unit,
        }));
        return {
          ...state.donation,
          ...(include?.bloodUnits ? { bloodUnits: state.units } : {}),
        };
      },
      findMany: async () => state.donation ? [state.donation] : [],
      count: async () => (state.donation ? 1 : 0),
      findFirst: async () => state.donation,
      findUnique: async () => state.donation,
    },
    bloodUnit: {
      findFirst: async ({ where }) => {
        const id = where.AND?.find((item) => item.id)?.id || where.id;
        const unit = state.units.find((item) => item.id === id);
        if (!unit) return null;
        return { ...unit, donation: { hospitalId } };
      },
      findUnique: async ({ where }) => {
        const unit = state.units.find((item) => item.id === where.id);
        if (!unit) return null;
        return {
          ...unit,
          expiresAt: unit.expiresAt || new Date('2036-05-15T10:00:00.000Z'),
          donation: {
            bloodType: unit.bloodGroupConfirmed === false ? null : { bloodTypeId },
          },
        };
      },
      findMany: async () => state.units,
      count: async () => state.units.length,
      update: async ({ where, data }) => {
        const unit = state.units.find((item) => item.id === where.id);
        Object.assign(unit, data);
        return unit;
      },
    },
    laboratoryTest: {
      findMany: async ({ where }) => state.tests.filter((item) => (
        !where?.bloodUnitId || item.bloodUnitId === where.bloodUnitId
      )),
      count: async () => state.tests.length,
      findFirst: async ({ where }) => {
        if (where.AND) {
          return state.tests.find((item) => item.id === where.AND[0].id) || null;
        }
        return state.tests
          .filter((item) => item.donationId === where.donationId && item.testType === where.testType)
          .sort((left, right) => right.attemptNo - left.attemptNo)[0] || null;
      },
      findUnique: async ({ where }) => {
        const record = state.tests.find((item) => item.id === where.id);
        return record ? { ...record, donation: { hospitalId } } : null;
      },
      create: async ({ data }) => {
        const record = { id: nextId(), recordedAt: new Date(), ...data };
        state.tests.push(record);
        return record;
      },
      update: async ({ where, data }) => {
        const record = state.tests.find((item) => item.id === where.id);
        Object.assign(record, data);
        return record;
      },
      updateMany: async ({ where, data }) => {
        const record = state.tests.find((item) => item.id === where.id && item.reviewStatus === where.reviewStatus);
        if (!record) return { count: 0 };
        Object.assign(record, data);
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }) => {
        state.audits.push(data);
        return data;
      },
    },
    $queryRawUnsafe: async () => [],
    $transaction: async (callback) => callback(prisma),
  };
  const app = createApp({
    prisma,
    sessionSecret,
    clientOrigin,
    bloodUnitRequiredTestTypes: requiredTestTypes,
  });
  return { app, state };
}

async function login(app) {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/auth/login')
    .set('Origin', clientOrigin)
    .send({ email: 'operator@example.test', password });
  assert.equal(response.status, 200);
  return agent;
}

function donationData(overrides = {}) {
  return {
    donationNumber: 'donation-0001',
    donorId,
    hospitalId,
    collectedByStaffId: staffId,
    collectedAt: '2026-04-15T10:00:00.000Z',
    volumeMl: 450,
    units: [{
      unitCode: 'unit-0001',
      componentType: 'whole_blood',
      expiresAt: '2036-05-15T10:00:00.000Z',
    }],
    ...overrides,
  };
}

test('requires authentication and denies donors access to laboratory records', async () => {
  const adminApp = createWorkflowApp();
  const unauthenticated = await request(adminApp.app).get('/api/laboratory-tests');
  assert.equal(unauthenticated.status, 401);

  const donorApp = createWorkflowApp({ role: 'DONOR' });
  const donorAgent = await login(donorApp.app);
  const response = await donorAgent.get('/api/laboratory-tests').set('Origin', clientOrigin);
  assert.equal(response.status, 403);

  const hospitalApp = createWorkflowApp({ role: 'HOSPITAL' });
  const hospitalAgent = await login(hospitalApp.app);
  const hospitalResponse = await hospitalAgent.get('/api/laboratory-tests').set('Origin', clientOrigin);
  assert.equal(hospitalResponse.status, 403);
});

test('prevents staff from recording a collection at another facility', async () => {
  const { app, state } = createWorkflowApp({ role: 'STAFF' });
  const agent = await login(app);
  const response = await agent
    .post('/api/donations')
    .set('Origin', clientOrigin)
    .send(donationData({ hospitalId: '00000000-0000-4000-8000-000000000099' }));

  assert.equal(response.status, 403);
  assert.equal(state.donation, null);
});

test('validates collection data and rejects invalid expiry dates before writing', async () => {
  const { app, state } = createWorkflowApp();
  const agent = await login(app);
  const response = await agent
    .post('/api/donations')
    .set('Origin', clientOrigin)
    .send(donationData({
      units: [{
        unitCode: 'UNIT-0001',
        componentType: 'whole_blood',
        expiresAt: '2026-04-14T10:00:00.000Z',
      }],
    }));

  assert.equal(response.status, 400);
  assert.equal(state.donation, null);
});

test('records a donation and creates its units in quarantine with traceable identifiers', async () => {
  const { app, state } = createWorkflowApp();
  const agent = await login(app);
  const response = await agent
    .post('/api/donations')
    .set('Origin', clientOrigin)
    .send(donationData());

  assert.equal(response.status, 201);
  assert.equal(response.body.donation.donationNumber, 'DONATION-0001');
  assert.equal(response.body.donation.bloodUnits[0].unitStatus, 'quarantined');
  assert.equal(response.body.donation.bloodUnits[0].unitCode, 'UNIT-0001');
  assert.equal(state.audits.length, 2);
  assert.equal(state.audits.some((entry) => JSON.stringify(entry).includes('resultCode')), false);
});

test('rejects duplicate unit identifiers within a collection request', async () => {
  const { app, state } = createWorkflowApp();
  const agent = await login(app);
  const unit = donationData().units[0];
  const response = await agent
    .post('/api/donations')
    .set('Origin', clientOrigin)
    .send(donationData({ units: [unit, { ...unit, unitCode: unit.unitCode.toUpperCase() }] }));

  assert.equal(response.status, 400);
  assert.equal(state.donation, null);
});

test('requires configured test review before a unit can be released', async () => {
  const { app, state } = createWorkflowApp({ requiredTestTypes: ['SCREEN_A'] });
  const agent = await login(app);
  await agent.post('/api/donations').set('Origin', clientOrigin).send(donationData());
  const id = state.units[0].id;

  const response = await agent.post(`/api/blood-units/${id}/release`).set('Origin', clientOrigin);
  assert.equal(response.status, 409);
  assert.equal(state.units[0].unitStatus, 'quarantined');
});

test('records, reviews, and releases only after configured tests pass', async () => {
  const { app, state } = createWorkflowApp({ requiredTestTypes: ['SCREEN_A'] });
  const agent = await login(app);
  await agent.post('/api/donations').set('Origin', clientOrigin).send(donationData());
  const id = state.units[0].id;
  const testResponse = await agent
    .post('/api/laboratory-tests')
    .set('Origin', clientOrigin)
    .send({
      bloodUnitId: id,
      testType: 'screen_a',
      testStatus: 'completed',
      resultCode: 'RECORDED_RESULT',
      performedAt: '2026-04-15T11:00:00.000Z',
      performedByStaffId: staffId,
    });

  assert.equal(testResponse.status, 201);
  assert.equal(testResponse.body.test.reviewStatus, 'pending');
  const laboratoryAudit = state.audits.find((entry) => entry.action === 'laboratory_test.recorded');
  assert.deepEqual(laboratoryAudit.changedFields, ['bloodUnitId', 'attemptNo', 'testStatus', 'reviewStatus', 'performedAt']);
  assert.equal(JSON.stringify(laboratoryAudit).includes('RECORDED_RESULT'), false);
  const reviewResponse = await agent
    .patch(`/api/laboratory-tests/${testResponse.body.test.id}/review`)
    .set('Origin', clientOrigin)
    .send({ reviewStatus: 'approved', reviewedByStaffId: staffId });
  assert.equal(reviewResponse.status, 200);

  const releaseResponse = await agent
    .post(`/api/blood-units/${id}/release`)
    .set('Origin', clientOrigin);
  assert.equal(releaseResponse.status, 200);
  assert.equal(releaseResponse.body.unit.unitStatus, 'available');
  assert.equal(state.audits.some((entry) => entry.action === 'blood_unit.released'), true);

  const labRead = await agent.get('/api/laboratory-tests');
  assert.equal(labRead.status, 200);
  const sensitiveRead = state.audits.find((entry) => entry.action === 'laboratory_test.viewed');
  assert.equal(sensitiveRead.entityId, testResponse.body.test.id);
  assert.deepEqual(sensitiveRead.metadata, { accessScope: 'laboratory_test' });
  assert.equal(JSON.stringify(sensitiveRead).includes('RECORDED_RESULT'), false);
});

test('prevents releasing an expired unit even when configured tests are approved', async () => {
  const { app, state } = createWorkflowApp({ requiredTestTypes: ['SCREEN_A'] });
  const agent = await login(app);
  await agent.post('/api/donations').set('Origin', clientOrigin).send(donationData());
  state.units[0].expiresAt = new Date('2000-01-01T00:00:00.000Z');

  const response = await agent
    .post(`/api/blood-units/${state.units[0].id}/release`)
    .set('Origin', clientOrigin);

  assert.equal(response.status, 409);
  assert.equal(state.units[0].unitStatus, 'quarantined');
});

test('prevents releasing a unit without a confirmed blood group', async () => {
  const { app, state } = createWorkflowApp({ requiredTestTypes: ['SCREEN_A'] });
  const agent = await login(app);
  await agent.post('/api/donations').set('Origin', clientOrigin).send(donationData());
  state.units[0].bloodGroupConfirmed = false;

  const response = await agent
    .post(`/api/blood-units/${state.units[0].id}/release`)
    .set('Origin', clientOrigin);

  assert.equal(response.status, 409);
  assert.equal(state.units[0].unitStatus, 'quarantined');
});

test('does not allow failed laboratory results to be approved or released', async () => {
  const { app, state } = createWorkflowApp({ requiredTestTypes: ['SCREEN_A'] });
  const agent = await login(app);
  await agent.post('/api/donations').set('Origin', clientOrigin).send(donationData());
  const testResponse = await agent
    .post('/api/laboratory-tests')
    .set('Origin', clientOrigin)
    .send({
      bloodUnitId: state.units[0].id,
      testType: 'SCREEN_A',
      testStatus: 'failed',
      resultCode: 'RECORDED_RESULT',
      performedAt: '2026-04-15T11:00:00.000Z',
      performedByStaffId: staffId,
    });

  assert.equal(testResponse.status, 201);
  const reviewResponse = await agent
    .patch(`/api/laboratory-tests/${testResponse.body.test.id}/review`)
    .set('Origin', clientOrigin)
    .send({ reviewStatus: 'approved', reviewedByStaffId: staffId });
  assert.equal(reviewResponse.status, 409);

  const releaseResponse = await agent
    .post(`/api/blood-units/${state.units[0].id}/release`)
    .set('Origin', clientOrigin);
  assert.equal(releaseResponse.status, 409);
  assert.equal(state.units[0].unitStatus, 'quarantined');
});

test('allows an approved later attempt to supersede a failed attempt without deleting history', async () => {
  const { app, state } = createWorkflowApp({ requiredTestTypes: ['SCREEN_A'] });
  const agent = await login(app);
  await agent.post('/api/donations').set('Origin', clientOrigin).send(donationData());
  const failed = await agent
    .post('/api/laboratory-tests')
    .set('Origin', clientOrigin)
    .send({
      bloodUnitId: state.units[0].id,
      testType: 'SCREEN_A',
      testStatus: 'failed',
      resultCode: 'RECORDED_RESULT',
      performedAt: '2026-04-15T11:00:00.000Z',
      performedByStaffId: staffId,
    });
  await agent
    .patch(`/api/laboratory-tests/${failed.body.test.id}/review`)
    .set('Origin', clientOrigin)
    .send({ reviewStatus: 'rejected', reviewedByStaffId: staffId });

  const completed = await agent
    .post('/api/laboratory-tests')
    .set('Origin', clientOrigin)
    .send({
      bloodUnitId: state.units[0].id,
      testType: 'SCREEN_A',
      testStatus: 'completed',
      resultCode: 'RECORDED_RESULT',
      performedAt: '2026-04-15T12:00:00.000Z',
      performedByStaffId: staffId,
    });
  assert.equal(completed.status, 201);
  assert.equal(completed.body.test.attemptNo, 2);
  await agent
    .patch(`/api/laboratory-tests/${completed.body.test.id}/review`)
    .set('Origin', clientOrigin)
    .send({ reviewStatus: 'approved', reviewedByStaffId: staffId });

  const release = await agent.post(`/api/blood-units/${state.units[0].id}/release`).set('Origin', clientOrigin);
  assert.equal(release.status, 200);
  assert.equal(state.tests.length, 2);
  assert.equal(state.units[0].unitStatus, 'available');
});
