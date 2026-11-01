import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  getPostgresTestPrisma,
  isPostgresIntegrationEnabled,
  uniqueTestValue,
  withRollback,
} from './postgres-test-utils.js';

const clientOrigin = 'http://localhost:5173';
const sessionSecret = 'postgres-api-test-session-secret-with-more-than-32-bytes';

after(async () => {
  if (isPostgresIntegrationEnabled()) {
    const prisma = await getPostgresTestPrisma();
    await prisma.$disconnect();
  }
});

test('real Express APIs register donors and scope donor dashboards to the authenticated account', {
  skip: !isPostgresIntegrationEnabled(),
}, async () => {
  const prisma = await getPostgresTestPrisma();
  await withRollback(prisma, async (transaction) => {
    const appPrisma = new Proxy(transaction, {
      get(target, property, receiver) {
        if (property === '$transaction') {
          return (callback) => callback(transaction);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const app = createApp({
      prisma: appPrisma,
      sessionSecret,
      clientOrigin,
    });
    const firstEmail = `${uniqueTestValue('donor')}@example.test`;
    const otherEmail = `${uniqueTestValue('donor')}@example.test`;
    const password = 'Synthetic-test-password-2026';
    const firstAgent = request.agent(app);

    const registration = await firstAgent
      .post('/api/auth/register')
      .set('Origin', clientOrigin)
      .send({ email: firstEmail, displayName: 'Synthetic Donor One', password });
    assert.equal(registration.status, 201);
    assert.deepEqual(registration.body.user.roles, ['DONOR']);
    assert.equal('passwordHash' in registration.body.user, false);

    const otherRegistration = await request(app)
      .post('/api/auth/register')
      .set('Origin', clientOrigin)
      .send({ email: otherEmail, displayName: 'Synthetic Donor Two', password });
    assert.equal(otherRegistration.status, 201);

    const otherDonor = await transaction.donor.findUnique({
      where: { userId: otherRegistration.body.user.id },
    });
    const hospital = await transaction.hospital.create({
      data: { name: uniqueTestValue('Synthetic Hospital') },
    });
    await transaction.donation.create({
      data: {
        donationNumber: uniqueTestValue('DON'),
        donorId: otherDonor.id,
        hospitalId: hospital.id,
        donationStatus: 'collected',
        collectedAt: new Date(),
      },
    });

    const login = await firstAgent
      .post('/api/auth/login')
      .set('Origin', clientOrigin)
      .send({ email: firstEmail, password });
    assert.equal(login.status, 200);
    const dashboard = await firstAgent.get('/api/portal/donor');
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.profile.user.email, firstEmail);
    assert.deepEqual(dashboard.body.donations, []);
    assert.deepEqual(dashboard.body.appointments, []);
    assert.equal((await firstAgent.get('/api/staff/session')).status, 403);

    const registrationAudit = await transaction.auditLog.findFirst({
      where: {
        action: 'account.publicly_registered',
        entityId: registration.body.user.id,
      },
      select: { actorUserId: true, entityType: true },
    });
    assert.equal(registrationAudit.actorUserId, null);
    assert.equal(registrationAudit.entityType, 'user');
  });
});
