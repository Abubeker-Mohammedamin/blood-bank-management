import { Router } from 'express';
import { requireAuthentication } from '../auth/auth-middleware.js';
import { requirePermission } from '../auth/authorization.js';
import { buildInventorySnapshot } from '../workflows/inventory-routes.js';

const DAY_MS = 86400000;
const MAX_RANGE_DAYS = 366;
const reportUnitSelect = {
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
};

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function parseDateRange(query, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = query.startDate === undefined
    ? new Date(today.getTime() - (29 * DAY_MS))
    : parseDate(query.startDate);
  const end = query.endDate === undefined ? today : parseDate(query.endDate);
  if (!start || !end || start > end) return null;
  const days = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) return null;
  return {
    start,
    endExclusive: new Date(end.getTime() + DAY_MS),
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    days,
  };
}

function latestTestReviews(tests = []) {
  const latest = new Map();
  for (const test of tests) {
    const previous = latest.get(test.testType);
    if (!previous || test.attemptNo > previous.attemptNo) latest.set(test.testType, test);
  }
  return [...latest.values()];
}

function calculateReports({
  donations = [],
  units = [],
  requests = [],
  requestStatusChanges = [],
  dispatches = [],
  movements = [],
  eligibleAvailableUnits = 0,
  eligibleByGroupComponent = {},
  startDate,
  endDate,
  now = new Date(),
}) {
  const donationDays = new Map();
  for (const donation of donations) {
    const date = donation.collectedAt.toISOString().slice(0, 10);
    const current = donationDays.get(date) || { date, donations: 0, volumeMl: 0 };
    current.donations += 1;
    current.volumeMl += donation.volumeMl || 0;
    donationDays.set(date, current);
  }
  const donationTrends = [];
  const firstDay = new Date(`${startDate}T00:00:00.000Z`);
  const lastDay = new Date(`${endDate}T00:00:00.000Z`);
  for (let day = firstDay; day <= lastDay; day = new Date(day.getTime() + DAY_MS)) {
    const date = day.toISOString().slice(0, 10);
    donationTrends.push(donationDays.get(date) || { date, donations: 0, volumeMl: 0 });
  }

  const distributionByKey = new Map();
  let expiredUnits = 0;
  let rejectedUnits = 0;
  for (const unit of units) {
    const bloodType = unit.donation?.bloodType?.bloodType;
    const bloodGroup = bloodType ? `${bloodType.aboGroup}${bloodType.rhFactor}` : 'Unconfirmed';
    const key = `${bloodGroup}|${unit.componentType}`;
    const row = distributionByKey.get(key) || {
      bloodGroup,
      componentType: unit.componentType,
      totalUnits: 0,
      available: 0,
      releaseEligibleAvailable: eligibleByGroupComponent[key] || 0,
      quarantined: 0,
      reserved: 0,
      issued: 0,
      expired: 0,
      discarded: 0,
    };
    row.totalUnits += 1;
    if (Object.hasOwn(row, unit.unitStatus)) row[unit.unitStatus] += 1;
    const isExpired = unit.unitStatus === 'expired' || unit.expiresAt <= now;
    if (isExpired) expiredUnits += 1;
    if (latestTestReviews(unit.laboratoryTests).some((test) => test.reviewStatus === 'rejected')) {
      rejectedUnits += 1;
    }
    distributionByKey.set(key, row);
  }

  const requestStatuses = new Map();
  let fulfilledRequests = 0;
  for (const request of requests) {
    requestStatuses.set(request.requestStatus, (requestStatuses.get(request.requestStatus) || 0) + 1);
    if (request.requestStatus === 'fulfilled') fulfilledRequests += 1;
  }
  const fulfilledDispatches = dispatches.length;
  const requestFulfillment = {
    submittedRequests: requests.length,
    currentStatusCounts: [...requestStatuses.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([status, count]) => ({ status, count })),
    fulfilledRequests,
    fulfillmentRatePercent: requests.length
      ? Number(((fulfilledRequests / requests.length) * 100).toFixed(2))
      : 0,
    dispatchesInPeriod: fulfilledDispatches,
  };

  const activityCounts = new Map();
  function recordActivity(type, timestamp) {
    const date = timestamp.toISOString().slice(0, 10);
    const key = `${date}|${type}`;
    activityCounts.set(key, (activityCounts.get(key) || 0) + 1);
  }
  for (const donation of donations) recordActivity('donation_collected', donation.collectedAt);
  for (const request of requests) recordActivity('request_submitted', request.requestedAt);
  for (const change of requestStatusChanges) recordActivity('request_status_changed', change.changedAt);
  for (const dispatch of dispatches) recordActivity('unit_dispatched', dispatch.dispatchedAt);
  for (const movement of movements) recordActivity('inventory_movement', movement.movedAt);

  const operationalActivity = [...activityCounts.entries()]
    .map(([key, count]) => {
      const [date, type] = key.split('|');
      return { date, type, count };
    })
    .sort((first, second) => first.date.localeCompare(second.date) || first.type.localeCompare(second.type));

  const turnoverDenominator = fulfilledDispatches + eligibleAvailableUnits;
  return {
    range: { startDate, endDate },
    donationTrends,
    bloodGroupComponentDistribution: [...distributionByKey.values()]
      .sort((first, second) => first.bloodGroup.localeCompare(second.bloodGroup)
        || first.componentType.localeCompare(second.componentType)),
    inventoryTurnover: {
      dispatchedUnits: fulfilledDispatches,
      eligibleAvailableUnits,
      turnoverRatio: turnoverDenominator
        ? Number((fulfilledDispatches / turnoverDenominator).toFixed(4))
        : 0,
    },
    requestFulfillment,
    expiredOrRejectedUnits: { expiredUnits, rejectedUnits },
    operationalActivity,
  };
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function reportsToCsv(reports) {
  const rows = [['report', 'date', 'category', 'metric', 'value']];
  rows.push(['report_period', '', '', 'start_date_utc', reports.range.startDate]);
  rows.push(['report_period', '', '', 'end_date_utc_inclusive', reports.range.endDate]);
  for (const item of reports.donationTrends) {
    rows.push(['donation_trends', item.date, '', 'donations', item.donations]);
    rows.push(['donation_trends', item.date, '', 'volume_ml', item.volumeMl]);
  }
  for (const item of reports.bloodGroupComponentDistribution) {
    for (const metric of ['totalUnits', 'available', 'releaseEligibleAvailable', 'quarantined', 'reserved', 'issued', 'expired', 'discarded']) {
      rows.push(['blood_group_component_distribution', '', `${item.bloodGroup}|${item.componentType}`, metric, item[metric]]);
    }
  }
  rows.push(['inventory_turnover', '', '', 'dispatched_units', reports.inventoryTurnover.dispatchedUnits]);
  rows.push(['inventory_turnover', '', '', 'eligible_available_units_as_of_report', reports.inventoryTurnover.eligibleAvailableUnits]);
  rows.push(['inventory_turnover', '', '', 'turnover_ratio', reports.inventoryTurnover.turnoverRatio]);
  for (const item of reports.requestFulfillment.currentStatusCounts) {
    rows.push(['request_fulfillment', '', item.status, 'requests', item.count]);
  }
  rows.push(['request_fulfillment', '', '', 'submitted_requests', reports.requestFulfillment.submittedRequests]);
  rows.push(['request_fulfillment', '', '', 'fulfilled_requests', reports.requestFulfillment.fulfilledRequests]);
  rows.push(['request_fulfillment', '', '', 'fulfillment_rate_percent', reports.requestFulfillment.fulfillmentRatePercent]);
  for (const [metric, value] of Object.entries(reports.expiredOrRejectedUnits)) {
    rows.push(['expired_or_rejected_units', '', '', metric, value]);
  }
  for (const item of reports.operationalActivity) {
    rows.push(['operational_activity', item.date, item.type, 'events', item.count]);
  }
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function createReportsRouter({ prisma, requiredTestTypes = [] }) {
  const router = Router();
  const authenticate = requireAuthentication(prisma);

  async function loadReports(request, response, next) {
    const range = parseDateRange(request.query);
    if (!range) {
      return response.status(400).json({
        error: {
          code: 'INVALID_REPORT_RANGE',
          message: 'Provide valid UTC startDate/endDate values spanning no more than 366 days.',
        },
      });
    }
    const user = request.auth.user;
    if (user.roles.includes('STAFF') && user.hospitalIds.length === 0) {
      return response.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Your staff account has no active facility for reports.' },
      });
    }
    const hospitalScope = user.roles.includes('ADMIN') ? null : user.hospitalIds;
    const dateRange = { gte: range.start, lt: range.endExclusive };
    const hospitalFilter = hospitalScope ? { in: hospitalScope } : undefined;
    const unitsWhere = {
      AND: [
        ...(hospitalFilter ? [{ donation: { hospitalId: hospitalFilter } }] : []),
        { collectedAt: dateRange },
      ],
    };
    const inventoryWhere = {
      AND: [
        ...(hospitalFilter ? [{ donation: { hospitalId: hospitalFilter } }] : []),
        { unitStatus: { in: ['available', 'quarantined', 'expired'] } },
      ],
    };
    const requestWhere = {
      AND: [
        ...(hospitalFilter ? [{ hospitalId: hospitalFilter }] : []),
        { requestedAt: dateRange },
      ],
    };
    const dispatchWhere = hospitalFilter
      ? { AND: [{ dispatchedAt: dateRange }, { bloodRequest: { hospitalId: hospitalFilter } }] }
      : { dispatchedAt: dateRange };
    const movementWhere = {
      AND: [
        { movedAt: dateRange },
        ...(hospitalFilter ? [{
          OR: [
            { bloodUnit: { donation: { hospitalId: hospitalFilter } } },
            { fromStorageLocation: { hospitalId: hospitalFilter } },
            { toStorageLocation: { hospitalId: hospitalFilter } },
          ],
        }] : []),
      ],
    };

    try {
      const [donations, units, currentUnits, requests, requestStatusChanges, dispatches, movements] = await Promise.all([
        prisma.donation.findMany({
          where: {
            AND: [
              ...(hospitalFilter ? [{ hospitalId: hospitalFilter }] : []),
              { collectedAt: dateRange },
            ],
          },
          select: { collectedAt: true, volumeMl: true },
        }),
        prisma.bloodUnit.findMany({ where: unitsWhere, select: reportUnitSelect }),
        prisma.bloodUnit.findMany({ where: inventoryWhere, select: reportUnitSelect }),
        prisma.bloodRequest.findMany({
          where: requestWhere,
          select: { requestStatus: true, requestedAt: true },
        }),
        prisma.bloodRequestStatusHistory.findMany({
          where: {
            AND: [
              { changedAt: dateRange },
              ...(hospitalFilter ? [{ bloodRequest: { hospitalId: hospitalFilter } }] : []),
            ],
          },
          select: { changedAt: true },
        }),
        prisma.bloodDispatch.findMany({
          where: dispatchWhere,
          select: { dispatchedAt: true },
        }),
        prisma.bloodUnitMovement.findMany({
          where: movementWhere,
          select: { movedAt: true },
        }),
      ]);
      const snapshot = buildInventorySnapshot(currentUnits, {
        thresholds: {},
        expiryWarningDays: null,
        now: new Date(),
        requiredTestTypes,
      });
      const cohortSnapshot = buildInventorySnapshot(units, {
        thresholds: {},
        expiryWarningDays: null,
        now: new Date(),
        requiredTestTypes,
      });
      request.reportData = calculateReports({
        donations,
        units,
        requests,
        requestStatusChanges,
        dispatches,
        movements,
        eligibleAvailableUnits: snapshot.stock.reduce((total, row) => total + row.available, 0),
        eligibleByGroupComponent: Object.fromEntries(
          cohortSnapshot.stock.map((row) => [`${row.bloodGroup}|${row.componentType}`, row.available]),
        ),
        startDate: range.startDate,
        endDate: range.endDate,
      });
      return next();
    } catch (error) {
      return next(error);
    }
  }

  router.get(
    '/',
    authenticate,
    requirePermission(prisma, 'reports', 'view'),
    loadReports,
    (request, response) => response.json({
      ...request.reportData,
      definitions: {
        donationTrends: 'Collections recorded by collectedAt; volume is the sum of recorded volumeMl.',
        bloodGroupComponentDistribution: 'Units collected in the selected date range grouped by confirmed blood group and component. Status columns show current stored status; release-eligible available is separately filtered through the configured inventory release rules.',
        inventoryTurnover: 'Dispatched units during the selected range divided by dispatched units plus currently release-eligible available units. This is an end-stock proxy, not an average-inventory accounting ratio.',
        requestFulfillment: 'Requests submitted in the selected range; fulfillment rate is the share currently in fulfilled status. Dispatch count is based on dispatchedAt within the range.',
        expiredOrRejectedUnits: 'Units collected in range that are currently marked expired or whose expiry date has passed; rejected count includes units whose latest attempt for any recorded test type is rejected.',
        operationalActivity: 'Counts of donation collections, request submissions and status changes, unit dispatches, and inventory movements by event date.',
      },
    }),
  );

  router.get(
    '/export.csv',
    authenticate,
    requirePermission(prisma, 'reports', 'export'),
    loadReports,
    (request, response) => {
      response
        .type('text/csv')
        .set('Content-Disposition', 'attachment; filename="blood-bank-reports.csv"')
        .send(reportsToCsv(request.reportData));
    },
  );

  return router;
}

export {
  calculateReports,
  createReportsRouter,
  csvCell,
  parseDateRange,
  reportsToCsv,
};
