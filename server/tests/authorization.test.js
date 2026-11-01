import assert from 'node:assert/strict';
import test from 'node:test';
import { actions, buildOwnershipFilter, can, permissionMatrix, requirePermission } from '../src/auth/authorization.js';
import { requireAuthentication } from '../src/auth/auth-middleware.js';

const roleCodes = ['ADMIN', 'STAFF', 'DONOR', 'HOSPITAL'];
const userId = '00000000-0000-4000-8000-000000000001';
const ownHospitalId = '00000000-0000-4000-8000-000000000002';
const otherHospitalId = '00000000-0000-4000-8000-000000000003';
const donorId = '00000000-0000-4000-8000-000000000004';

async function authorize(user, resource, action, options) {
  const result = { status: 200, body: null, nextCalled: false };
  const response = {
    status(status) {
      result.status = status;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
  const request = {
    auth: user ? { user } : undefined,
    params: { id: 'record-id' },
    body: options?.body || {},
  };
  const middleware = requirePermission(options?.prisma || {}, resource, action, options);
  await middleware(request, response, () => {
    result.nextCalled = true;
  });
  result.request = request;
  return result;
}

test('permission middleware allows and denies every role, record type, and action in the matrix', async () => {
  for (const [resource, resourcePermissions] of Object.entries(permissionMatrix)) {
    for (const role of roleCodes) {
      for (const action of actions) {
        const user = { id: userId, roles: [role] };
        const result = await authorize(user, resource, action);
        const allowed = can(user, resource, action);
        assert.equal(
          result.nextCalled,
          allowed,
          `${role} ${allowed ? 'should' : 'should not'} be allowed to ${action} ${resource}`,
        );
        assert.equal(result.status, allowed ? 200 : 403);
        assert.equal(
          resourcePermissions[action].includes(role),
          allowed,
          `Matrix and middleware disagree for ${role} ${action} ${resource}`,
        );
      }
    }
  }
});

test('rejects unauthenticated permission checks', async () => {
  const result = await authorize(null, 'donations', 'view');
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, 'UNAUTHENTICATED');
});

test('applies donor ownership scopes to donor profiles, appointments, and donations', () => {
  const donor = {
    id: userId,
    donorId,
    hospitalIds: [],
    roles: ['DONOR'],
  };

  assert.deepEqual(buildOwnershipFilter(donor, 'donors'), { userId });
  assert.deepEqual(buildOwnershipFilter(donor, 'appointments'), { donorId });
  assert.deepEqual(buildOwnershipFilter(donor, 'donations'), { donorId });
  assert.deepEqual(buildOwnershipFilter(donor, 'laboratoryTests'), {
    donation: { donorId },
  });
  assert.deepEqual(buildOwnershipFilter(donor, 'notifications'), { userId });
  assert.equal(buildOwnershipFilter(donor, 'bloodRequests'), null);
});

test('limits hospital users to memberships and requests they submitted', () => {
  const hospitalUser = {
    id: userId,
    hospitalIds: [ownHospitalId],
    roles: ['HOSPITAL'],
  };

  assert.deepEqual(buildOwnershipFilter(hospitalUser, 'hospitals'), {
    id: { in: [ownHospitalId] },
  });
  assert.deepEqual(buildOwnershipFilter(hospitalUser, 'bloodRequests'), {
    requestedByUserId: userId,
    hospitalId: { in: [ownHospitalId] },
  });
  assert.deepEqual(buildOwnershipFilter(hospitalUser, 'allocations'), {
    bloodRequest: {
      requestedByUserId: userId,
      hospitalId: { in: [ownHospitalId] },
    },
  });
  assert.equal(
    buildOwnershipFilter({ ...hospitalUser, hospitalIds: [otherHospitalId] }, 'bloodRequests')
      .hospitalId.in.includes(ownHospitalId),
    false,
  );
});

test('limits staff operational queries to active assigned hospitals', () => {
  const staff = {
    id: userId,
    hospitalIds: [ownHospitalId],
    roles: ['STAFF'],
  };

  assert.deepEqual(buildOwnershipFilter(staff, 'bloodRequests'), {
    hospitalId: { in: [ownHospitalId] },
  });
  assert.deepEqual(buildOwnershipFilter(staff, 'allocations'), {
    bloodRequest: { hospitalId: { in: [ownHospitalId] } },
  });
  assert.deepEqual(buildOwnershipFilter(staff, 'donors'), {
    OR: [
      { registrationHospitalId: { in: [ownHospitalId] } },
      { appointments: { some: { hospitalId: { in: [ownHospitalId] } } } },
      { donations: { some: { hospitalId: { in: [ownHospitalId] } } } },
    ],
  });
  assert.equal(buildOwnershipFilter({ id: userId, roles: ['STAFF'], hospitalIds: [] }, 'donations'), null);
});

test('loads hospital scope from active database memberships, not request data', async () => {
  let selectedFields;
  const authenticatedUser = {
    id: userId,
    email: 'hospital@example.test',
    displayName: 'Hospital User',
    accountStatus: 'active',
    disabledAt: null,
    roleAssignments: [{ role: { code: 'HOSPITAL' } }],
    donorProfile: null,
    staffProfile: null,
    hospitalMemberships: [
      { hospitalId: ownHospitalId, hospital: { isActive: true } },
      { hospitalId: otherHospitalId, hospital: { isActive: false } },
    ],
  };
  const request = {
    session: { userId },
    body: { hospitalId: otherHospitalId },
  };
  const response = {
    status(status) {
      this.statusCode = status;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    clearCookie() {},
  };
  let nextCalled = false;

  await requireAuthentication({
    user: {
      findUnique: async ({ select }) => {
        selectedFields = select;
        return authenticatedUser;
      },
    },
  })(request, response, () => {
    nextCalled = true;
  });

  assert.equal(selectedFields.hospitalMemberships.where.isActive, true);
  assert.deepEqual(request.auth.user.hospitalIds, [ownHospitalId]);
  assert.equal(nextCalled, true);
});

test('adds an ownership filter when authorizing a record by ID', async () => {
  let whereClause;
  const record = { id: 'record-id', hospitalId: ownHospitalId };
  const user = { id: userId, roles: ['STAFF'], hospitalIds: [ownHospitalId] };
  const result = await authorize(user, 'bloodRequests', 'view', {
    recordDelegate: 'bloodRequest',
    prisma: {
      bloodRequest: {
        findFirst: async ({ where }) => {
          whereClause = where;
          return record;
        },
      },
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.nextCalled, true);
  assert.deepEqual(whereClause, {
    AND: [
      { id: 'record-id' },
      { hospitalId: { in: [ownHospitalId] } },
    ],
  });
  assert.equal(result.request.authorizedRecord, record);
});

test('supports the donation ID as the verified donation blood type key', async () => {
  let whereClause;
  const user = { id: userId, roles: ['STAFF'], hospitalIds: [ownHospitalId] };
  const result = await authorize(user, 'donationBloodTypes', 'view', {
    recordDelegate: 'donationBloodType',
    recordIdField: 'donationId',
    prisma: {
      donationBloodType: {
        findFirst: async ({ where }) => {
          whereClause = where;
          return { donationId: 'record-id' };
        },
      },
    },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(whereClause, {
    AND: [
      { donationId: 'record-id' },
      { donation: { hospitalId: { in: [ownHospitalId] } } },
    ],
  });
});

test('does not disclose records outside the caller ownership scope', async () => {
  const user = { id: userId, roles: ['HOSPITAL'], hospitalIds: [ownHospitalId] };
  const result = await authorize(user, 'bloodRequests', 'view', {
    recordDelegate: 'bloodRequest',
    prisma: {
      bloodRequest: {
        findFirst: async () => null,
      },
    },
  });

  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, 'RECORD_NOT_FOUND');
  assert.equal(result.nextCalled, false);
});

test('hospital users cannot view or update another hospital user private request', async () => {
  const hospitalUser = {
    id: userId,
    roles: ['HOSPITAL'],
    hospitalIds: [ownHospitalId],
  };
  for (const action of ['view', 'update']) {
    let lookup;
    const result = await authorize(hospitalUser, 'bloodRequests', action, {
      recordDelegate: 'bloodRequest',
      prisma: {
        bloodRequest: {
          findFirst: async ({ where }) => {
            lookup = where;
            return null;
          },
        },
      },
    });
    assert.equal(result.status, 404);
    assert.equal(result.nextCalled, false);
    assert.deepEqual(lookup, {
      AND: [
        { id: 'record-id' },
        { requestedByUserId: userId, hospitalId: { in: [ownHospitalId] } },
      ],
    });
  }
});

test('requires a valid scope for scoped collection endpoints', async () => {
  const result = await authorize(
    { id: userId, roles: ['STAFF'], hospitalIds: [] },
    'bloodRequests',
    'view',
    { scoped: true },
  );
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, 'FORBIDDEN');
  assert.equal(result.nextCalled, false);

  const scopedResult = await authorize(
    { id: userId, roles: ['STAFF'], hospitalIds: [ownHospitalId] },
    'bloodRequests',
    'view',
    { scoped: true },
  );
  assert.equal(scopedResult.status, 200);
  assert.deepEqual(scopedResult.request.auth.resourceScope, {
    hospitalId: { in: [ownHospitalId] },
  });
});

test('validates submitted hospital IDs against active membership for creates', async () => {
  const user = { id: userId, roles: ['HOSPITAL'], hospitalIds: [ownHospitalId] };
  const allowed = await authorize(user, 'bloodRequests', 'create', {
    organizationField: 'hospitalId',
    body: { hospitalId: ownHospitalId },
  });
  const denied = await authorize(user, 'bloodRequests', 'create', {
    organizationField: 'hospitalId',
    body: { hospitalId: otherHospitalId },
  });

  assert.equal(allowed.nextCalled, true);
  assert.equal(allowed.status, 200);
  assert.equal(denied.nextCalled, false);
  assert.equal(denied.status, 403);
});

test('administrators have global record scope, while audit logs remain read-only', () => {
  const administrator = { id: userId, roles: ['ADMIN'], hospitalIds: [] };
  assert.deepEqual(buildOwnershipFilter(administrator, 'bloodRequests'), {});
  assert.equal(can(administrator, 'auditLogs', 'view'), true);
  assert.equal(can(administrator, 'auditLogs', 'export'), false);
  for (const action of ['create', 'update', 'approve', 'allocate', 'dispatch']) {
    assert.equal(can(administrator, 'auditLogs', action), false);
  }
});

test('keeps sensitive or state-changing actions limited to the intended roles', () => {
  assert.equal(can({ roles: ['DONOR'] }, 'laboratoryTests', 'view'), false);
  assert.equal(can({ roles: ['DONOR'] }, 'appointments', 'approve'), false);
  assert.equal(can({ roles: ['HOSPITAL'] }, 'bloodRequests', 'create'), true);
  assert.equal(can({ roles: ['HOSPITAL'] }, 'bloodRequests', 'approve'), false);
  assert.equal(can({ roles: ['STAFF'] }, 'bloodUnits', 'dispatch'), true);
  assert.equal(can({ roles: ['STAFF'] }, 'users', 'export'), false);
  assert.equal(can({ roles: ['HOSPITAL'] }, 'hospitalUsers', 'update'), false);
});
