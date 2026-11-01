import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { safeAuditMetadata, writeAudit } from '../src/management/management-utils.js';

const clientOrigin = 'http://localhost:5173';
const sessionSecret = 'audit-test-session-secret-with-at-least-32-bytes';
const adminId = '00000000-0000-4000-8000-000000000901';
const staffId = '00000000-0000-4000-8000-000000000902';
const password = 'audit-test-password';

function createAuditApp() {
  const events = [];
  const adminUser = {
    id: adminId,
    email: 'admin@example.test',
    displayName: 'Audit Admin',
    passwordHash: bcrypt.hashSync(password, 4),
    accountStatus: 'active',
    disabledAt: null,
    roleAssignments: [{ role: { code: 'ADMIN' } }],
    donorProfile: null,
    staffProfile: null,
    hospitalMemberships: [],
  };
  const staffUser = {
    ...adminUser,
    id: staffId,
    email: 'staff@example.test',
    displayName: 'Audit Staff',
    roleAssignments: [{ role: { code: 'STAFF' } }],
    staffProfile: {
      id: '00000000-0000-4000-8000-000000000903',
      hospitalId: '00000000-0000-4000-8000-000000000904',
      staffStatus: 'active',
      hospital: { isActive: true },
    },
  };
  const prisma = {
    user: {
      findFirst: async ({ where }) => (where.email === staffUser.email ? staffUser : adminUser),
      findUnique: async ({ where }) => (where.id === staffId ? staffUser : adminUser),
    },
    auditLog: {
      create: async ({ data }) => {
        const event = { id: `audit-${events.length + 1}`, occurredAt: new Date(), ...data };
        events.push(event);
        return event;
      },
      findMany: async ({ where, skip, take }) => events
        .filter((event) => Object.entries(where).every(([key, value]) => event[key] === value))
        .slice(skip, skip + take),
      count: async ({ where }) => events
        .filter((event) => Object.entries(where).every(([key, value]) => event[key] === value))
        .length,
    },
  };
  return {
    app: createApp({ prisma, sessionSecret, clientOrigin }),
    events,
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

test('audit event records actor, action, entity, fields, and only allowlisted metadata', async () => {
  let auditData;
  await writeAudit({
    auditLog: {
      create: async ({ data }) => {
        auditData = data;
      },
    },
  }, { auth: { user: { id: adminId } } }, {
    action: 'blood_unit.status_changed',
    entityType: 'blood_unit',
    entityId: '00000000-0000-4000-8000-000000000905',
    changedFields: ['unitStatus'],
    metadata: {
      changeCategory: 'inventory_status',
      fromStatus: 'quarantined',
      toStatus: 'available',
      resultCode: 'PRIVATE',
      password: 'never-log-this',
    },
  });

  assert.equal(auditData.actorUserId, adminId);
  assert.equal(auditData.action, 'blood_unit.status_changed');
  assert.equal(auditData.entityType, 'blood_unit');
  assert.deepEqual(auditData.changedFields, ['unitStatus']);
  assert.deepEqual(auditData.metadata, {
    changeCategory: 'inventory_status',
    fromStatus: 'quarantined',
    toStatus: 'available',
  });
  assert.deepEqual(safeAuditMetadata({ token: 'secret', roleCode: 'ADMIN' }), { roleCode: 'ADMIN' });
  await assert.rejects(() => writeAudit({
    auditLog: { create: async () => assert.fail('Sensitive field names must not be stored.') },
  }, { auth: { user: { id: adminId } } }, {
    action: 'laboratory_test.updated',
    entityType: 'laboratory_test',
    entityId: '00000000-0000-4000-8000-000000000906',
    changedFields: ['resultCode'],
  }), /non-sensitive changed fields/);
});

test('audit log listing is administrator-only, filtered, and read-only', async () => {
  const { app, events } = createAuditApp();
  const admin = await login(app, 'ADMIN');
  const listing = await admin.get('/api/audit-logs?action=audit_log.viewed');

  assert.equal(listing.status, 200);
  assert.equal(listing.body.auditLogs.length, 1);
  assert.equal(listing.body.auditLogs[0].actorUserId, adminId);
  assert.equal(events[0].action, 'audit_log.viewed');
  assert.deepEqual(events[0].metadata, { accessScope: 'audit_log_collection' });

  assert.equal((await admin.post('/api/audit-logs').send({ action: 'forged' })).status, 404);
  assert.equal((await admin.delete('/api/audit-logs')).status, 404);
  assert.equal((await admin.patch('/api/audit-logs').send({ action: 'forged' })).status, 404);
});

test('ordinary staff cannot view audit logs or create access events for denied reads', async () => {
  const { app, events } = createAuditApp();
  const staff = await login(app, 'STAFF');
  const response = await staff.get('/api/audit-logs');

  assert.equal(response.status, 403);
  assert.equal(events.length, 0);
});
