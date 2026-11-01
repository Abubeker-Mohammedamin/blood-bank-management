import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';

const clientOrigin = 'http://localhost:5173';
const sessionSecret = 'portal-test-session-secret-with-at-least-32-bytes';
const donorUserId = '00000000-0000-4000-8000-000000000201';
const donorId = '00000000-0000-4000-8000-000000000202';
const hospitalUserId = '00000000-0000-4000-8000-000000000203';
const hospitalId = '00000000-0000-4000-8000-000000000204';
const otherHospitalId = '00000000-0000-4000-8000-000000000205';
const password = 'portal-test-password';

function createPortalApp({ role, ownerId, profile = true, memberships = [hospitalId] }) {
  const isDonor = role === 'DONOR';
  const donorProfile = profile && isDonor ? { id: donorId } : null;
  const user = {
    id: ownerId,
    email: `${role.toLowerCase()}@example.test`,
    displayName: `${role} user`,
    passwordHash: bcrypt.hashSync(password, 4),
    accountStatus: 'active',
    disabledAt: null,
    roleAssignments: [{ role: { code: role } }],
    donorProfile,
    staffProfile: null,
    hospitalMemberships: memberships.map((id) => ({
      hospitalId: id,
      isActive: true,
      hospital: { isActive: true },
    })),
  };
  const calls = {};
  const profileRecord = {
    id: donorId,
    donorNumber: 'DON-OWNER',
    dateOfBirth: new Date('1990-01-15T00:00:00.000Z'),
    donorStatus: 'active',
    eligibilityReviewedAt: new Date('2026-10-29T10:00:00.000Z'),
    consentGivenAt: new Date('2026-10-28T10:00:00.000Z'),
    consentVersion: 'private-consent',
    user: { displayName: 'Donor Owner', email: 'donor@example.test', phoneE164: '+15551234567' },
  };
  const requestRecords = [
    {
      id: 'request-owner',
      hospitalId,
      requestedByUserId: ownerId,
      requestNumber: 'REQ-OWNER',
      requestStatus: 'partially_fulfilled',
      allocations: [{
        allocationStatus: 'fulfilled',
        dispatch: {
          deliveryStatus: 'delivered',
          finalDisposition: 'transfused',
          statusHistory: [{ newStatus: 'delivered', changedAt: new Date('2026-10-30T12:00:00Z') }],
        },
      }],
    },
    {
      id: 'request-other-user',
      hospitalId,
      requestedByUserId: '00000000-0000-4000-8000-000000000299',
      requestNumber: 'REQ-OTHER-USER',
    },
    {
      id: 'request-other-hospital',
      hospitalId: otherHospitalId,
      requestedByUserId: ownerId,
      requestNumber: 'REQ-OTHER-HOSPITAL',
    },
  ];

  const prisma = {
    auditLog: {
      create: async ({ data }) => {
        calls.auditEvent = data;
        return data;
      },
    },
    user: {
      findFirst: async () => user,
      findUnique: async () => user,
    },
    donor: {
      findFirst: async (args) => {
        calls.donorFindFirst = args;
        return profile ? profileRecord : null;
      },
    },
    donation: {
      findMany: async (args) => {
        calls.donationFindMany = args;
        return [{
          id: 'donation-owner',
          donationNumber: 'DONATION-OWNER',
          donationStatus: 'released',
          collectedAt: new Date('2026-10-01T10:00:00Z'),
          volumeMl: 450,
          hospital: { name: 'Owner Hospital' },
        }];
      },
    },
    appointment: {
      findMany: async (args) => {
        calls.appointmentFindMany = args;
        return [{
          id: 'appointment-owner',
          scheduledStartAt: new Date('2026-12-01T10:00:00Z'),
          scheduledEndAt: new Date('2026-12-01T10:30:00Z'),
          appointmentStatus: 'booked',
          hospital: { name: 'Owner Hospital' },
        }];
      },
    },
    bloodRequest: {
      findMany: async (args) => {
        calls.bloodRequestFindMany = args;
        const [ownershipScope, accountScope] = args.where.AND;
        const hospitalIds = ownershipScope.hospitalId.in;
        return requestRecords.filter((record) => (
          record.requestedByUserId === accountScope.requestedByUserId
          && record.requestedByUserId === ownerId
          && hospitalIds.includes(record.hospitalId)
        ));
      },
      count: async (args) => {
        calls.bloodRequestCount = args;
        const [ownershipScope, accountScope] = args.where.AND;
        return requestRecords.filter((record) => (
          record.requestedByUserId === accountScope.requestedByUserId
          && record.requestedByUserId === ownerId
          && ownershipScope.hospitalId.in.includes(record.hospitalId)
        )).length;
      },
    },
  };
  return {
    app: createApp({ prisma, sessionSecret, clientOrigin }),
    calls,
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

test('donor dashboard reads only the authenticated donor profile and related history', async () => {
  const { app, calls } = createPortalApp({ role: 'DONOR', ownerId: donorUserId });
  const agent = await login(app, 'DONOR');
  const response = await agent.get('/api/portal/donor');

  assert.equal(response.status, 200);
  assert.deepEqual(calls.donorFindFirst.where, { userId: donorUserId });
  assert.equal(calls.donationFindMany.where.donorId, donorId);
  assert.equal(calls.appointmentFindMany.where.donorId, donorId);
  assert.equal(response.body.profile.donorStatus, 'active');
  assert.equal(response.body.profile.eligibilityReviewedAt, '2026-10-29T10:00:00.000Z');
  assert.equal('consentGivenAt' in response.body.profile, false);
  assert.equal('consentVersion' in response.body.profile, false);
  assert.equal('laboratoryTests' in response.body.donations[0], false);
  assert.equal(response.body.appointments[0].appointmentStatus, 'booked');
  assert.equal(calls.auditEvent.action, 'donor.sensitive_information_viewed');
  assert.deepEqual(calls.auditEvent.metadata, { accessScope: 'donor_profile' });
});

test('donor dashboard returns an empty profile without querying another donor history', async () => {
  const { app, calls } = createPortalApp({ role: 'DONOR', ownerId: donorUserId, profile: false });
  const agent = await login(app, 'DONOR');
  const response = await agent.get('/api/portal/donor');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { profile: null, donations: [], appointments: [] });
  assert.equal(calls.donationFindMany, undefined);
  assert.equal(calls.appointmentFindMany, undefined);
});

test('hospital dashboard returns only this account requests at its active member hospitals', async () => {
  const { app, calls } = createPortalApp({ role: 'HOSPITAL', ownerId: hospitalUserId });
  const agent = await login(app, 'HOSPITAL');
  const response = await agent.get('/api/portal/hospital');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.requests.map(({ requestNumber }) => requestNumber), ['REQ-OWNER']);
  assert.equal(response.body.total, 1);
  assert.deepEqual(calls.bloodRequestFindMany.where.AND, [
    { requestedByUserId: hospitalUserId, hospitalId: { in: [hospitalId] } },
    { requestedByUserId: hospitalUserId },
  ]);
  assert.deepEqual(calls.bloodRequestCount.where, calls.bloodRequestFindMany.where);
  assert.equal(response.body.requests[0].allocations[0].dispatch.finalDisposition, 'transfused');
  assert.equal('requestDetails' in calls.bloodRequestFindMany.select, false);
  assert.equal('bloodUnit' in calls.bloodRequestFindMany.select.allocations.select, false);
});

test('donor and hospital dashboards deny access to the other account type', async () => {
  const donor = createPortalApp({ role: 'DONOR', ownerId: donorUserId });
  const donorAgent = await login(donor.app, 'DONOR');
  assert.equal((await donorAgent.get('/api/portal/hospital')).status, 403);

  const hospital = createPortalApp({ role: 'HOSPITAL', ownerId: hospitalUserId });
  const hospitalAgent = await login(hospital.app, 'HOSPITAL');
  assert.equal((await hospitalAgent.get('/api/portal/donor')).status, 403);
});
