import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';

const clientOrigin = 'http://localhost:5173';
const sessionSecret = 'test-session-secret-with-at-least-32-bytes';
const userId = '00000000-0000-4000-8000-000000000001';
const donorId = '00000000-0000-4000-8000-000000000002';
const hospitalId = '00000000-0000-4000-8000-000000000003';
const otherDonorId = '00000000-0000-4000-8000-000000000004';
const testPassword = 'correct-password';

function makeDonor({ id = donorId, ownerId = userId, registrationHospitalId = hospitalId } = {}) {
  return {
    id,
    userId: ownerId,
    donorNumber: 'DON-0123456789ABCDEF',
    registrationHospitalId,
    dateOfBirth: new Date('1990-01-15T00:00:00.000Z'),
    donorStatus: 'registered',
    eligibilityReviewedAt: null,
    consentGivenAt: null,
    consentVersion: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    user: {
      id: ownerId,
      displayName: 'Alex Example',
      email: 'alex@example.test',
      phoneE164: '+15551234567',
    },
    _count: { donations: 1 },
    donations: [{
      donationNumber: 'DONATION-001',
      collectedAt: new Date('2026-01-02T00:00:00.000Z'),
      donationStatus: 'released',
    }],
  };
}

function createDonorTestApp({
  role = 'STAFF',
  donor = makeDonor(),
  matchingDonor = true,
  databaseOverrides = {},
} = {}) {
  const passwordHash = bcrypt.hashSync(testPassword, 4);
  const user = {
    id: userId,
    email: 'alex@example.test',
    displayName: 'Alex Example',
    passwordHash,
    accountStatus: 'active',
    disabledAt: null,
    roleAssignments: [{ role: { code: role } }],
    donorProfile: role === 'DONOR' ? { id: donor.id } : null,
    staffProfile: role === 'STAFF'
      ? {
        hospitalId,
        staffStatus: 'active',
        hospital: { isActive: true },
      }
      : null,
    hospitalMemberships: [],
  };
  const calls = {};
  const prisma = {
    user: {
      findFirst: async () => user,
      findUnique: async () => user,
      create: async (args) => {
        calls.userCreate = args;
        if (databaseOverrides.userCreateError) throw databaseOverrides.userCreateError;
        return {
          id: '00000000-0000-4000-8000-000000000010',
          displayName: args.data.displayName,
          email: args.data.email,
          phoneE164: args.data.phoneE164,
          donorProfile: {
            id: '00000000-0000-4000-8000-000000000011',
            donorNumber: args.data.donorProfile.create.donorNumber,
            dateOfBirth: args.data.donorProfile.create.dateOfBirth,
            _count: { donations: 0 },
          },
        };
      },
      update: async (args) => {
        calls.userUpdate = args;
        return { ...user, ...args.data };
      },
    },
    role: {
      upsert: async ({ where, create }) => ({
        id: '00000000-0000-4000-8000-000000000012',
        code: where.code,
        name: create.name,
      }),
    },
    donor: {
      findMany: async (args) => {
        calls.donorFindMany = args;
        return [donor];
      },
      count: async (args) => {
        calls.donorCount = args;
        return 1;
      },
      findFirst: async (args) => {
        calls.donorFindFirst = args;
        return matchingDonor ? donor : null;
      },
      findUnique: async (args) => {
        calls.donorFindUnique = args;
        return donor;
      },
      create: async (args) => {
        calls.donorCreate = args;
        if (databaseOverrides.donorCreateError) throw databaseOverrides.donorCreateError;
        return { ...donor, dateOfBirth: args.data.dateOfBirth };
      },
      update: async (args) => {
        calls.donorUpdate = args;
        if (databaseOverrides.donorUpdateError) throw databaseOverrides.donorUpdateError;
        return {
          ...donor,
          ...args.data,
          user: { ...donor.user, ...(calls.userUpdate?.data || {}) },
        };
      },
    },
    donation: {
      findMany: async (args) => {
        calls.donationFindMany = args;
        return [{
          id: '00000000-0000-4000-8000-000000000020',
          donationNumber: 'DONATION-001',
          donationStatus: 'released',
          collectedAt: new Date('2026-01-02T00:00:00.000Z'),
          volumeMl: 450,
        }];
      },
    },
    auditLog: {
      create: async ({ data }) => {
        calls.auditEvents = [...(calls.auditEvents || []), data];
        return data;
      },
    },
    $transaction: async (callback) => callback(prisma),
  };
  const app = createApp({ prisma, sessionSecret, clientOrigin });
  return { app, calls, user, donor };
}

