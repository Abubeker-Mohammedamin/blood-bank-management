import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const rollback = new Error('Rollback synthetic PostgreSQL test records.');

export function isPostgresIntegrationEnabled() {
  return process.env.RUN_POSTGRES_INTEGRATION_TESTS === '1';
}

export function configurePostgresTestDatabase() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  assert.ok(testDatabaseUrl, 'TEST_DATABASE_URL must point to a dedicated local *_test database.');
  const target = new URL(testDatabaseUrl);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  assert.ok(loopbackHosts.has(target.hostname), 'PostgreSQL integration tests only run on a loopback host.');
  assert.match(databaseName, /_test$/, 'PostgreSQL integration tests require a database name ending in _test.');

  if (process.env.DATABASE_URL) {
    const applicationTarget = new URL(process.env.DATABASE_URL);
    assert.ok(
      target.host !== applicationTarget.host || databaseName !== decodeURIComponent(applicationTarget.pathname.slice(1)),
      'TEST_DATABASE_URL must not target the configured application database.',
    );
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  return testDatabaseUrl;
}

export async function getPostgresTestPrisma() {
  configurePostgresTestDatabase();
  const { prisma } = await import('../src/db.js');
  return prisma;
}

export async function withRollback(prisma, callback, options = { timeout: 30_000 }) {
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      await callback(transaction);
      throw rollback;
    }, options),
    (error) => error === rollback,
  );
}

export function uniqueTestValue(prefix) {
  return `${prefix}-${randomUUID().replaceAll('-', '')}`;
}

export async function createPostgresFixture(transaction) {
  const suffix = randomUUID().replaceAll('-', '');
  const hospital = await transaction.hospital.create({
    data: { name: `Synthetic Test Hospital ${suffix}`, registrationNumber: `TEST-${suffix}` },
  });
  const user = await transaction.user.create({
    data: {
      email: `test-${suffix}@example.test`,
      displayName: `Synthetic Test User ${suffix}`,
      accountStatus: 'active',
    },
  });
  const staffUser = await transaction.user.create({
    data: {
      email: `staff-${suffix}@example.test`,
      displayName: `Synthetic Test Staff ${suffix}`,
      accountStatus: 'active',
    },
  });
  const staff = await transaction.staff.create({
    data: {
      userId: staffUser.id,
      hospitalId: hospital.id,
      employeeNumber: `EMP-${suffix}`,
    },
  });
  const donorUser = await transaction.user.create({
    data: {
      email: `donor-${suffix}@example.test`,
      displayName: `Synthetic Test Donor ${suffix}`,
      accountStatus: 'active',
    },
  });
  const donor = await transaction.donor.create({
    data: { userId: donorUser.id, donorNumber: `DON-${suffix}` },
  });
  const bloodTypes = await transaction.bloodType.findMany({ select: { aboGroup: true, rhFactor: true } });
  const combinations = [
    ['O', '-'], ['O', '+'], ['A', '-'], ['A', '+'],
    ['B', '-'], ['B', '+'], ['AB', '-'], ['AB', '+'],
  ];
  const unusedCombination = combinations.find(([abo, rh]) => (
    !bloodTypes.some((item) => item.aboGroup === abo && item.rhFactor === rh)
  ));
  const bloodType = unusedCombination
    ? await transaction.bloodType.create({
      data: {
        code: `T${suffix.slice(0, 5)}`,
        aboGroup: unusedCombination[0],
        rhFactor: unusedCombination[1],
      },
    })
    : await transaction.bloodType.findFirst();
  assert.ok(bloodType, 'The test database needs at least one blood type reference record.');

  return { hospital, user, staff, staffUser, donor, bloodType };
}

export async function createSyntheticDonationUnit(transaction, fixture, {
  status = 'available',
  expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  withApprovedTests = true,
} = {}) {
  const suffix = randomUUID().replaceAll('-', '');
  const bloodGroupCode = `${fixture.bloodType.aboGroup}_${fixture.bloodType.rhFactor === '+' ? 'POS' : 'NEG'}`;
  const donation = await transaction.donation.create({
    data: {
      donationNumber: `DON-${suffix}`,
      donorId: fixture.donor.id,
      hospitalId: fixture.hospital.id,
      collectedAt: new Date(),
      donationStatus: 'collected',
    },
  });
  const bloodUnit = await transaction.bloodUnit.create({
    data: {
      donationId: donation.id,
      unitCode: `UNIT-${suffix}`,
      componentType: 'red_cells',
      unitStatus: status,
      collectedAt: new Date(),
      expiresAt,
    },
  });

  if (withApprovedTests) {
    const bloodTypeTest = await transaction.laboratoryTest.create({
      data: {
        donationId: donation.id,
        bloodUnitId: bloodUnit.id,
        testType: 'ABO_RH',
        performedByStaffId: fixture.staff.id,
        reviewedByStaffId: fixture.staff.id,
        testStatus: 'completed',
        reviewStatus: 'approved',
        resultCode: bloodGroupCode,
        resultBloodTypeId: fixture.bloodType.id,
        performedAt: new Date(),
        completedAt: new Date(),
        reviewedAt: new Date(),
      },
    });
    await transaction.laboratoryTest.create({
      data: {
        donationId: donation.id,
        bloodUnitId: bloodUnit.id,
        testType: 'INFECTIOUS',
        performedByStaffId: fixture.staff.id,
        reviewedByStaffId: fixture.staff.id,
        testStatus: 'completed',
        reviewStatus: 'approved',
        resultCode: 'NEG',
        performedAt: new Date(),
        completedAt: new Date(),
        reviewedAt: new Date(),
      },
    });
    await transaction.donationBloodType.create({
      data: {
        donationId: donation.id,
        bloodTypeId: fixture.bloodType.id,
        verifiedByTestId: bloodTypeTest.id,
        verifiedAt: new Date(),
      },
    });
  }

  return { donation, bloodUnit };
}
