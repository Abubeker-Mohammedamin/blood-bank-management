import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';

const clientOrigin = 'http://localhost:5173';
const sessionSecret = 'test-session-secret-with-at-least-32-bytes';
const adminId = '00000000-0000-4000-8000-000000000001';
const otherUserId = '00000000-0000-4000-8000-000000000002';
const hospitalId = '00000000-0000-4000-8000-000000000003';
const otherHospitalId = '00000000-0000-4000-8000-000000000004';
const staffId = '00000000-0000-4000-8000-000000000005';
const membershipId = '00000000-0000-4000-8000-000000000006';
const testPassword = 'correct-password';

function makeManagementApp({ role = 'ADMIN', duplicateStaff = false } = {}) {
  const passwordHash = bcrypt.hashSync(testPassword, 4);
  const adminUser = {
    id: adminId,
    email: 'admin@example.test',
    displayName: 'Admin Example',
    passwordHash,
    accountStatus: 'active',
    disabledAt: null,
    roleAssignments: [{ role: { code: role } }],
    donorProfile: null,
    staffProfile: null,
    hospitalMemberships: [],
  };
  const state = {
    hospitals: [{
      id: hospitalId,
      name: 'Central Hospital',
      registrationNumber: 'HOSP-001',
      phone: null,
      email: 'central@example.test',
      addressLine1: null,
      addressLine2: null,
      city: 'North City',
      region: null,
      postalCode: null,
      countryCode: 'US',
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }],
    staff: [],
    memberships: [],
    accounts: [{
      id: otherUserId,
      displayName: 'Morgan Account',
      email: 'morgan@example.test',
      phoneE164: '+15551234567',
      accountStatus: 'active',
      disabledAt: null,
      staffProfile: null,
    }],
    audits: [],
    userRoles: [],
    calls: {},
  };

  function withHospitalCount(record) {
    return {
      ...record,
      _count: {
        staff: state.staff.filter((staff) => staff.hospitalId === record.id).length,
        hospitalUsers: state.memberships.filter((membership) => membership.hospitalId === record.id).length,
        bloodRequests: 0,
      },
    };
  }
  function withStaffRelations(record) {
    const user = record.userId === adminId
      ? adminUser
      : state.accounts.find((account) => account.id === record.userId);
    const hospital = state.hospitals.find((item) => item.id === record.hospitalId);
    return {
      ...record,
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        phoneE164: user.phoneE164,
        accountStatus: user.accountStatus,
        disabledAt: user.disabledAt,
      },
      hospital: {
        id: hospital.id,
        name: hospital.name,
        registrationNumber: hospital.registrationNumber,
        isActive: hospital.isActive,
      },
    };
  }
  function withMembershipRelations(record) {
    const user = state.accounts.find((account) => account.id === record.userId) || adminUser;
    return {
      ...record,
      user: {
        displayName: user.displayName,
        email: user.email,
        accountStatus: user.accountStatus,
      },
    };
  }

  const prisma = {
    user: {
      findFirst: async () => adminUser,
      findUnique: async ({ where }) => (
        where.id === adminId
          ? adminUser
          : state.accounts.find((account) => account.id === where.id) || null
      ),
      findMany: async (args) => {
        state.calls.linkableQuery = args;
        return state.accounts.filter((account) => !account.staffProfile);
      },
      create: async ({ data }) => {
        state.calls.userCreate = data;
        if (state.accounts.some((account) => account.email === data.email)) {
          throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        }
        const account = {
          id: '00000000-0000-4000-8000-000000000010',
          ...data,
          staffProfile: null,
        };
        state.accounts.push(account);
        return account;
      },
      update: async ({ where, data }) => {
        const user = state.accounts.find((account) => account.id === where.id)
          || (adminUser.id === where.id ? adminUser : null);
        if (!user) throw Object.assign(new Error('Not found'), { code: 'P2025' });
        Object.assign(user, data);
        state.calls.userUpdate = data;
        return user;
      },
    },
    role: {
      upsert: async ({ where }) => ({ id: `role-${where.code.toLowerCase()}`, code: where.code }),
    },
    userRole: {
      findFirst: async ({ where }) => state.userRoles.find((entry) => (
        entry.userId === where.userId && entry.roleId === where.roleId && !entry.revokedAt
      )) || null,
      create: async ({ data }) => {
        state.userRoles.push(data);
        return data;
      },
    },
    staff: {
      findMany: async (args) => {
        state.calls.staffList = args;
        return state.staff.map(withStaffRelations);
      },
      count: async () => state.staff.length,
      findFirst: async ({ where }) => {
        const id = where.AND?.[0]?.id;
        return state.staff.find((record) => record.id === id) || null;
      },
      findUnique: async ({ where }) => {
        const record = state.staff.find((item) => item.id === where.id);
        return record ? withStaffRelations(record) : null;
      },
      create: async ({ data }) => {
        state.calls.staffCreate = data;
        if (duplicateStaff) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        const record = {
          id: staffId,
          ...data,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        state.staff.push(record);
        const linkedUser = state.accounts.find((account) => account.id === record.userId);
        if (linkedUser) linkedUser.staffProfile = { id: record.id };
        return withStaffRelations(record);
      },
      update: async ({ where, data }) => {
        const record = state.staff.find((item) => item.id === where.id);
        if (!record) throw Object.assign(new Error('Not found'), { code: 'P2025' });
        Object.assign(record, data);
        state.calls.staffUpdate = data;
        return withStaffRelations(record);
      },
    },
    hospital: {
      findMany: async (args) => {
        state.calls.hospitalList = args;
        return state.hospitals.map(withHospitalCount);
      },
      count: async () => state.hospitals.length,
      findFirst: async ({ where }) => state.hospitals.find((hospital) => (
        hospital.id === where.id && (where.isActive === undefined || hospital.isActive === where.isActive)
      )) || null,
      findUnique: async ({ where }) => state.hospitals.find((hospital) => hospital.id === where.id) || null,
      create: async ({ data }) => {
        state.calls.hospitalCreate = data;
        if (data.registrationNumber && state.hospitals.some((hospital) => (
          hospital.registrationNumber === data.registrationNumber
        ))) {
          throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        }
        const record = {
          id: otherHospitalId,
          ...data,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        state.hospitals.push(record);
        return withHospitalCount(record);
      },
      update: async ({ where, data }) => {
        const record = state.hospitals.find((hospital) => hospital.id === where.id);
        if (!record) throw Object.assign(new Error('Not found'), { code: 'P2025' });
        Object.assign(record, data);
        state.calls.hospitalUpdate = data;
        return withHospitalCount(record);
      },
    },
    hospitalUser: {
      findMany: async ({ where }) => state.memberships
        .filter((record) => record.hospitalId === where.hospitalId)
        .map(withMembershipRelations),
      findUnique: async ({ where }) => state.memberships.find((record) => (
        record.userId === where.userId_hospitalId.userId
        && record.hospitalId === where.userId_hospitalId.hospitalId
      )) || null,
      findFirst: async ({ where }) => state.memberships.find((record) => (
        record.id === where.id && record.hospitalId === where.hospitalId
      )) || null,
      create: async ({ data }) => {
        const record = { id: membershipId, ...data, createdAt: new Date('2026-01-01T00:00:00.000Z') };
        state.memberships.push(record);
        return withMembershipRelations(record);
      },
      update: async ({ where, data }) => {
        const record = state.memberships.find((membership) => membership.id === where.id);
        Object.assign(record, data);
        return withMembershipRelations(record);
      },
    },
    auditLog: {
      create: async ({ data }) => {
        state.audits.push(data);
        return data;
      },
    },
    $transaction: async (callback) => callback(prisma),
  };
  const app = createApp({ prisma, sessionSecret, clientOrigin });
  return { app, state, prisma, adminUser };
}

async function login(app) {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/auth/login')
    .set('Origin', clientOrigin)
    .send({ email: 'admin@example.test', password: testPassword });
  assert.equal(response.status, 200);
  return agent;
}

test('administrator can create, search, update, and deactivate staff with audit entries', async () => {
  const { app, state } = makeManagementApp();
  const agent = await login(app);
  const created = await agent
    .post('/api/staff')
    .set('Origin', clientOrigin)
    .send({
      displayName: 'Taylor Staff',
      email: 'taylor@example.test',
      phoneE164: '+15557654321',
      hospitalId,
      employeeNumber: ' emp-010 ',
      jobTitle: 'Collection specialist',
    });

  assert.equal(created.status, 201);
  assert.equal(created.body.staff.employeeNumber, 'EMP-010');
  assert.equal(created.body.staff.user.accountStatus, 'pending');
  assert.equal(state.audits[0].action, 'CREATE');
  assert.equal(state.audits[0].entityType, 'STAFF');
  assert.equal(state.audits[0].actorUserId, adminId);
  assert.deepEqual(state.audits[0].changedFields, [
    'employeeNumber',
    'jobTitle',
    'staffStatus',
    'hospitalId',
    'displayName',
    'email',
    'phoneE164',
    'accountStatus',
    'role',
  ]);
  assert.equal(state.audits.some((entry) => entry.action === 'account.staff_created'), true);
  assert.equal(state.audits.some((entry) => entry.action === 'permission.role_assigned'), true);
  assert.deepEqual(state.audits[0].metadata, {});

  const filtered = await agent.get('/api/staff?search=taylor&status=active&page=1&pageSize=10');
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.pagination.totalItems, 1);
  assert.equal(state.calls.staffList.skip, 0);

  const updated = await agent
    .put(`/api/staff/${staffId}`)
    .set('Origin', clientOrigin)
    .send({ displayName: 'Taylor Changed', jobTitle: 'Supervisor', staffStatus: 'inactive' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.staff.staffStatus, 'inactive');
  assert.equal(updated.body.staff.user.displayName, 'Taylor Changed');
  assert.equal(updated.body.staff.user.accountStatus, 'disabled');
  assert.ok(state.calls.userUpdate.disabledAt instanceof Date);
  assert.equal(state.audits.some((entry) => entry.action === 'DEACTIVATE' && entry.entityType === 'STAFF'), true);
  assert.equal(state.audits.some((entry) => entry.action === 'account.staff_account_updated'), true);
});

test('staff records can link existing accounts and cannot be deleted', async () => {
  const { app, state } = makeManagementApp();
  const agent = await login(app);
  const accounts = await agent.get('/api/staff/linkable-accounts?search=morgan');
  assert.equal(accounts.status, 200);
  assert.equal(accounts.body.accounts[0].id, otherUserId);

  const created = await agent
    .post('/api/staff')
    .set('Origin', clientOrigin)
    .send({ userId: otherUserId, hospitalId, employeeNumber: 'EMP-020', jobTitle: 'Nurse' });
  assert.equal(created.status, 201);
  assert.equal(state.userRoles[0].roleId, 'role-staff');
  assert.equal(created.body.staff.user.id, otherUserId);

  const deleted = await agent.delete(`/api/staff/${staffId}`);
  assert.equal(deleted.status, 405);
  assert.equal(state.staff.length, 1);
});

test('staff creation validates input, active hospitals, and duplicate identifiers', async () => {
  const { app } = makeManagementApp({ duplicateStaff: true });
  const agent = await login(app);
  const invalid = await agent
    .post('/api/staff')
    .set('Origin', clientOrigin)
    .send({ displayName: 'Bad', email: 'bad', hospitalId, employeeNumber: 'X' });
  assert.equal(invalid.status, 400);

  const duplicate = await agent
    .post('/api/staff')
    .set('Origin', clientOrigin)
    .send({
      displayName: 'Taylor Staff',
      email: 'taylor@example.test',
      hospitalId,
      employeeNumber: 'EMP-010',
    });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'STAFF_IDENTIFIER_CONFLICT');
});

