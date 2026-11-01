import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';

const clientOrigin = 'http://localhost:5173';
const sessionSecret = 'test-session-secret-with-at-least-32-bytes';

function createTestApp({ user = null, createdUser = null } = {}) {
  const prisma = {
    user: {
      findFirst: async () => user,
      findUnique: async () => user,
      create: async ({ data, select }) => {
        createdUser.data = data;
        createdUser.select = select;
        return {
          id: '00000000-0000-4000-8000-000000000001',
          email: data.email,
          displayName: data.displayName,
        };
      },
    },
    role: {
      upsert: async ({ where, create }) => ({
        id: '00000000-0000-4000-8000-000000000002',
        code: where.code,
        name: create.name,
      }),
    },
    $transaction: async (callback) => callback({
      role: prisma.role,
      user: prisma.user,
      auditLog: { create: async () => ({}) },
    }),
  };

  return createApp({
    prisma,
    sessionSecret,
    clientOrigin,
    loginLimiter: (_request, _response, next) => next(),
    registrationLimiter: (_request, _response, next) => next(),
  });
}

function withOrigin(requestBuilder) {
  return requestBuilder.set('Origin', clientOrigin);
}

test('rejects invalid credentials with a generic response', async () => {
  const app = createTestApp();
  const response = await withOrigin(request(app).post('/api/auth/login'))
    .send({ email: 'unknown@example.test', password: 'a-valid-length-password' });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body.error.code, 'INVALID_CREDENTIALS');
  assert.equal(response.body.error.message, 'Email or password is incorrect.');
  assert.equal(response.headers['set-cookie'], undefined);
});

test('rejects registration attempts that provide a privilege or role', async () => {
  let created = false;
  const app = createTestApp({ createdUser: { set data(_value) { created = true; } } });
  const response = await withOrigin(request(app).post('/api/auth/register'))
    .send({
      email: 'new@example.test',
      displayName: 'New Account',
      password: 'a-long-safe-password',
      role: 'ADMIN',
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_REGISTRATION');
  assert.equal(created, false);
});

test('registers only a donor role and returns no password material', async () => {
  const captured = {};
  const app = createTestApp({ createdUser: captured });
  const response = await withOrigin(request(app).post('/api/auth/register'))
    .send({
      email: '  Donor@Example.Test ',
      displayName: 'Example Donor',
      password: 'a-long-safe-password',
    });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body.user.roles, ['DONOR']);
  assert.equal(response.body.user.email, 'donor@example.test');
  assert.equal('password' in response.body.user, false);
  assert.equal('passwordHash' in response.body.user, false);
  assert.notEqual(captured.data.passwordHash, 'a-long-safe-password');
  assert.equal(await bcrypt.compare('a-long-safe-password', captured.data.passwordHash), true);
  assert.equal(
    captured.data.roleAssignments.create.role.connect.id,
    '00000000-0000-4000-8000-000000000002',
  );
  assert.match(captured.data.donorProfile.create.donorNumber, /^DON-[0-9A-F]{32}$/);
});

test('requires authentication and staff or administrator role for protected access', async () => {
  const anonymousApp = createTestApp();
  const anonymousResponse = await request(anonymousApp).get('/api/staff/session');
  assert.equal(anonymousResponse.status, 401);
  assert.equal(anonymousResponse.body.error.code, 'UNAUTHENTICATED');

  const donor = {
    id: '00000000-0000-4000-8000-000000000003',
    email: 'donor@example.test',
    displayName: 'Example Donor',
    passwordHash: await bcrypt.hash('correct-password', 4),
    accountStatus: 'active',
    disabledAt: null,
    roleAssignments: [{ role: { code: 'DONOR' } }],
  };
  const donorApp = createTestApp({ user: donor });
  const donorAgent = request.agent(donorApp);
  const loginResponse = await withOrigin(donorAgent.post('/api/auth/login'))
    .send({ email: donor.email, password: 'correct-password' });

  assert.equal(loginResponse.status, 200);
  assert.match(loginResponse.headers['set-cookie'][0], /HttpOnly/i);
  assert.match(loginResponse.headers['set-cookie'][0], /SameSite=Lax/i);
  const expiresAt = new Date(loginResponse.headers['set-cookie'][0].match(/Expires=([^;]+)/i)[1]);
  assert.ok(expiresAt.getTime() > Date.now() + 7 * 60 * 60 * 1000);
  assert.ok(expiresAt.getTime() < Date.now() + 9 * 60 * 60 * 1000);
  assert.equal(/;\s*Secure/i.test(loginResponse.headers['set-cookie'][0]), false);
  assert.equal('passwordHash' in loginResponse.body.user, false);
  assert.equal((await donorAgent.get('/api/staff/session')).status, 403);
  assert.equal((await donorAgent.get('/api/auth/me')).body.user.roles[0], 'DONOR');

  const logoutResponse = await withOrigin(donorAgent.post('/api/auth/logout'));
  assert.equal(logoutResponse.status, 204);
  assert.equal((await donorAgent.get('/api/auth/me')).status, 401);
});

test('rejects a valid password for an inactive account and does not create a session', async () => {
  const inactiveUser = {
    id: '00000000-0000-4000-8000-000000000004',
    email: 'inactive@example.test',
    displayName: 'Inactive Account',
    passwordHash: await bcrypt.hash('correct-password', 4),
    accountStatus: 'disabled',
    disabledAt: new Date(),
    roleAssignments: [],
  };
  const app = createTestApp({ user: inactiveUser });
  const response = await withOrigin(request(app).post('/api/auth/login'))
    .send({ email: inactiveUser.email, password: 'correct-password' });

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'ACCOUNT_INACTIVE');
  assert.equal(response.headers['set-cookie'], undefined);
});

