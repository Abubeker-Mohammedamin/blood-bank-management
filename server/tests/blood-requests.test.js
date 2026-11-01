import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { validateAttestation, validateCreate } from '../src/workflows/blood-request-routes.js';

const clientOrigin = 'http://localhost:5173';
const sessionSecret = 'blood-request-test-secret-with-at-least-32-bytes';
const userId = '00000000-0000-4000-8000-000000000101';
const hospitalId = '00000000-0000-4000-8000-000000000102';
const bloodTypeId = '00000000-0000-4000-8000-000000000103';
const requestId = '00000000-0000-4000-8000-000000000104';
const staffId = '00000000-0000-4000-8000-000000000106';
const allocationId = '00000000-0000-4000-8000-000000000107';
const unitId = '00000000-0000-4000-8000-000000000108';

async function createHospitalApp({ ownershipLookup } = {}) {
  const user = {
    id: userId,
    email: 'hospital@example.test',
    displayName: 'Hospital Requester',
    passwordHash: await bcrypt.hash('request-test-password', 4),
    accountStatus: 'active',
    disabledAt: null,
    roleAssignments: [{ role: { code: 'HOSPITAL' } }],
    donorProfile: null,
    staffProfile: null,
    hospitalMemberships: [{
      hospitalId,
      isActive: true,
      hospital: { isActive: true },
    }],
  };
  const captured = {};
  const prisma = {
    user: {
      findFirst: async () => user,
      findUnique: async () => user,
    },
    hospital: {
      findFirst: async () => ({ id: hospitalId }),
    },
    bloodType: {
      findUnique: async () => ({ id: bloodTypeId }),
    },
    bloodRequest: {
      findFirst: async ({ where }) => {
        captured.lookup = where;
        return ownershipLookup?.(where) || null;
      },
    },
    $transaction: async (callback) => callback({
      $queryRaw: async () => [],
      bloodRequest: {
        create: async ({ data }) => {
          captured.create = data;
          return {
            id: requestId,
            requestNumber: data.requestNumber,
            requestStatus: data.requestStatus,
            requestedByUserId: data.requestedByUserId,
          };
        },
        findFirst: async ({ where }) => ownershipLookup?.(where) || null,
        update: async ({ where, data }) => {
          captured.cancelUpdate = { where, data };
          return { ...ownershipLookup?.({ id: where.id }), ...data };
        },
      },
      allocation: { count: async () => 0 },
      auditLog: {
        create: async ({ data }) => {
          captured.audit = data;
        },
      },
    }),
  };
  return {
    app: createApp({ prisma, sessionSecret, clientOrigin }),
    captured,
    user,
  };
}

async function login(app, email = 'hospital@example.test') {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/auth/login')
    .set('Origin', clientOrigin)
    .send({ email, password: 'request-test-password' });
  assert.equal(response.status, 200);
  return agent;
}