test('staff profiles cannot be assigned to an inactive hospital', async () => {
  const { app, state } = makeManagementApp();
  state.hospitals[0].isActive = false;
  const agent = await login(app);
  const response = await agent
    .post('/api/staff')
    .set('Origin', clientOrigin)
    .send({
      displayName: 'Taylor Staff',
      email: 'taylor@example.test',
      hospitalId,
      employeeNumber: 'EMP-010',
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'HOSPITAL_UNAVAILABLE');
  assert.equal(state.staff.length, 0);
  assert.equal(state.audits.length, 0);
});

test('non-administrators cannot manage staff or hospitals', async () => {
  const { app } = makeManagementApp({ role: 'STAFF' });
  const agent = await login(app);
  assert.equal((await agent.get('/api/staff')).status, 403);
  assert.equal((await agent.post('/api/hospitals').set('Origin', clientOrigin).send({ name: 'Blocked' })).status, 403);
});

test('administrator can create, search, update, and deactivate hospitals with audit entries', async () => {
  const { app, state } = makeManagementApp();
  const agent = await login(app);
  const created = await agent
    .post('/api/hospitals')
    .set('Origin', clientOrigin)
    .send({
      name: 'Regional Clinic',
      registrationNumber: ' clinic-002 ',
      email: 'clinic@example.test',
      city: 'East City',
      countryCode: 'us',
    });
  assert.equal(created.status, 201);
  assert.equal(created.body.hospital.registrationNumber, 'CLINIC-002');
  assert.equal(created.body.hospital.countryCode, 'US');
  assert.equal(state.audits[0].entityType, 'HOSPITAL');

  const filtered = await agent.get('/api/hospitals?search=regional&isActive=true');
  assert.equal(filtered.status, 200);
  assert.equal(state.calls.hospitalList.where.AND[1].OR[0].name.contains, 'regional');

  const updated = await agent
    .put(`/api/hospitals/${otherHospitalId}`)
    .set('Origin', clientOrigin)
    .send({ isActive: false, city: 'East District' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.hospital.isActive, false);
  assert.equal(state.audits.some((entry) => entry.action === 'DEACTIVATE' && entry.entityType === 'HOSPITAL'), true);
  assert.equal(state.audits.some((entry) => entry.action === 'permission.hospital_scope_changed'), true);
  assert.equal((await agent.delete(`/api/hospitals/${otherHospitalId}`)).status, 405);
});

test('hospital registration IDs are normalized and duplicate IDs are rejected', async () => {
  const { app } = makeManagementApp();
  const agent = await login(app);
  const conflict = await agent
    .post('/api/hospitals')
    .set('Origin', clientOrigin)
    .send({ name: 'Duplicate Hospital', registrationNumber: 'hosp-001' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'HOSPITAL_IDENTIFIER_CONFLICT');
});

test('administrator associates and deactivates hospital users without deleting membership history', async () => {
  const { app, state } = makeManagementApp();
  const agent = await login(app);
  const linked = await agent
    .post(`/api/hospitals/${hospitalId}/users`)
    .set('Origin', clientOrigin)
    .send({ userId: otherUserId });
  assert.equal(linked.status, 201);
  assert.equal(linked.body.membership.hospitalId, hospitalId);
  assert.equal(state.userRoles[0].roleId, 'role-hospital');

  const memberships = await agent.get(`/api/hospitals/${hospitalId}/users`);
  assert.equal(memberships.status, 200);
  assert.equal(memberships.body.memberships[0].user.email, 'morgan@example.test');

  const deactivated = await agent
    .patch(`/api/hospitals/${hospitalId}/users/${membershipId}`)
    .set('Origin', clientOrigin)
    .send({ isActive: false });
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.body.membership.isActive, false);
  assert.equal(state.memberships.length, 1);
  assert.equal(state.audits.some((entry) => entry.action === 'DEACTIVATE' && entry.entityType === 'HOSPITAL_USER'), true);
  assert.equal(state.audits.some((entry) => entry.action === 'permission.hospital_access_revoked'), true);
});

test('hospital-user membership is scoped to the hospital in the URL', async () => {
  const { app, state } = makeManagementApp();
  state.memberships.push({ id: membershipId, userId: otherUserId, hospitalId, isActive: true });
  const agent = await login(app);

  const mismatch = await agent
    .patch(`/api/hospitals/${otherHospitalId}/users/${membershipId}`)
    .set('Origin', clientOrigin)
    .send({ isActive: false });
  assert.equal(mismatch.status, 404);
  assert.equal(state.memberships[0].isActive, true);
});
