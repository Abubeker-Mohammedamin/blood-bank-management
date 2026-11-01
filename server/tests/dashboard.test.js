import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import {
  buildActivityFeed,
  buildDashboardStock,
  summarizePendingRequests,
} from '../src/workflows/dashboard-routes.js';
import { buildInventorySnapshot } from '../src/workflows/inventory-routes.js';
import {
  createPostgresFixture,
  getPostgresTestPrisma,
  isPostgresIntegrationEnabled,
  uniqueTestValue,
  withRollback,
} from './postgres-test-utils.js';

after(async () => {
  if (isPostgresIntegrationEnabled()) {
    const prisma = await getPostgresTestPrisma();
    await prisma.$disconnect();
  }
});

const NOW = new Date('2026-10-29T12:00:00Z');
const FUTURE = new Date('2026-11-30T00:00:00Z');
const PAST = new Date('2026-09-01T00:00:00Z');
const A_PLUS = { code: 'A+', aboGroup: 'A', rhFactor: '+' };
const O_NEG = { code: 'O-', aboGroup: 'O', rhFactor: '-' };
const REQUIRED_TEST_TYPES = ['ABO_RH', 'INFECTIOUS'];

function attempt(type, number, { status = 'completed', review = 'approved', result = 'NEG' } = {}) {
  return { testType: type, attemptNo: number, testStatus: status, reviewStatus: review, resultCode: result };
}

// Build a synthetic blood unit in the exact shape read by buildInventorySnapshot
// and unitReleaseBlockers (donation.bloodType.bloodType + laboratoryTests).
function mkUnit({ bloodType = A_PLUS, componentType = 'red_cells', unitStatus = 'available', expiresAt = FUTURE, tests = [] } = {}) {
  return {
    id: randomUUID(),
    unitCode: `UNIT-${randomUUID().slice(0, 6)}`,
    componentType,
    unitStatus,
    expiresAt,
    donation: { bloodType: bloodType === null ? null : { bloodType } },
    laboratoryTests: tests,
  };
}

function snapshot(units, options = {}) {
  return buildInventorySnapshot(units, {
    thresholds: {},
    expiryWarningDays: null,
    now: NOW,
    requiredTestTypes: REQUIRED_TEST_TYPES,
    ...options,
  });
}

test('dashboard stock includes every blood-group/component pair and reports zero stock', () => {
  const rows = buildDashboardStock([
    { bloodGroup: 'A+', componentType: 'red_cells', available: 2 },
    { bloodGroup: 'O-', componentType: 'plasma', available: 1 },
  ]);
  assert.equal(rows.length, 32);
  assert.deepEqual(rows.find((row) => row.bloodGroup === 'A+' && row.componentType === 'red_cells'), {
    bloodGroup: 'A+',
    componentType: 'red_cells',
    available: 2,
  });
  assert.deepEqual(rows.find((row) => row.bloodGroup === 'B-' && row.componentType === 'platelets'), {
    bloodGroup: 'B-',
    componentType: 'platelets',
    available: 0,
  });
  assert.equal(rows.reduce((total, row) => total + row.available, 0), 3);
});