async function login(app) {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/auth/login')
    .set('Origin', clientOrigin)
    .send({ email: 'alex@example.test', password: testPassword });
  assert.equal(response.status, 200);
  return agent;
}

test('rejects invalid donor registration data without writing a record', async () => {
  const { app, calls } = createDonorTestApp();
  const agent = await login(app);
  const response = await agent
    .post('/api/donors')
    .set('Origin', clientOrigin)
    .send({ displayName: '', email: 'not-an-email' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_DONOR_DATA');
  assert.equal(calls.userCreate, undefined);
});

test('creates a donor account, donor profile, and generated ID for authorized staff', async () => {
  const { app, calls } = createDonorTestApp();
  const agent = await login(app);
  const response = await agent
    .post('/api/donors')
    .set('Origin', clientOrigin)
    .send({
      displayName: 'New Donor',
      email: ' New.Donor@Example.Test ',
      phoneE164: '+15551234567',
      dateOfBirth: '1995-02-28',
    });

  assert.equal(response.status, 201);
  assert.match(response.body.donor.donorNumber, /^DON-[0-9A-F]{32}$/);
  assert.equal(response.body.donor.user.email, 'new.donor@example.test');
  assert.equal(calls.userCreate.data.donorProfile.create.registrationHospitalId, hospitalId);
  assert.equal(calls.userCreate.data.passwordHash, undefined);
  assert.equal(
    calls.userCreate.data.roleAssignments.create.role.connect.id,
    '00000000-0000-4000-8000-000000000012',
  );
  assert.equal(calls.auditEvents.some((entry) => entry.action === 'account.donor_created'), true);
  assert.equal(calls.auditEvents.some((entry) => entry.action === 'permission.role_assigned'), true);
});

test('administrator access does not require or imply a staff hospital assignment', async () => {
  const { app, calls, user } = createDonorTestApp();
  user.roleAssignments.unshift({ role: { code: 'ADMIN' } });
  const agent = await login(app);
  const response = await agent
    .post('/api/donors')
    .set('Origin', clientOrigin)
    .send({ displayName: 'Admin Registered Donor', email: 'admin.created@example.test' });

  assert.equal(response.status, 201);
  assert.equal(calls.userCreate.data.donorProfile.create.registrationHospitalId, null);
});

test('rejects duplicate email or donor profiles without overwriting existing records', async () => {
  const duplicateError = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  const { app } = createDonorTestApp({ databaseOverrides: { userCreateError: duplicateError } });
  const agent = await login(app);
  const response = await agent
    .post('/api/donors')
    .set('Origin', clientOrigin)
    .send({ displayName: 'Existing Person', email: 'alex@example.test' });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'DONOR_ALREADY_EXISTS');
});

test('paginates and searches only within the authenticated staff hospital scope', async () => {
  const { app, calls } = createDonorTestApp();
  const agent = await login(app);
  const response = await agent.get('/api/donors?page=2&pageSize=10&search=alex&status=registered');

  assert.equal(response.status, 200);
  assert.equal(response.body.pagination.page, 2);
  assert.equal(response.body.pagination.pageSize, 10);
  assert.equal(response.body.pagination.totalItems, 1);
  assert.deepEqual(calls.donorFindMany.where.AND[0], {
    OR: [
      { registrationHospitalId: { in: [hospitalId] } },
      { appointments: { some: { hospitalId: { in: [hospitalId] } } } },
      { donations: { some: { hospitalId: { in: [hospitalId] } } } },
    ],
  });
  assert.deepEqual(calls.donorFindMany.where.AND[1], { donorStatus: 'registered' });
  assert.equal(calls.donorFindMany.skip, 10);
  assert.equal(response.body.donors[0].donorStatus, 'registered');
  assert.equal(response.body.donors[0].eligibilityReviewedAt, null);
});

test('restricts donors to their own profile and hides staff screening metadata', async () => {
  const ownDonor = makeDonor({ ownerId: userId });
  const { app, calls } = createDonorTestApp({ role: 'DONOR', donor: ownDonor });
  const agent = await login(app);
  const response = await agent.get(`/api/donors/${donorId}`);

  assert.equal(response.status, 200);
  assert.deepEqual(calls.donorFindFirst.where.AND, [
    { id: donorId },
    { userId },
  ]);
  assert.equal('donorStatus' in response.body.donor, false);
  assert.equal('eligibilityReviewedAt' in response.body.donor, false);

  const otherDonorResponse = await createDonorTestApp({
    role: 'DONOR',
    donor: ownDonor,
    matchingDonor: false,
  });
  const otherAgent = await login(otherDonorResponse.app);
  const denied = await otherAgent.get(`/api/donors/${otherDonorId}`);
  assert.equal(denied.status, 404);
  assert.equal(denied.body.error.code, 'RECORD_NOT_FOUND');
});

test('denies hospital users access to donor records even with a valid session', async () => {
  const { app } = createDonorTestApp({ role: 'HOSPITAL' });
  const agent = await login(app);
  const response = await agent.get('/api/donors');
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
});

test('donors cannot infer restricted screening status through list filters', async () => {
  const { app, calls } = createDonorTestApp({ role: 'DONOR' });
  const agent = await login(app);
  const response = await agent.get('/api/donors?status=deferred');

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
  assert.equal(calls.donorFindMany, undefined);
});

test('donors may edit contact details but cannot change protected screening fields', async () => {
  const { app, calls } = createDonorTestApp({ role: 'DONOR' });
  const agent = await login(app);
  const denied = await agent
    .put(`/api/donors/${donorId}`)
    .set('Origin', clientOrigin)
    .send({ donorStatus: 'active' });

  assert.equal(denied.status, 400);
  assert.equal(calls.donorUpdate, undefined);

  const allowed = await agent
    .put(`/api/donors/${donorId}`)
    .set('Origin', clientOrigin)
    .send({ displayName: 'Updated Name', phoneE164: '+15557654321', dateOfBirth: '1990-01-15' });

  assert.equal(allowed.status, 200);
  assert.equal(calls.userUpdate.data.displayName, 'Updated Name');
  assert.equal(calls.userUpdate.data.phoneE164, '+15557654321');
  assert.equal('donorStatus' in calls.donorUpdate.data, false);
});

test('staff may update restricted screening metadata without applying eligibility rules', async () => {
  const { app, calls } = createDonorTestApp();
  const agent = await login(app);
  const response = await agent
    .put(`/api/donors/${donorId}`)
    .set('Origin', clientOrigin)
    .send({
      donorStatus: 'deferred',
      eligibilityReviewedAt: '2026-10-29T10:00:00.000Z',
      consentGivenAt: '2026-10-28T10:00:00.000Z',
      consentVersion: 'consent-v2',
    });

  assert.equal(response.status, 200);
  assert.equal(calls.donorUpdate.data.donorStatus, 'deferred');
  assert.equal(calls.donorUpdate.data.eligibilityReviewedAt.toISOString(), '2026-10-29T10:00:00.000Z');
  assert.equal(response.body.donor.donorStatus, 'deferred');
  const donorAudit = calls.auditEvents.find((entry) => entry.action === 'donor.profile_updated');
  assert.deepEqual(donorAudit.changedFields, ['donor_screening_metadata']);
  assert.deepEqual(donorAudit.metadata, { changeCategory: 'donor_screening_metadata' });
});

test('returns donation history scoped to the authorized donor profile', async () => {
  const { app, calls } = createDonorTestApp();
  const agent = await login(app);
  const response = await agent.get(`/api/donors/${donorId}/donations`);

  assert.equal(response.status, 200);
  assert.equal(calls.donationFindMany.where.donorId, donorId);
  assert.equal(response.body.donations[0].donationNumber, 'DONATION-001');
  assert.equal('testResults' in response.body.donations[0], false);
});

test('validates pagination, filters, UUIDs, and unsupported fields on the server', async () => {
  const { app } = createDonorTestApp();
  const agent = await login(app);

  assert.equal((await agent.get('/api/donors?page=0')).status, 400);
  assert.equal((await agent.get('/api/donors?status=unknown')).status, 400);
  assert.equal((await agent.get('/api/donors/not-a-uuid')).status, 400);
  const unsupportedField = await agent
    .put(`/api/donors/${donorId}`)
    .set('Origin', clientOrigin)
    .send({ accountStatus: 'disabled' });
  assert.equal(unsupportedField.status, 400);
});