async function createDispatchApp() {
  const user = {
    id: userId,
    email: 'hospital@example.test',
    displayName: 'Dispatch Operator',
    passwordHash: await bcrypt.hash('request-test-password', 4),
    accountStatus: 'active',
    disabledAt: null,
    roleAssignments: [{ role: { code: 'STAFF' } }],
    donorProfile: null,
    staffProfile: {
      id: staffId,
      hospitalId,
      staffStatus: 'active',
      hospital: { isActive: true },
    },
    hospitalMemberships: [],
  };
  const state = {
    request: {
      id: requestId,
      hospitalId,
      requestStatus: 'partially_fulfilled',
      quantityRequested: 1,
      closedAt: null,
    },
    allocation: {
      id: allocationId,
      bloodRequestId: requestId,
      bloodUnitId: unitId,
      allocationStatus: 'reserved',
      dispatch: null,
      bloodUnit: {
        id: unitId,
        unitStatus: 'reserved',
        expiresAt: new Date('2035-01-01T00:00:00.000Z'),
      },
    },
    unit: { id: unitId, unitStatus: 'reserved', expiresAt: new Date('2035-01-01T00:00:00.000Z') },
    dispatch: null,
    auditEntries: [],
  };
  const prisma = {
    user: {
      findFirst: async () => user,
      findUnique: async () => user,
    },
    bloodRequest: {
      findFirst: async () => state.request,
      findUnique: async () => state.request,
      update: async ({ data }) => Object.assign(state.request, data),
    },
    staff: {
      findFirst: async () => ({ id: staffId }),
    },
    allocation: {
      findFirst: async () => (state.allocation.allocationStatus === 'reserved' ? state.allocation : null),
      update: async ({ data }) => Object.assign(state.allocation, data),
      updateMany: async ({ where, data }) => {
        if (state.allocation.id !== where.id || state.allocation.allocationStatus !== where.allocationStatus) {
          return { count: 0 };
        }
        Object.assign(state.allocation, data);
        return { count: 1 };
      },
    },
    bloodUnit: {
      findUnique: async () => state.unit,
      updateMany: async ({ where, data }) => {
        if (state.unit.unitStatus !== where.unitStatus) return { count: 0 };
        Object.assign(state.unit, data);
        return { count: 1 };
      },
    },
    bloodDispatch: {
      findFirst: async () => state.dispatch,
      create: async ({ data }) => {
        state.dispatch = {
          id: '00000000-0000-4000-8000-000000000109',
          allocationId: data.allocationId,
          bloodRequestId: data.bloodRequestId,
          bloodUnitId: data.bloodUnitId,
          dispatchedByUserId: data.dispatchedByUserId,
          dispatchedByStaffId: data.dispatchedByStaffId,
          deliveryStatus: 'dispatched',
          dispatchedAt: new Date(),
          deliveredAt: null,
          finalDisposition: null,
        };
        return state.dispatch;
      },
      update: async ({ data }) => Object.assign(state.dispatch, data),
      count: async ({ where }) => (
        state.dispatch?.bloodRequestId === where.bloodRequestId
        && state.dispatch.deliveryStatus === where.deliveryStatus
          ? 1
          : 0
      ),
    },
    auditLog: {
      create: async ({ data }) => state.auditEntries.push(data),
    },
    $queryRaw: async () => [],
    $transaction: async (callback) => callback(prisma),
  };
  return {
    app: createApp({ prisma, sessionSecret, clientOrigin }),
    state,
  };
}

async function createReviewApp() {
  const user = {
    id: userId,
    email: 'hospital@example.test',
    displayName: 'Request Reviewer',
    passwordHash: await bcrypt.hash('request-test-password', 4),
    accountStatus: 'active',
    disabledAt: null,
    roleAssignments: [{ role: { code: 'STAFF' } }],
    donorProfile: null,
    staffProfile: {
      id: staffId,
      hospitalId,
      staffStatus: 'active',
      hospital: { isActive: true },
    },
    hospitalMemberships: [],
  };
  const state = {
    request: {
      id: requestId,
      hospitalId,
      requestStatus: 'open',
      reviewedByUserId: null,
      reviewedAt: null,
    },
    auditEntries: [],
  };
  const prisma = {
    user: {
      findFirst: async () => user,
      findUnique: async () => user,
    },
    bloodRequest: {
      findFirst: async () => state.request,
      update: async ({ data }) => Object.assign(state.request, data),
    },
    auditLog: {
      create: async ({ data }) => state.auditEntries.push(data),
    },
    $queryRaw: async () => [],
    $transaction: async (callback) => callback(prisma),
  };
  return {
    app: createApp({ prisma, sessionSecret, clientOrigin }),
    state,
  };
}

test('validates request values and requires meaningful operational details', () => {
  assert.throws(() => validateCreate({
    bloodTypeId,
    componentType: 'red_cells',
    quantityRequested: 1,
    requestDetails: '   ',
  }), /requestDetails is required/);

  assert.throws(() => validateCreate({
    bloodTypeId,
    componentType: 'red_cells',
    quantityRequested: 0,
    requestDetails: 'Urgent operating room request.',
  }), /between 1 and 1000/);

  assert.throws(() => validateCreate({
    bloodTypeId,
    componentType: 'red_cells',
    quantityRequested: 1,
    requestDetails: 'Required units.',
    requestStatus: 'fulfilled',
  }), /Unsupported request field/);
});