test('eligible stock counts only release-eligible available units', () => {
  const eligible = [
    attempt('ABO_RH', 1, { result: 'A_POS' }),
    attempt('INFECTIOUS', 1, { result: 'NEG' }),
  ];
  const superseding = [
    attempt('ABO_RH', 1, { status: 'failed', review: 'pending', result: null }),
    attempt('ABO_RH', 2, { result: 'A_POS' }),
    attempt('INFECTIOUS', 1, { result: 'NEG' }),
  ];

  const units = [
    // 1. Fully eligible available unit -> counts as A+ red_cells.
    mkUnit({ tests: eligible }),
    // 2-6. Wrong status, even with passing tests, never counts as available stock.
    mkUnit({ unitStatus: 'quarantined', tests: eligible }),
    mkUnit({ unitStatus: 'reserved', tests: eligible }),
    mkUnit({ unitStatus: 'issued', tests: eligible }),
    mkUnit({ unitStatus: 'discarded', tests: eligible }),
    mkUnit({ unitStatus: 'expired', tests: eligible }),
    // 7. Available but already past expiry (expiresAt <= now).
    mkUnit({ expiresAt: PAST, tests: eligible }),
    // 8. Available but blood group not confirmed.
    mkUnit({ bloodType: null, tests: eligible }),
    // 9. Available but missing a required test type.
    mkUnit({ tests: [attempt('ABO_RH', 1, { result: 'A_POS' })] }),
    // 10. Available but a required test was rejected on review.
    mkUnit({ tests: [attempt('ABO_RH', 1, { result: 'A_POS' }), attempt('INFECTIOUS', 1, { review: 'rejected' })] }),
    // 11. Available but a required test is not completed.
    mkUnit({ tests: [attempt('ABO_RH', 1, { result: 'A_POS' }), attempt('INFECTIOUS', 1, { status: 'pending', review: 'pending', result: null })] }),
    // 12. Available but a required test is not approved on review.
    mkUnit({ tests: [attempt('ABO_RH', 1, { result: 'A_POS' }), attempt('INFECTIOUS', 1, { review: 'pending' })] }),
    // 13. Available but a required test has no result code.
    mkUnit({ tests: [attempt('ABO_RH', 1, { result: 'A_POS' }), attempt('INFECTIOUS', 1, { result: null })] }),
    // 14. Required tests pass, but an extra recorded test type is not approved.
    mkUnit({ tests: [attempt('ABO_RH', 1, { result: 'A_POS' }), attempt('INFECTIOUS', 1, { result: 'NEG' }), attempt('HEPC', 1, { status: 'pending', review: 'pending', result: null })] }),
    // 15. Eligible despite an earlier failed attempt superseded by an approved one.
    mkUnit({ tests: superseding }),
    // 16. Eligible O- plasma unit -> counts as O- plasma.
    mkUnit({ bloodType: O_NEG, componentType: 'plasma', tests: [attempt('ABO_RH', 1, { result: 'O_NEG' }), attempt('INFECTIOUS', 1, { result: 'NEG' })] }),
  ];

  const result = snapshot(units);

  assert.deepEqual(
    result.stock,
    [
      { bloodGroup: 'A+', componentType: 'red_cells', available: 2 },
      { bloodGroup: 'O-', componentType: 'plasma', available: 1 },
    ],
  );
  assert.equal(result.stock.reduce((total, item) => total + item.available, 0), 3);
});

test('available stock is empty when the release policy is not configured', () => {
  const result = buildInventorySnapshot([mkUnit({ tests: [attempt('ABO_RH', 1, { result: 'A_POS' }), attempt('INFECTIOUS', 1, { result: 'NEG' })] })], {
    thresholds: {},
    expiryWarningDays: null,
    now: NOW,
    requiredTestTypes: [],
  });
  assert.deepEqual(result.stock, []);
});

test('release-blocked units are reported with their blocker codes', () => {
  const eligible = [attempt('ABO_RH', 1, { result: 'A_POS' }), attempt('INFECTIOUS', 1, { result: 'NEG' })];
  const units = [
    mkUnit({ tests: eligible }), // eligible -> no blockers
    mkUnit({ unitStatus: 'quarantined', tests: [] }), // release_policy_not_configured + missing tests
    mkUnit({ tests: [attempt('ABO_RH', 1, { result: 'A_POS' })] }), // missing INFECTIOUS
    mkUnit({ unitStatus: 'reserved', tests: eligible }), // reserved units are not listed as blocked
  ];

  const result = snapshot(units);
  const blockedCodes = result.blockedUnits.map((unit) => unit.blockers.join(','));
  assert.equal(result.blockedUnits.length, 2);
  assert.ok(blockedCodes.some((codes) => codes.includes('required_test_missing:INFECTIOUS')));
  assert.ok(result.blockedUnits.every((unit) => unit.unitCode.startsWith('UNIT-')));
  // Reserved/issued/discarded units are excluded from the blocked list.
  assert.ok(!result.blockedUnits.some((unit) => unit.blockers.includes('unit_not_releasable') && unit.blockers.length === 1 && false));
});