test('expires the authenticated session after the account becomes inactive', async () => {
  const activeUser = {
    id: '00000000-0000-4000-8000-000000000005',
    email: 'active@example.test',
    displayName: 'Active Account',
    passwordHash: await bcrypt.hash('correct-password', 4),
    accountStatus: 'active',
    disabledAt: null,
    roleAssignments: [{ role: { code: 'STAFF' } }],
  };
  const app = createTestApp({ user: activeUser });
  const agent = request.agent(app);
  const loginResponse = await withOrigin(agent.post('/api/auth/login'))
    .send({ email: activeUser.email, password: 'correct-password' });
  assert.equal(loginResponse.status, 200);

  activeUser.accountStatus = 'disabled';
  activeUser.disabledAt = new Date();
  const inactiveResponse = await agent.get('/api/auth/me');
  assert.equal(inactiveResponse.status, 403);
  assert.equal(inactiveResponse.body.error.code, 'ACCOUNT_INACTIVE');
  assert.equal((await agent.get('/api/auth/me')).status, 401);
});

test('allows staff and administrators to access protected staff endpoints', async () => {
  const staff = {
    id: '00000000-0000-4000-8000-000000000006',
    email: 'staff@example.test',
    displayName: 'Example Staff',
    passwordHash: await bcrypt.hash('correct-password', 4),
    accountStatus: 'active',
    disabledAt: null,
    roleAssignments: [{ role: { code: 'STAFF' } }],
  };
  const app = createTestApp({ user: staff });
  const agent = request.agent(app);
  await withOrigin(agent.post('/api/auth/login'))
    .send({ email: staff.email, password: 'correct-password' });

  const response = await agent.get('/api/staff/session');
  assert.equal(response.status, 200);
  assert.equal(response.body.user.email, staff.email);
  assert.equal(response.body.user.roles[0], 'STAFF');
  assert.equal('passwordHash' in response.body.user, false);
});

test('marks production session cookies Secure over trusted HTTPS proxy', async () => {
  const staff = {
    id: '00000000-0000-4000-8000-000000000007',
    email: 'secure@example.test',
    displayName: 'Secure Staff',
    passwordHash: await bcrypt.hash('correct-password', 4),
    accountStatus: 'active',
    disabledAt: null,
    roleAssignments: [{ role: { code: 'STAFF' } }],
  };
  const app = createApp({
    prisma: {
      user: {
        findFirst: async () => staff,
      },
    },
    sessionSecret,
    clientOrigin,
    secureCookies: true,
    loginLimiter: (_request, _response, next) => next(),
    registrationLimiter: (_request, _response, next) => next(),
  });
  const response = await withOrigin(request(app).post('/api/auth/login'))
    .set('X-Forwarded-Proto', 'https')
    .send({ email: staff.email, password: 'correct-password' });

  assert.equal(response.status, 200);
  assert.match(response.headers['set-cookie'][0], /;\s*Secure/i);
});

test('rejects requests from an untrusted browser origin', async () => {
  const app = createTestApp();
  const response = await request(app)
    .post('/api/auth/login')
    .set('Origin', 'https://unexpected.example')
    .send({ email: 'any@example.test', password: 'a-valid-length-password' });

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'INVALID_ORIGIN');
});

test('rejects unauthenticated access when a session cookie is absent or invalid', async () => {
  const app = createTestApp();
  const noCookieResponse = await request(app).get('/api/auth/me');
  assert.equal(noCookieResponse.status, 401);

  const invalidCookieResponse = await request(app)
    .get('/api/auth/me')
    .set('Cookie', 'hema.sid=not-a-valid-session');
  assert.equal(invalidCookieResponse.status, 401);
});

test('requires a strong session signing secret at startup', () => {
  assert.throws(
    () => createApp({ prisma: {}, sessionSecret: 'short' }),
    /AUTH_SESSION_SECRET must contain at least 32 bytes/,
  );
});
