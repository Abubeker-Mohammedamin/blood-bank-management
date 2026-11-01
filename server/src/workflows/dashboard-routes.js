import { Router } from 'express';
import { requireAuthentication } from '../auth/auth-middleware.js';
import { buildInventorySnapshot } from './inventory-routes.js';

// Request statuses that still need staff attention. Closed requests
// (fulfilled, rejected, cancelled, expired) are excluded from the pending view.
const PENDING_REQUEST_STATUSES = ['open', 'approved', 'partially_fulfilled'];
const REQUEST_STATUS_ORDER = ['open', 'approved', 'partially_fulfilled'];
const REQUEST_PRIORITY_ORDER = ['emergency', 'urgent', 'routine'];
const COMPONENT_TYPES = ['whole_blood', 'red_cells', 'plasma', 'platelets'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// Reuse the documented inventory release-eligibility definition for the stock
// query. A unit counts as available stock only when it is `available`, not
// expired, blood-group confirmed, and every configured and recorded laboratory
// test type has a completed, approved latest attempt with a result code.
const dashboardUnitSelect = {
  id: true,
  unitCode: true,
  componentType: true,
  unitStatus: true,
  expiresAt: true,
  donation: {
    select: {
      bloodType: {
        select: { bloodType: { select: { code: true, aboGroup: true, rhFactor: true } } },
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

const expiringUnitSelect = {
  id: true,
  unitCode: true,
  componentType: true,
  unitStatus: true,
  expiresAt: true,
  currentStorageLocation: { select: { name: true } },
  donation: {
    select: {
      bloodType: {
        select: { bloodType: { select: { aboGroup: true, rhFactor: true } } },
      },
    },
  },
};

function isStaffMember(user) {
  return Boolean(user?.roles?.some((role) => ['ADMIN', 'STAFF'].includes(role)));
}

// Build the per-resource PostgreSQL where scopes. Administrators see every
// facility; staff are limited to their active facilities. This mirrors the
// ownership scoping used by the inventory, request, and donation routes so the
// dashboard never widens a user's existing access.
function buildDashboardScopes(user) {
  if (user.roles.includes('ADMIN')) {
    return { bloodUnits: {}, bloodRequests: {}, donations: {} };
  }
  const hospitalIds = user.hospitalIds || [];
  if (hospitalIds.length === 0) return null;
  const hospitalScope = { in: hospitalIds };
  return {
    bloodUnits: {
      OR: [
        { donation: { hospitalId: hospitalScope } },
        { currentStorageLocation: { hospitalId: hospitalScope } },
      ],
    },
    bloodRequests: { hospitalId: hospitalScope },
    donations: { hospitalId: hospitalScope },
  };
}

// Pure aggregation of pending request counts. Accepts any list of request
// records and counts only the pending statuses, returning ordered breakdowns
// by status and priority. Tested with synthetic records in dashboard.test.js.
function summarizePendingRequests(requests) {
  const pending = (requests || []).filter((request) => (
    PENDING_REQUEST_STATUSES.includes(request.requestStatus)
  ));
  const statusCounts = new Map();
  const priorityCounts = new Map();
  for (const request of pending) {
    statusCounts.set(request.requestStatus, (statusCounts.get(request.requestStatus) || 0) + 1);
    if (request.priority) {
      priorityCounts.set(request.priority, (priorityCounts.get(request.priority) || 0) + 1);
    }
  }
  const byStatus = REQUEST_STATUS_ORDER
    .filter((status) => statusCounts.has(status))
    .map((status) => ({ status, count: statusCounts.get(status) }));
  const byPriority = REQUEST_PRIORITY_ORDER
    .filter((priority) => priorityCounts.has(priority))
    .map((priority) => ({ priority, count: priorityCounts.get(priority) }));
  return { total: pending.length, byStatus, byPriority };
}

function buildDashboardStock(stock = []) {
  const availableByKey = new Map(
    stock.map((item) => [`${item.bloodGroup}|${item.componentType}`, item.available]),
  );
  return BLOOD_GROUPS.flatMap((bloodGroup) => COMPONENT_TYPES.map((componentType) => ({
    bloodGroup,
    componentType,
    available: availableByKey.get(`${bloodGroup}|${componentType}`) || 0,
  })));
}

// Pure merged timeline of recent operational records. Donations use their
// collection time; requests use their submission time. The feed is sorted most
// recent first and trimmed to `limit`. Tested with synthetic records.
function buildActivityFeed({ donations = [], requests = [], limit = 8 } = {}) {
  const events = [];
  for (const donation of donations) {
    const at = donation.collectedAt instanceof Date ? donation.collectedAt : new Date(donation.collectedAt);
    if (Number.isNaN(at.getTime())) continue;
    const donorLabel = donation.donor?.donorNumber || donation.donor?.user?.displayName;
    events.push({
      kind: 'donation',
      id: donation.id,
      at: at.toISOString(),
      title: `Donation ${donation.donationNumber} collected`,
      subtitle: [donorLabel, donation.hospital?.name].filter(Boolean).join(' · '),
      status: donation.donationStatus,
      href: `/donations?search=${encodeURIComponent(donation.donationNumber)}`,
    });
  }
  for (const request of requests) {
    const at = request.requestedAt instanceof Date ? request.requestedAt : new Date(request.requestedAt);
    if (Number.isNaN(at.getTime())) continue;
    const detail = [request.hospital?.name, request.bloodType?.code, request.componentType]
      .filter(Boolean)
      .join(' · ');
    events.push({
      kind: 'request',
      id: request.id,
      at: at.toISOString(),
      title: `Request ${request.requestNumber} submitted`,
      subtitle: detail,
      status: request.requestStatus,
      href: `/requests?requestId=${encodeURIComponent(request.id)}`,
    });
  }
  events.sort((first, second) => new Date(second.at).getTime() - new Date(first.at).getTime());
  return events.slice(0, limit);
}

function shapeExpiringUnit(unit, now) {
  const bloodType = unit.donation?.bloodType?.bloodType;
  return {
    id: unit.id,
    unitCode: unit.unitCode,
    bloodGroup: bloodType ? `${bloodType.aboGroup}${bloodType.rhFactor}` : null,
    componentType: unit.componentType,
    expiresAt: unit.expiresAt,
    storageLocation: unit.currentStorageLocation?.name || null,
    // Expiring units are filtered to the future window, so this reflects the
    // stored status rather than an expired override.
    operationalStatus: unit.unitStatus,
    daysUntilExpiry: Math.ceil((new Date(unit.expiresAt).getTime() - now.getTime()) / 86400000),
  };
}

function createDashboardRouter({ prisma, requiredTestTypes, lowStockThresholds, expiryWarningDays }) {
  const router = Router();
  const authenticate = requireAuthentication(prisma);

  router.get(
    '/',
    authenticate,
    async (request, response) => {
      const user = request.auth?.user;
      if (!isStaffMember(user)) {
        return response.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'The staff dashboard is available to blood bank staff and administrators.',
          },
        });
      }
      const scopes = buildDashboardScopes(user);
      if (!scopes) {
        return response.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have access to a facility for dashboard records.',
          },
        });
      }

      const now = new Date();
      const stockUnitWhere = {
        AND: [scopes.bloodUnits, { unitStatus: { in: ['available', 'quarantined', 'expired'] } }],
      };

      const stockUnits = await prisma.bloodUnit.findMany({
        where: stockUnitWhere,
        select: dashboardUnitSelect,
      });
      // Reuses the documented eligible-stock, low-stock, and release-blocker
      // definitions shared with the inventory page.
      const snapshot = buildInventorySnapshot(stockUnits, {
        thresholds: lowStockThresholds,
        expiryWarningDays,
        now,
        requiredTestTypes,
      });

      // Approaching-expiration alerts include reserved and available units
      // (any status except expired/discarded/issued) inside the configured
      // warning window, matching the inventory page definition.
      let expiringUnits = [];
      if (expiryWarningDays !== null) {
        const cutoff = new Date(now.getTime() + expiryWarningDays * 86400000);
        const rawExpiring = await prisma.bloodUnit.findMany({
          where: {
            AND: [
              scopes.bloodUnits,
              { expiresAt: { gt: now, lte: cutoff } },
              { unitStatus: { notIn: ['expired', 'discarded', 'issued'] } },
            ],
          },
          orderBy: { expiresAt: 'asc' },
          select: expiringUnitSelect,
        });
        expiringUnits = rawExpiring.map((unit) => shapeExpiringUnit(unit, now));
      }

      const pendingWhere = {
        AND: [scopes.bloodRequests, { requestStatus: { in: PENDING_REQUEST_STATUSES } }],
      };

      const [pendingCounts, pendingRecent, recentDonations, recentRequests] = await Promise.all([
        // Lightweight query: only the fields needed to aggregate counts, so
        // the totals stay correct even when many requests are pending.
        prisma.bloodRequest.findMany({
          where: pendingWhere,
          select: { requestStatus: true, priority: true },
        }),
        prisma.bloodRequest.findMany({
          where: pendingWhere,
          orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }],
          take: 8,
          include: {
            hospital: { select: { id: true, name: true } },
            bloodType: { select: { id: true, code: true, aboGroup: true, rhFactor: true } },
            requestedBy: { select: { id: true, displayName: true } },
            _count: { select: { allocations: true } },
          },
        }),
        prisma.donation.findMany({
          where: { AND: [scopes.donations, { collectedAt: { not: null } }] },
          orderBy: [{ collectedAt: 'desc' }, { id: 'asc' }],
          take: 6,
          select: {
            id: true,
            donationNumber: true,
            donationStatus: true,
            collectedAt: true,
            volumeMl: true,
            donor: { select: { donorNumber: true, user: { select: { displayName: true } } } },
            hospital: { select: { id: true, name: true } },
            bloodUnits: {
              select: { unitCode: true, unitStatus: true },
              orderBy: { unitCode: 'asc' },
            },
          },
        }),
        prisma.bloodRequest.findMany({
          where: scopes.bloodRequests,
          orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }],
          take: 6,
          select: {
            id: true,
            requestNumber: true,
            requestStatus: true,
            priority: true,
            requestedAt: true,
            componentType: true,
            hospital: { select: { name: true } },
            bloodType: { select: { code: true } },
          },
        }),
      ]);

      const pendingSummary = summarizePendingRequests(pendingCounts);
      const stock = buildDashboardStock(snapshot.stock);
      const activity = buildActivityFeed({
        donations: recentDonations,
        requests: recentRequests,
        limit: 8,
      });
      const stockTotal = stock.reduce((total, item) => total + item.available, 0);

      return response.json({
        generatedAt: now.toISOString(),
        configuration: {
          lowStockConfigured: Object.keys(lowStockThresholds).length > 0,
          expiryWarningDays,
          releaseConfigured: requiredTestTypes.length > 0,
        },
        // Eligible available stock by blood group and component. Excludes
        // quarantined, reserved, issued, expired, discarded, unconfirmed, and
        // release-blocked units by definition.
        stock,
        stockTotal,
        lowStock: snapshot.lowStock,
        expiringUnits,
        blockedUnits: snapshot.blockedUnits,
        pendingRequests: {
          ...pendingSummary,
          recent: pendingRecent,
        },
        recentDonations,
        activity,
      });
    },
  );

  return router;
}

export {
  BLOOD_GROUPS,
  COMPONENT_TYPES,
  PENDING_REQUEST_STATUSES,
  buildActivityFeed,
  buildDashboardStock,
  buildDashboardScopes,
  createDashboardRouter,
  summarizePendingRequests,
};