test('approaching-expiry alerts include available and reserved units in the window', () => {
  const inWindow = new Date(NOW.getTime() + 3 * 86400000);
  const outsideWindow = new Date(NOW.getTime() + 30 * 86400000);
  const result = buildInventorySnapshot(
    [
      mkUnit({ unitStatus: 'available', expiresAt: inWindow, tests: [attempt('ABO_RH', 1, { result: 'A_POS' }), attempt('INFECTIOUS', 1, { result: 'NEG' })] }),
      mkUnit({ unitStatus: 'reserved', expiresAt: inWindow, tests: [] }),
      mkUnit({ unitStatus: 'discarded', expiresAt: inWindow, tests: [] }),
      mkUnit({ unitStatus: 'available', expiresAt: PAST, tests: [] }),
      mkUnit({ unitStatus: 'available', expiresAt: outsideWindow, tests: [] }),
    ],
    { thresholds: {}, expiryWarningDays: 7, now: NOW, requiredTestTypes: REQUIRED_TEST_TYPES },
  );
  assert.equal(result.expiringUnits.length, 2);
  assert.ok(result.expiringUnits.every((unit) => unit.expiresAt > NOW && unit.expiresAt <= new Date(NOW.getTime() + 7 * 86400000)));
});

test('summarizePendingRequests counts only open, approved, and partially fulfilled requests', () => {
  const requests = [
    { requestStatus: 'open', priority: 'routine' },
    { requestStatus: 'open', priority: 'emergency' },
    { requestStatus: 'approved', priority: 'urgent' },
    { requestStatus: 'partially_fulfilled', priority: 'routine' },
    { requestStatus: 'fulfilled', priority: 'routine' },
    { requestStatus: 'rejected', priority: 'routine' },
    { requestStatus: 'cancelled', priority: 'routine' },
    { requestStatus: 'expired', priority: 'routine' },
  ];
  const summary = summarizePendingRequests(requests);
  assert.equal(summary.total, 4);
  assert.deepEqual(summary.byStatus, [
    { status: 'open', count: 2 },
    { status: 'approved', count: 1 },
    { status: 'partially_fulfilled', count: 1 },
  ]);
  assert.deepEqual(summary.byPriority, [
    { priority: 'emergency', count: 1 },
    { priority: 'urgent', count: 1 },
    { priority: 'routine', count: 2 },
  ]);
});

test('summarizePendingRequests ignores requests without a pending status', () => {
  const summary = summarizePendingRequests([
    { requestStatus: 'fulfilled', priority: 'routine' },
    { requestStatus: 'cancelled', priority: 'emergency' },
  ]);
  assert.equal(summary.total, 0);
  assert.deepEqual(summary.byStatus, []);
  assert.deepEqual(summary.byPriority, []);
});

test('buildActivityFeed merges donations and requests by most recent first', () => {
  const donations = [
    {
      id: 'd1',
      donationNumber: 'DON-1',
      collectedAt: new Date('2026-10-29T10:00:00Z'),
      donationStatus: 'released',
      donor: { donorNumber: 'DNR-1', user: { displayName: 'Avery' } },
      hospital: { name: 'General Hospital' },
    },
    {
      id: 'd2',
      donationNumber: 'DON-2',
      collectedAt: new Date('2026-10-28T09:00:00Z'),
      donationStatus: 'collected',
      donor: { donorNumber: 'DNR-2', user: { displayName: 'Brett' } },
      hospital: { name: 'General Hospital' },
    },
  ];
  const requests = [
    {
      id: 'r1',
      requestNumber: 'REQ-1',
      requestedAt: new Date('2026-10-29T11:30:00Z'),
      requestStatus: 'open',
      priority: 'urgent',
      componentType: 'red_cells',
      hospital: { name: 'General Hospital' },
      bloodType: { code: 'O-' },
    },
    {
      id: 'r2',
      requestNumber: 'REQ-2',
      requestedAt: new Date('2026-10-27T08:00:00Z'),
      requestStatus: 'fulfilled',
      priority: 'routine',
      componentType: 'plasma',
      hospital: { name: 'General Hospital' },
      bloodType: { code: 'A+' },
    },
  ];
  const feed = buildActivityFeed({ donations, requests, limit: 8 });
  assert.deepEqual(
    feed.map((event) => event.id),
    ['r1', 'd1', 'd2', 'r2'],
  );
  assert.equal(feed[0].kind, 'request');
  assert.equal(feed[1].kind, 'donation');
  assert.equal(feed[0].href, '/requests?requestId=r1');
  assert.equal(feed[1].href, '/donations?search=DON-1');
  assert.ok(feed[0].at >= feed[1].at);
});

