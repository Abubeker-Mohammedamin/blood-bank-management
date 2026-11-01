import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  calculateReports,
  csvCell,
  parseDateRange,
  reportsToCsv,
} from '../src/reports/report-routes.js';

const clientOrigin = 'http://localhost:5173';
const sessionSecret = 'reports-test-session-secret-with-at-least-32-bytes';
const staffId = '00000000-0000-4000-8000-000000000301';
const hospitalId = '00000000-0000-4000-8000-000000000302';
const adminId = '00000000-0000-4000-8000-000000000303';
const password = 'reports-test-password';
const reportNow = new Date('2026-10-10T12:00:00.000Z');

function createReportFixtures() {
  const approved = { testType: 'SCREEN', attemptNo: 2, testStatus: 'completed', reviewStatus: 'approved', resultCode: 'PRIVATE' };
  const rejected = { testType: 'SCREEN', attemptNo: 1, testStatus: 'completed', reviewStatus: 'rejected', resultCode: 'PRIVATE' };
  return {
    donations: [
      { id: 'd1', collectedAt: new Date('2026-10-01T10:00:00Z'), volumeMl: 450 },
      { id: 'd2', collectedAt: new Date('2026-10-03T10:00:00Z'), volumeMl: 500 },
    ],
    units: [
      {
        id: 'u1',
        componentType: 'red_cells',
        unitStatus: 'available',
        expiresAt: new Date('2099-12-01T00:00:00Z'),
        donation: { bloodType: { bloodType: { code: 'A+', aboGroup: 'A', rhFactor: '+' } } },
        laboratoryTests: [rejected, approved],
      },
      {
        id: 'u2',
        componentType: 'red_cells',
        unitStatus: 'expired',
        expiresAt: new Date('2026-10-05T00:00:00Z'),
        donation: { bloodType: { bloodType: { code: 'A+', aboGroup: 'A', rhFactor: '+' } } },
        laboratoryTests: [rejected],
      },
      {
        id: 'u3',
        componentType: 'plasma',
        unitStatus: 'quarantined',
        expiresAt: new Date('2099-12-10T00:00:00Z'),
        donation: { bloodType: { bloodType: { code: 'O-', aboGroup: 'O', rhFactor: '-' } } },
        laboratoryTests: [],
      },
    ],
    requests: [
      { id: 'r1', requestStatus: 'fulfilled', requestedAt: new Date('2026-10-02T10:00:00Z') },
      { id: 'r2', requestStatus: 'open', requestedAt: new Date('2026-10-03T10:00:00Z') },
    ],
    requestStatusChanges: [{ changedAt: new Date('2026-10-04T09:00:00Z') }],
    dispatches: [{ id: 'dispatch1', dispatchedAt: new Date('2026-10-04T10:00:00Z') }],
    movements: [{ id: 'move1', movedAt: new Date('2026-10-04T11:00:00Z') }],
  };
}

function reportFixture() {
  return calculateReports({
    ...createReportFixtures(),
    eligibleAvailableUnits: 3,
    eligibleByGroupComponent: { 'A+|red_cells': 1 },
    startDate: '2026-10-01',
    endDate: '2026-10-03',
    now: reportNow,
  });
}

function createReportApp({ role = 'STAFF' } = {}) {
  const userId = role === 'ADMIN' ? adminId : staffId;
  const user = {
    id: userId,
    email: `${role.toLowerCase()}@example.test`,
    displayName: `${role} user`,
    passwordHash: bcrypt.hashSync(password, 4),
    accountStatus: 'active',
    disabledAt: null,
    roleAssignments: [{ role: { code: role } }],
    donorProfile: null,
    staffProfile: role === 'STAFF'
      ? { id: 'staff-profile', hospitalId, staffStatus: 'active', hospital: { isActive: true } }
      : null,
    hospitalMemberships: [],
  };
  const fixtures = createReportFixtures();
  const calls = {};
  const prisma = {
    user: {
      findFirst: async () => user,
      findUnique: async () => user,
    },
    donation: {
      findMany: async (args) => {
        calls.donations = args;
        return fixtures.donations;
      },
    },
    bloodUnit: {
      findMany: async (args) => {
        if (args.where.AND.some((filter) => filter.unitStatus)) {
          calls.currentUnits = args;
          return fixtures.units;
        }
        calls.units = args;
        return fixtures.units;
      },
    },
    bloodRequest: {
      findMany: async (args) => {
        calls.requests = args;
        return fixtures.requests;
      },
    },
    bloodRequestStatusHistory: {
      findMany: async (args) => {
        calls.requestStatusChanges = args;
        return fixtures.requestStatusChanges;
      },
    },
    bloodDispatch: {
      findMany: async (args) => {
        calls.dispatches = args;
        return fixtures.dispatches;
      },
    },
    bloodUnitMovement: {
      findMany: async (args) => {
        calls.movements = args;
        return fixtures.movements;
      },
    },
  };
  return {
    app: createApp({
      prisma,
      sessionSecret,
      clientOrigin,
      bloodUnitRequiredTestTypes: 'SCREEN',
    }),
    calls,
    role,
  };
}

async function login(app, role) {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/auth/login')
    .set('Origin', clientOrigin)
    .send({ email: `${role.toLowerCase()}@example.test`, password });
  assert.equal(response.status, 200);
  return agent;
}

