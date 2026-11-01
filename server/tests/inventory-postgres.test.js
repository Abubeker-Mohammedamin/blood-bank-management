import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  buildInventorySnapshot,
  unitReleaseBlockers,
} from '../src/workflows/inventory-routes.js';
import {
  createPostgresFixture,
  createSyntheticDonationUnit,
  getPostgresTestPrisma,
  isPostgresIntegrationEnabled,
  uniqueTestValue,
  withRollback,
} from './postgres-test-utils.js';

const requiredTestTypes = ['ABO_RH', 'INFECTIOUS'];

after(async () => {
  if (isPostgresIntegrationEnabled()) {
    const prisma = await getPostgresTestPrisma();
    await prisma.$disconnect();
  }
});

test('inventory calculations use synthetic PostgreSQL units and exclude expired stock', {
  skip: !isPostgresIntegrationEnabled(),
}, async () => {
  const prisma = await getPostgresTestPrisma();
  await withRollback(prisma, async (transaction) => {
    const fixture = await createPostgresFixture(transaction);
    const now = new Date();
    const eligible = await createSyntheticDonationUnit(transaction, fixture, {
      status: 'available',
      expiresAt: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
    });
    const expired = await createSyntheticDonationUnit(transaction, fixture, {
      status: 'available',
      expiresAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    });
    const units = await transaction.bloodUnit.findMany({
      where: { id: { in: [eligible.bloodUnit.id, expired.bloodUnit.id] } },
      select: {
        id: true,
        unitCode: true,
        componentType: true,
        unitStatus: true,
        expiresAt: true,
        donation: {
          select: {
            bloodType: {
              select: {
                bloodType: { select: { code: true, aboGroup: true, rhFactor: true } },
              },
            },
          },
        },
        laboratoryTests: {
          select: {
            testType: true,
            attemptNo: true,
            testStatus: true,
            reviewStatus: true,
            resultCode: true,
          },
          orderBy: [{ testType: 'asc' }, { attemptNo: 'desc' }],
        },
      },
    });

    const snapshot = buildInventorySnapshot(units, {
      thresholds: {},
      expiryWarningDays: 30,
      requiredTestTypes,
      now,
    });
    const independentlyEligible = units.filter((unit) => (
      unit.unitStatus === 'available'
      && unit.expiresAt > now
      && unit.donation.bloodType?.bloodType?.code
      && unitReleaseBlockers(unit, requiredTestTypes, now).length === 0
    ));

    assert.equal(independentlyEligible.length, 1);
    assert.equal(snapshot.stock.reduce((total, row) => total + row.available, 0), 1);
    assert.equal(snapshot.stock[0].bloodGroup, `${fixture.bloodType.aboGroup}${fixture.bloodType.rhFactor}`);
    assert.ok(snapshot.blockedUnits.some((unit) => unit.id === expired.bloodUnit.id));
  });
});

test('PostgreSQL rejects duplicate active allocations for one synthetic blood unit', {
  skip: !isPostgresIntegrationEnabled(),
}, async () => {
  const prisma = await getPostgresTestPrisma();
  await withRollback(prisma, async (transaction) => {
    const fixture = await createPostgresFixture(transaction);
    const { bloodUnit } = await createSyntheticDonationUnit(transaction, fixture);
    const request = await transaction.bloodRequest.create({
      data: {
        requestNumber: uniqueTestValue('REQ'),
        hospitalId: fixture.hospital.id,
        requestedByUserId: fixture.user.id,
        bloodTypeId: fixture.bloodType.id,
        componentType: bloodUnit.componentType,
        quantityRequested: 1,
      },
    });
    const allocation = {
      bloodRequestId: request.id,
      bloodUnitId: bloodUnit.id,
      allocatedByUserId: fixture.user.id,
    };
    await transaction.allocation.create({ data: allocation });
    await assert.rejects(
      transaction.allocation.create({ data: allocation }),
      (error) => error.code === 'P2002',
    );
  });
});

test('PostgreSQL preserves synthetic request-to-dispatch-to-donor traceability', {
  skip: !isPostgresIntegrationEnabled(),
}, async () => {
  const prisma = await getPostgresTestPrisma();
  await withRollback(prisma, async (transaction) => {
    const fixture = await createPostgresFixture(transaction);
    const { bloodUnit } = await createSyntheticDonationUnit(transaction, fixture);
    const bloodRequest = await transaction.bloodRequest.create({
      data: {
        requestNumber: uniqueTestValue('REQ'),
        hospitalId: fixture.hospital.id,
        requestedByUserId: fixture.user.id,
        bloodTypeId: fixture.bloodType.id,
        componentType: bloodUnit.componentType,
        quantityRequested: 1,
        statusHistory: {
          create: {
            changedByUserId: fixture.user.id,
            newStatus: 'open',
            note: 'Synthetic rollback-only workflow test.',
          },
        },
      },
    });
    await transaction.bloodRequest.update({
      where: { id: bloodRequest.id },
      data: {
        requestStatus: 'approved',
        reviewedByUserId: fixture.user.id,
        reviewedAt: new Date(),
        statusHistory: {
          create: {
            changedByUserId: fixture.user.id,
            previousStatus: 'open',
            newStatus: 'approved',
          },
        },
      },
    });
    const allocation = await transaction.allocation.create({
      data: {
        bloodRequestId: bloodRequest.id,
        bloodUnitId: bloodUnit.id,
        allocatedByUserId: fixture.user.id,
      },
    });
    const dispatch = await transaction.bloodDispatch.create({
      data: {
        allocationId: allocation.id,
        bloodRequestId: bloodRequest.id,
        bloodUnitId: bloodUnit.id,
        dispatchedByUserId: fixture.user.id,
        dispatchedByStaffId: fixture.staff.id,
        statusHistory: {
          create: {
            changedByUserId: fixture.user.id,
            newStatus: 'dispatched',
          },
        },
      },
    });
    await transaction.bloodDispatch.update({
      where: { id: dispatch.id },
      data: {
        deliveryStatus: 'delivered',
        deliveredAt: new Date(),
        finalDisposition: 'not_transfused',
        statusHistory: {
          create: {
            changedByUserId: fixture.user.id,
            previousStatus: 'dispatched',
            newStatus: 'delivered',
            finalDisposition: 'not_transfused',
          },
        },
      },
    });
    const trace = await transaction.bloodDispatch.findUnique({
      where: { id: dispatch.id },
      include: {
        bloodRequest: { select: { id: true } },
        allocation: { select: { id: true, bloodUnitId: true } },
        bloodUnit: {
          select: { id: true, donation: { select: { id: true, donorId: true } } },
        },
        statusHistory: { orderBy: { changedAt: 'asc' } },
      },
    });

    assert.equal(trace.bloodRequest.id, bloodRequest.id);
    assert.equal(trace.allocation.id, allocation.id);
    assert.equal(trace.allocation.bloodUnitId, bloodUnit.id);
    assert.equal(trace.bloodUnit.donation.donorId, fixture.donor.id);
    assert.deepEqual(trace.statusHistory.map((entry) => entry.newStatus), ['dispatched', 'delivered']);
  });
});