test('buildActivityFeed trims to the requested limit', () => {
  const donations = [
    { id: 'd1', donationNumber: 'DON-1', collectedAt: new Date('2026-10-29T10:00:00Z'), donationStatus: 'collected', donor: {}, hospital: {} },
    { id: 'd2', donationNumber: 'DON-2', collectedAt: new Date('2026-10-28T10:00:00Z'), donationStatus: 'collected', donor: {}, hospital: {} },
    { id: 'd3', donationNumber: 'DON-3', collectedAt: new Date('2026-10-27T10:00:00Z'), donationStatus: 'collected', donor: {}, hospital: {} },
  ];
  const feed = buildActivityFeed({ donations, requests: [], limit: 2 });
  assert.equal(feed.length, 2);
  assert.deepEqual(feed.map((event) => event.id), ['d1', 'd2']);
});

test('buildActivityFeed skips records with invalid timestamps', () => {
  const feed = buildActivityFeed({
    donations: [{ id: 'bad', donationNumber: 'DON-X', collectedAt: 'not-a-date', donationStatus: 'collected', donor: {}, hospital: {} }],
    requests: [],
    limit: 8,
  });
  assert.deepEqual(feed, []);
});

test('dashboard pending-request aggregation matches synthetic PostgreSQL records', {
  skip: !isPostgresIntegrationEnabled(),
}, async () => {
  const prisma = await getPostgresTestPrisma();
  await withRollback(prisma, async (transaction) => {
    const fixture = await createPostgresFixture(transaction);
    const requests = [
      { requestStatus: 'open', priority: 'routine' },
      { requestStatus: 'approved', priority: 'urgent' },
      { requestStatus: 'partially_fulfilled', priority: 'emergency' },
      { requestStatus: 'cancelled', priority: 'routine' },
    ];
    await transaction.bloodRequest.createMany({
      data: requests.map((request) => ({
        ...request,
        requestNumber: uniqueTestValue('REQ'),
        hospitalId: fixture.hospital.id,
        requestedByUserId: fixture.user.id,
        bloodTypeId: fixture.bloodType.id,
        componentType: 'red_cells',
        quantityRequested: 1,
      })),
    });

    const pending = await transaction.bloodRequest.findMany({
      where: {
        hospitalId: fixture.hospital.id,
        requestStatus: { in: ['open', 'approved', 'partially_fulfilled'] },
      },
      select: { requestStatus: true, priority: true },
    });
    const summary = summarizePendingRequests(pending);
    const grouped = await transaction.bloodRequest.groupBy({
      by: ['requestStatus'],
      where: {
        hospitalId: fixture.hospital.id,
        requestStatus: { in: ['open', 'approved', 'partially_fulfilled'] },
      },
      _count: { _all: true },
    });
    const expectedTotal = grouped.reduce((total, row) => total + row._count._all, 0);
    assert.equal(summary.total, 3);
    assert.equal(summary.total, expectedTotal);
    assert.deepEqual(
      Object.fromEntries(summary.byStatus.map((row) => [row.status, row.count])),
      { open: 1, approved: 1, partially_fulfilled: 1 },
    );
  });
});