test('requires a recorded attestation to explicitly approve exact ABO/Rh matching', () => {
  const approval = validateAttestation({
    policyVersion: 'policy-v1',
    policyDescription: 'Qualified reviewers approved exact ABO/Rh matching only.',
    reviewerName: 'Qualified Reviewer',
    reviewerCredential: 'Credential on file',
    reviewedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(approval.policyVersion, 'policy-v1');
  assert.equal(approval.reviewerCredential, 'Credential on file');
  assert.throws(() => validateAttestation({
    policyVersion: 'policy-v1',
    policyDescription: 'Use standard compatibility.',
    reviewerName: 'Qualified Reviewer',
    reviewerCredential: 'Credential on file',
    reviewedAt: '2026-01-01T00:00:00.000Z',
  }), /exact ABO\/Rh matching/);
});

test('creates a hospital request owned by the authenticated user and writes an audit entry', async () => {
  const { app, captured } = await createHospitalApp();
  const agent = await login(app);
  const response = await agent
    .post('/api/blood-requests')
    .set('Origin', clientOrigin)
    .send({
      hospitalId,
      bloodTypeId,
      componentType: 'red_cells',
      quantityRequested: 2,
      priority: 'urgent',
      requestDetails: 'Request for the hospital transfusion service.',
      neededBy: '2035-01-01T12:00:00.000Z',
    });

  assert.equal(response.status, 201);
  assert.equal(captured.create.requestedByUserId, userId);
  assert.equal(captured.create.hospitalId, hospitalId);
  assert.equal(captured.create.requestStatus, 'open');
  assert.match(captured.create.requestNumber, /^REQ-[A-F0-9]{16}$/);
  assert.equal(captured.create.statusHistory.create.newStatus, 'open');
  assert.equal(captured.audit.actorUserId, userId);
  assert.equal(response.body.bloodRequest.requestedByUserId, userId);
});

test('does not disclose a request outside the hospital user’s submission scope', async () => {
  const { app, captured } = await createHospitalApp();
  const agent = await login(app);
  const response = await agent
    .get(`/api/blood-requests/${requestId}`)
    .set('Origin', clientOrigin);

  assert.equal(response.status, 404);
  const scope = captured.lookup.AND[1];
  assert.equal(scope.requestedByUserId, userId);
  assert.deepEqual(scope.hospitalId.in, [hospitalId]);
});

test('requires the exact application origin before cancelling a request', async () => {
  const record = {
    id: requestId,
    hospitalId,
    requestedByUserId: userId,
    requestStatus: 'open',
  };
  const { app, captured } = await createHospitalApp({ ownershipLookup: () => record });
  const agent = await login(app);

  const crossOrigin = await agent
    .post(`/api/blood-requests/${requestId}/cancel`)
    .set('Origin', 'https://untrusted.example')
    .send({});
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.body.error.code, 'INVALID_ORIGIN');
  assert.equal(captured.cancelUpdate, undefined);

  const missingOrigin = await agent
    .post(`/api/blood-requests/${requestId}/cancel`)
    .send({});
  assert.equal(missingOrigin.status, 403);
  assert.equal(captured.cancelUpdate, undefined);

  const validOrigin = await agent
    .post(`/api/blood-requests/${requestId}/cancel`)
    .set('Origin', clientOrigin)
    .send({});
  assert.equal(validOrigin.status, 200);
  assert.equal(captured.cancelUpdate.data.requestStatus, 'cancelled');
});

test('rejects request creation from roles without request permissions', async () => {
  const donor = {
    id: '00000000-0000-4000-8000-000000000105',
    email: 'donor@example.test',
    displayName: 'Donor',
    passwordHash: await bcrypt.hash('request-test-password', 4),
    accountStatus: 'active',
    disabledAt: null,
    roleAssignments: [{ role: { code: 'DONOR' } }],
    donorProfile: null,
    staffProfile: null,
    hospitalMemberships: [],
  };
  const unauthorizedApp = createApp({
    prisma: {
      user: {
        findFirst: async () => donor,
        findUnique: async () => donor,
      },
    },
    sessionSecret,
    clientOrigin,
  });
  const agent = await login(unauthorizedApp, donor.email);
  const response = await agent.post('/api/blood-requests').set('Origin', clientOrigin).send({});
  assert.equal(response.status, 403);
});

test('staff review records an approved status and refuses a second review transition', async () => {
  const { app, state } = await createReviewApp();
  const agent = await login(app);
  const response = await agent
    .post(`/api/blood-requests/${requestId}/review`)
    .set('Origin', clientOrigin)
    .send({ decision: 'approved', note: 'Request reviewed.' });

  assert.equal(response.status, 200);
  assert.equal(state.request.requestStatus, 'approved');
  assert.equal(state.request.reviewedByUserId, userId);
  assert.equal(state.request.reviewedAt instanceof Date, true);
  assert.equal(state.request.statusHistory.create.newStatus, 'approved');
  assert.equal(state.auditEntries[0].action, 'blood_request.approved');

  const secondResponse = await agent
    .post(`/api/blood-requests/${requestId}/review`)
    .set('Origin', clientOrigin)
    .send({ decision: 'rejected', note: 'Second review is invalid.' });
  assert.equal(secondResponse.status, 409);
});

test('dispatches a reserved unit once and records a final disposition with traceability', async () => {
  const { app, state } = await createDispatchApp();
  const agent = await login(app);
  const dispatchResponse = await agent
    .post(`/api/blood-requests/${requestId}/dispatch`)
    .set('Origin', clientOrigin)
    .send({ allocationIds: [allocationId] });

  assert.equal(dispatchResponse.status, 201);
  assert.equal(state.dispatch.deliveryStatus, 'dispatched');
  assert.equal(state.dispatch.dispatchedByStaffId, staffId);
  assert.equal(state.allocation.allocationStatus, 'fulfilled');
  assert.equal(state.unit.unitStatus, 'issued');
  assert.equal(state.auditEntries.some((entry) => entry.action === 'blood_unit.dispatched'), true);

  const outcomeResponse = await agent
    .patch(`/api/blood-requests/dispatches/${state.dispatch.id}/status`)
    .set('Origin', clientOrigin)
    .send({ deliveryStatus: 'delivered', finalDisposition: 'not_transfused' });

  assert.equal(outcomeResponse.status, 200);
  assert.equal(state.dispatch.deliveryStatus, 'delivered');
  assert.equal(state.dispatch.finalDisposition, 'not_transfused');
  assert.equal(state.request.requestStatus, 'fulfilled');
  assert.equal(state.request.closedAt instanceof Date, true);
  assert.equal(state.auditEntries.some((entry) => entry.action === 'blood_dispatch.delivered'), true);
});

test('returned units are quarantined and their allocation history remains while request capacity is released', async () => {
  const { app, state } = await createDispatchApp();
  const agent = await login(app);
  await agent
    .post(`/api/blood-requests/${requestId}/dispatch`)
    .set('Origin', clientOrigin)
    .send({ allocationIds: [allocationId] });

  const response = await agent
    .patch(`/api/blood-requests/dispatches/${state.dispatch.id}/status`)
    .set('Origin', clientOrigin)
    .send({
      deliveryStatus: 'returned',
      finalDisposition: 'returned_to_inventory_quarantine',
    });

  assert.equal(response.status, 200);
  assert.equal(state.dispatch.deliveryStatus, 'returned');
  assert.equal(state.allocation.allocationStatus, 'cancelled');
  assert.equal(state.allocation.cancelledAt instanceof Date, true);
  assert.equal(state.unit.unitStatus, 'quarantined');
  assert.equal(state.auditEntries.some((entry) => entry.action === 'allocation.returned'), true);
});