test('parses valid inclusive date ranges and rejects invalid or overlong ranges', () => {
  assert.deepEqual(parseDateRange({ startDate: '2026-10-01', endDate: '2026-10-03' }), {
    start: new Date('2026-10-01T00:00:00.000Z'),
    endExclusive: new Date('2026-10-04T00:00:00.000Z'),
    startDate: '2026-10-01',
    endDate: '2026-10-03',
    days: 3,
  });
  assert.equal(parseDateRange({ startDate: '2026-02-30', endDate: '2026-03-01' }), null);
  assert.equal(parseDateRange({ startDate: '2025-01-01', endDate: '2026-01-02' }), null);
});

test('calculates report metrics from a known synthetic dataset', () => {
  const reports = reportFixture();
  assert.deepEqual(reports.donationTrends, [
    { date: '2026-10-01', donations: 1, volumeMl: 450 },
    { date: '2026-10-02', donations: 0, volumeMl: 0 },
    { date: '2026-10-03', donations: 1, volumeMl: 500 },
  ]);
  assert.deepEqual(reports.bloodGroupComponentDistribution, [
    {
      bloodGroup: 'A+',
      componentType: 'red_cells',
      totalUnits: 2,
      available: 1,
      releaseEligibleAvailable: 1,
      quarantined: 0,
      reserved: 0,
      issued: 0,
      expired: 1,
      discarded: 0,
    },
    {
      bloodGroup: 'O-',
      componentType: 'plasma',
      totalUnits: 1,
      available: 0,
      releaseEligibleAvailable: 0,
      quarantined: 1,
      reserved: 0,
      issued: 0,
      expired: 0,
      discarded: 0,
    },
  ]);
  assert.deepEqual(reports.inventoryTurnover, {
    dispatchedUnits: 1,
    eligibleAvailableUnits: 3,
    turnoverRatio: 0.25,
  });
  assert.deepEqual(reports.requestFulfillment, {
    submittedRequests: 2,
    currentStatusCounts: [{ status: 'fulfilled', count: 1 }, { status: 'open', count: 1 }],
    fulfilledRequests: 1,
    fulfillmentRatePercent: 50,
    dispatchesInPeriod: 1,
  });
  assert.deepEqual(reports.expiredOrRejectedUnits, { expiredUnits: 1, rejectedUnits: 1 });
  assert.equal(reports.operationalActivity.reduce((sum, item) => sum + item.count, 0), 7);
});

test('CSV cells quote fields and neutralize spreadsheet formula prefixes', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell('  @SUM(A1:A2)'), '"\'  @SUM(A1:A2)"');
  assert.equal(csvCell('plain "value"'), '"plain ""value"""');
  const csv = reportsToCsv({
    ...reportFixture(),
    bloodGroupComponentDistribution: [{
      bloodGroup: '=IMPORT',
      componentType: '@component',
      totalUnits: 1,
      available: 0,
      releaseEligibleAvailable: 0,
      quarantined: 0,
      reserved: 0,
      issued: 0,
      expired: 0,
      discarded: 1,
    }],
  });
  assert.match(csv, /"'=IMPORT\|@component"/);
  assert.doesNotMatch(csv, /donor@example\.test|PRIVATE|DONATION-OWNER/);
});

test('staff report API applies active hospital scope and returns aggregate-only data', async () => {
  const { app, calls } = createReportApp();
  const agent = await login(app, 'STAFF');
  const response = await agent.get('/api/reports?startDate=2026-10-01&endDate=2026-10-03');

  assert.equal(response.status, 200);
  assert.equal(response.body.donationTrends.length, 3);
  assert.equal(response.body.bloodGroupComponentDistribution[0].releaseEligibleAvailable, 1);
  assert.equal(response.body.inventoryTurnover.eligibleAvailableUnits, 1);
  assert.deepEqual(calls.donations.where.AND[0], { hospitalId: { in: [hospitalId] } });
  assert.deepEqual(calls.units.where.AND[0], { donation: { hospitalId: { in: [hospitalId] } } });
  assert.deepEqual(calls.requests.where.AND[0], { hospitalId: { in: [hospitalId] } });
  assert.deepEqual(calls.requestStatusChanges.where.AND[1], { bloodRequest: { hospitalId: { in: [hospitalId] } } });
  assert.equal('donor' in calls.units.select, false);
  assert.equal('requestDetails' in calls.requests.select, false);
  assert.equal('actor' in calls.movements.select, false);
  assert.equal(JSON.stringify(response.body).includes('PRIVATE'), false);
});

test('report export requires staff permissions and validates dates before querying records', async () => {
  const staff = createReportApp();
  const staffAgent = await login(staff.app, 'STAFF');
  const invalidRange = await staffAgent.get('/api/reports?startDate=bad&endDate=2026-10-03');
  assert.equal(invalidRange.status, 400);
  assert.equal(staff.calls.donations, undefined);
  const csv = await staffAgent.get('/api/reports/export.csv?startDate=2026-10-01&endDate=2026-10-03');
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /^"report","date","category","metric","value"/);

  const donor = createReportApp({ role: 'DONOR' });
  const donorAgent = await login(donor.app, 'DONOR');
  assert.equal((await donorAgent.get('/api/reports')).status, 403);
  assert.equal((await donorAgent.get('/api/reports/export.csv')).status, 403);
});
