import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { requireAuthentication } from '../auth/auth-middleware.js';
import { buildOwnershipFilter, requirePermission } from '../auth/authorization.js';
import { requireExpectedOrigin } from '../auth/origin-middleware.js';
import { isUuid, writeAudit } from '../management/management-utils.js';

const components = ['whole_blood', 'red_cells', 'plasma', 'platelets'];
const priorities = ['routine', 'urgent', 'emergency'];
const dispositions = {
  delivered: ['transfused', 'not_transfused'],
  returned: ['returned_to_inventory_quarantine'],
  discarded: ['discarded'],
};

class RequestWorkflowError extends Error {}

function invalid(response, message) {
  return response.status(400).json({ error: { code: 'INVALID_REQUEST', message } });
}

function conflict(response, message) {
  return response.status(409).json({ error: { code: 'WORKFLOW_CONFLICT', message } });
}

function validateUuidParam(paramName) {
  return (request, response, next) => {
    if (!isUuid(request.params[paramName])) return invalid(response, `${paramName} must be a valid UUID.`);
    return next();
  };
}

function requiredText(value, field, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new RequestWorkflowError(`${field} is required and must be 1 to ${maximum} characters.`);
  }
  return value.trim();
}

function optionalText(value, field, maximum) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > maximum) {
    throw new RequestWorkflowError(`${field} must be ${maximum} characters or fewer.`);
  }
  return value.trim() || null;
}

function parseDate(value, field, { future = false, past = false } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new RequestWorkflowError(`${field} must be a valid date and time.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new RequestWorkflowError(`${field} must be a valid date and time.`);
  const now = new Date();
  if (future && date <= now) throw new RequestWorkflowError(`${field} must be in the future.`);
  if (past && date > now) throw new RequestWorkflowError(`${field} cannot be in the future.`);
  return date;
}

function validateCreate(body) {
  const allowed = new Set([
    'hospitalId', 'bloodTypeId', 'componentType', 'quantityRequested', 'priority', 'requestDetails', 'neededBy',
  ]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length) throw new RequestWorkflowError(`Unsupported request field(s): ${unknown.join(', ')}.`);
  if (!isUuid(body.bloodTypeId)) throw new RequestWorkflowError('bloodTypeId must be a valid UUID.');
  if (body.hospitalId !== undefined && !isUuid(body.hospitalId)) {
    throw new RequestWorkflowError('hospitalId must be a valid UUID.');
  }
  if (!components.includes(body.componentType)) {
    throw new RequestWorkflowError(`componentType must be one of: ${components.join(', ')}.`);
  }
  if (!Number.isInteger(body.quantityRequested) || body.quantityRequested < 1 || body.quantityRequested > 1000) {
    throw new RequestWorkflowError('quantityRequested must be a whole number between 1 and 1000.');
  }
  const priority = body.priority ?? 'routine';
  if (!priorities.includes(priority)) {
    throw new RequestWorkflowError(`priority must be one of: ${priorities.join(', ')}.`);
  }
  return {
    hospitalId: body.hospitalId,
    bloodTypeId: body.bloodTypeId,
    componentType: body.componentType,
    quantityRequested: body.quantityRequested,
    priority,
    requestDetails: requiredText(body.requestDetails, 'requestDetails', 1000),
    neededBy: body.neededBy === undefined || body.neededBy === null || body.neededBy === ''
      ? null
      : parseDate(body.neededBy, 'neededBy', { future: true }),
  };
}

function validateAttestation(body) {
  const allowed = new Set([
    'policyVersion', 'policyDescription', 'reviewerName', 'reviewerCredential', 'reviewedAt',
  ]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length) throw new RequestWorkflowError(`Unsupported approval field(s): ${unknown.join(', ')}.`);
  const policyDescription = requiredText(body.policyDescription, 'policyDescription', 1000);
  if (!/exact\s+ABO\/Rh/i.test(policyDescription)) {
    throw new RequestWorkflowError('policyDescription must attest to the approved exact ABO/Rh matching policy.');
  }
  return {
    policyVersion: requiredText(body.policyVersion, 'policyVersion', 80),
    policyDescription,
    reviewerName: requiredText(body.reviewerName, 'reviewerName', 160),
    reviewerCredential: requiredText(body.reviewerCredential, 'reviewerCredential', 160),
    reviewedAt: parseDate(body.reviewedAt, 'reviewedAt', { past: true }),
  };
}

function parseListOptions(query) {
  if (
    (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 100))
    || (query.status !== undefined && typeof query.status !== 'string')
    || (query.priority !== undefined && typeof query.priority !== 'string')
  ) return null;
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? 20 : Number(query.pageSize);
  if (!Number.isInteger(page) || page < 1 || page > 100000) return null;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return null;
  const statuses = ['open', 'approved', 'rejected', 'partially_fulfilled', 'fulfilled', 'cancelled', 'expired'];
  if (query.status && !statuses.includes(query.status)) return null;
  if (query.priority && !priorities.includes(query.priority)) return null;
  return {
    page,
    pageSize,
    search: typeof query.search === 'string' ? query.search.trim().slice(0, 100) : '',
    status: query.status || null,
    priority: query.priority || null,
  };
}

async function lockRequest(transaction, requestId) {
  await transaction.$queryRaw`SELECT "id" FROM "blood_requests" WHERE "id" = ${requestId} FOR UPDATE`;
}

function requestInclude({ includeSensitive }) {
  return {
    hospital: { select: { id: true, name: true } },
    bloodType: { select: { id: true, code: true, aboGroup: true, rhFactor: true } },
    requestedBy: { select: { id: true, displayName: true } },
    reviewedBy: { select: { id: true, displayName: true } },
    statusHistory: {
      orderBy: { changedAt: 'asc' },
      include: { changedBy: { select: { id: true, displayName: true } } },
    },
    allocations: {
      orderBy: { allocatedAt: 'asc' },
      include: {
        allocatedBy: { select: { id: true, displayName: true } },
        bloodUnit: {
          select: {
            id: true,
            unitCode: true,
            unitStatus: true,
            componentType: true,
            collectedAt: true,
            expiresAt: true,
            ...(includeSensitive ? {
              currentStorageLocation: { select: { id: true, code: true, name: true } },
              movements: {
                orderBy: { movedAt: 'asc' },
                include: {
                  fromStorageLocation: { select: { code: true, name: true } },
                  toStorageLocation: { select: { code: true, name: true } },
                  movedByStaff: { select: { employeeNumber: true } },
                },
              }
            } : {}),
            donation: {
              select: {
                id: true,
                donationNumber: true,
                collectionStartedAt: true,
                collectedAt: true,
                ...(includeSensitive ? { donor: { select: { id: true, donorNumber: true } } } : {}),
                ...(includeSensitive ? {
                  collectedBy: { select: { employeeNumber: true, jobTitle: true } },
                } : {}),
                bloodType: {
                  select: {
                    bloodType: { select: { code: true, aboGroup: true, rhFactor: true } },
                  },
                },
              },
            },
            ...(includeSensitive ? {
              laboratoryTests: {
                orderBy: [{ testType: 'asc' }, { attemptNo: 'desc' }],
                select: {
                  id: true,
                  testType: true,
                  attemptNo: true,
                  testStatus: true,
                  resultCode: true,
                  reviewStatus: true,
                  performedAt: true,
                  reviewedAt: true,
                  performedBy: { select: { employeeNumber: true, jobTitle: true } },
                  reviewedBy: { select: { employeeNumber: true, jobTitle: true } },
                },
              },
            } : {}),
          },
        },
        dispatch: {
          include: {
            dispatchedBy: { select: { id: true, displayName: true } },
            dispatchedByStaff: { select: { id: true, employeeNumber: true, jobTitle: true } },
            statusHistory: {
              orderBy: { changedAt: 'asc' },
              include: { changedBy: { select: { id: true, displayName: true } } },
            },
          },
        },
      },
    },
  };
}

function createBloodRequestRouter({ prisma, clientOrigin }) {
  const router = Router();
  const authenticate = requireAuthentication(prisma);
  const originCheck = requireExpectedOrigin(clientOrigin);

  router.get(
    '/compatibility-approval',
    authenticate,
    requirePermission(prisma, 'compatibilityApprovals', 'view'),
    async (_request, response) => {
      const approval = await prisma.bloodCompatibilityApproval.findFirst({
        where: { isActive: true },
        orderBy: { reviewedAt: 'desc' },
      });
      return response.json({ approval });
    },
  );

  router.post(
    '/compatibility-approval',
    authenticate,
    requirePermission(prisma, 'compatibilityApprovals', 'create'),
    async (request, response) => {
      let data;
      try {
        data = validateAttestation(request.body || {});
      } catch (error) {
        if (error instanceof RequestWorkflowError) return invalid(response, error.message);
        throw error;
      }
      const approval = await prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`LOCK TABLE "blood_compatibility_approvals" IN EXCLUSIVE MODE`;
        await transaction.bloodCompatibilityApproval.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        });
        const created = await transaction.bloodCompatibilityApproval.create({
          data: { ...data, recordedByUserId: request.auth.user.id },
        });
        await writeAudit(transaction, request, {
          action: 'blood_compatibility_approval.recorded',
          entityType: 'blood_compatibility_approval',
          entityId: created.id,
          changedFields: ['policyVersion', 'policyDescription', 'reviewerName', 'reviewerCredential', 'reviewedAt', 'isActive'],
        });
        return created;
      });
      return response.status(201).json({ approval });
    },
  );

  router.get(
    '/options',
    authenticate,
    requirePermission(prisma, 'bloodRequests', 'view'),
    async (request, response) => {
      const hospitalWhere = request.auth.user.roles.includes('ADMIN')
        ? { isActive: true }
        : { isActive: true, id: { in: request.auth.user.hospitalIds } };
      const [bloodTypes, hospitals] = await Promise.all([
        prisma.bloodType.findMany({ orderBy: { code: 'asc' }, select: { id: true, code: true } }),
        prisma.hospital.findMany({
          where: hospitalWhere,
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
      ]);
      return response.json({ bloodTypes, hospitals });
    },
  );

  router.get(
    '/',
    authenticate,
    requirePermission(prisma, 'bloodRequests', 'view', { scoped: true }),
    async (request, response) => {
      const options = parseListOptions(request.query);
      if (!options) return invalid(response, 'The search, filter, or pagination values are invalid.');
      const filters = [];
      if (options.status) filters.push({ requestStatus: options.status });
      if (options.priority) filters.push({ priority: options.priority });
      if (options.search) {
        filters.push({
          OR: [
            { requestNumber: { contains: options.search, mode: 'insensitive' } },
            { requestDetails: { contains: options.search, mode: 'insensitive' } },
            { hospital: { name: { contains: options.search, mode: 'insensitive' } } },
          ],
        });
      }
      const where = { AND: [request.auth.resourceScope, ...filters] };
      const [requests, total] = await Promise.all([
        prisma.bloodRequest.findMany({
          where,
          orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }],
          skip: (options.page - 1) * options.pageSize,
          take: options.pageSize,
          include: {
            hospital: { select: { id: true, name: true } },
            bloodType: { select: { code: true, aboGroup: true, rhFactor: true } },
            requestedBy: { select: { id: true, displayName: true } },
            _count: { select: { allocations: true } },
          },
        }),
        prisma.bloodRequest.count({ where }),
      ]);
      return response.json({
        requests,
        pagination: {
          page: options.page,
          pageSize: options.pageSize,
          total,
          totalPages: Math.ceil(total / options.pageSize),
        },
      });
    },
  );

  router.post(
    '/',
    authenticate,
    requirePermission(prisma, 'bloodRequests', 'create'),
    async (request, response) => {
      let data;
      try {
        data = validateCreate(request.body || {});
      } catch (error) {
        if (error instanceof RequestWorkflowError) return invalid(response, error.message);
        throw error;
      }
      const user = request.auth.user;
      const hospitalId = user.roles.includes('HOSPITAL')
        ? (data.hospitalId || (user.hospitalIds.length === 1 ? user.hospitalIds[0] : null))
        : data.hospitalId;
      if (!isUuid(hospitalId)) return invalid(response, 'Choose a hospital membership for this request.');
      if (!user.roles.includes('ADMIN') && !user.hospitalIds.includes(hospitalId)) {
        return response.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to the selected hospital.' } });
      }
      const [hospital, bloodType] = await Promise.all([
        prisma.hospital.findFirst({ where: { id: hospitalId, isActive: true }, select: { id: true } }),
        prisma.bloodType.findUnique({ where: { id: data.bloodTypeId }, select: { id: true } }),
      ]);
      if (!hospital) return invalid(response, 'The selected hospital is unavailable.');
      if (!bloodType) return invalid(response, 'The selected blood type does not exist.');

      let bloodRequest;
      try {
        bloodRequest = await prisma.$transaction(async (transaction) => {
          const created = await transaction.bloodRequest.create({
            data: {
              ...data,
              hospitalId,
              requestedByUserId: user.id,
              requestNumber: `REQ-${randomBytes(8).toString('hex').toUpperCase()}`,
              requestStatus: 'open',
              statusHistory: { create: { changedByUserId: user.id, newStatus: 'open', note: 'Request submitted.' } },
            },
          });
          await writeAudit(transaction, request, {
            action: 'blood_request.created',
            entityType: 'blood_request',
            entityId: created.id,
            changedFields: ['hospitalId', 'bloodTypeId', 'componentType', 'quantityRequested', 'priority', 'requestDetails', 'neededBy'],
          });
          return created;
        });
      } catch (error) {
        if (error.code === 'P2002') return conflict(response, 'A request number collision occurred. Please submit again.');
        if (error.code === 'P2003') return invalid(response, 'The selected hospital or blood type is no longer available.');
        throw error;
      }
      return response.status(201).json({ bloodRequest });
    },
  );

  router.get(
    '/:id',
    authenticate,
    validateUuidParam('id'),
    requirePermission(prisma, 'bloodRequests', 'view', {
      recordDelegate: 'bloodRequest',
      scoped: true,
    }),
    async (request, response) => {
      const includeSensitive = request.auth.user.roles.some((role) => ['ADMIN', 'STAFF'].includes(role));
      const bloodRequest = await prisma.bloodRequest.findFirst({
        where: { AND: [{ id: request.authorizedRecord.id }, request.auth.resourceScope] },
        include: requestInclude({ includeSensitive }),
      });
      if (!bloodRequest) return response.status(404).json({ error: { code: 'RECORD_NOT_FOUND', message: 'The request was not found.' } });
      return response.json({ bloodRequest });
    },
  );

  router.post(
    '/:id/review',
    authenticate,
    validateUuidParam('id'),
    requirePermission(prisma, 'bloodRequests', 'approve', {
      recordDelegate: 'bloodRequest',
      scoped: true,
    }),
    async (request, response) => {
      const { decision, note } = request.body || {};
      const unknown = Object.keys(request.body || {}).filter((key) => !['decision', 'note'].includes(key));
      if (unknown.length) return invalid(response, `Unsupported review field(s): ${unknown.join(', ')}.`);
      if (!['approved', 'rejected'].includes(decision)) return invalid(response, 'decision must be approved or rejected.');
      let reviewNote;
      try {
        reviewNote = optionalText(note, 'note', 1000);
        if (decision === 'rejected' && !reviewNote) throw new RequestWorkflowError('A note is required when rejecting a request.');
      } catch (error) {
        if (error instanceof RequestWorkflowError) return invalid(response, error.message);
        throw error;
      }
      try {
        const bloodRequest = await prisma.$transaction(async (transaction) => {
          await lockRequest(transaction, request.authorizedRecord.id);
          const current = await transaction.bloodRequest.findFirst({
            where: { AND: [{ id: request.authorizedRecord.id }, request.auth.resourceScope] },
          });
          if (!current || current.requestStatus !== 'open') {
            throw new RequestWorkflowError('Only a submitted request can be reviewed.');
          }
          const updated = await transaction.bloodRequest.update({
            where: { id: current.id },
            data: {
              requestStatus: decision,
              reviewedByUserId: request.auth.user.id,
              reviewedAt: new Date(),
              reviewNote,
              ...(decision === 'rejected' ? { closedAt: new Date() } : {}),
              statusHistory: {
                create: {
                  changedByUserId: request.auth.user.id,
                  previousStatus: current.requestStatus,
                  newStatus: decision,
                  note: reviewNote,
                },
              },
            },
          });
          await writeAudit(transaction, request, {
            action: `blood_request.${decision}`,
            entityType: 'blood_request',
            entityId: current.id,
            changedFields: ['requestStatus', 'reviewedByUserId', 'reviewedAt', 'reviewNote'],
            metadata: {
              changeCategory: 'request_status',
              fromStatus: current.requestStatus,
              toStatus: decision,
            },
          });
          return updated;
        }, { isolationLevel: 'Serializable' });
        return response.json({ bloodRequest });
      } catch (error) {
        if (error instanceof RequestWorkflowError) return conflict(response, error.message);
        if (error.code === 'P2034') return conflict(response, 'The request changed during review. Refresh and try again.');
        throw error;
      }
    },
  );

  router.post(
    '/:id/cancel',
    originCheck,
    authenticate,
    validateUuidParam('id'),
    requirePermission(prisma, 'bloodRequests', 'update', {
      recordDelegate: 'bloodRequest',
      scoped: true,
    }),
    async (request, response) => {
      let note;
      try {
        const unknown = Object.keys(request.body || {}).filter((key) => key !== 'note');
        if (unknown.length) throw new RequestWorkflowError(`Unsupported cancellation field(s): ${unknown.join(', ')}.`);
        note = optionalText(request.body?.note, 'note', 1000);
      } catch (error) {
        if (error instanceof RequestWorkflowError) return invalid(response, error.message);
        throw error;
      }
      try {
        const bloodRequest = await prisma.$transaction(async (transaction) => {
          await lockRequest(transaction, request.authorizedRecord.id);
          const current = await transaction.bloodRequest.findFirst({
            where: { AND: [{ id: request.authorizedRecord.id }, request.auth.resourceScope] },
          });
          if (!current || !['open', 'approved', 'rejected'].includes(current.requestStatus)) {
            throw new RequestWorkflowError('Only a request without allocated units can be cancelled.');
          }
          const allocationCount = await transaction.allocation.count({
            where: { bloodRequestId: current.id, allocationStatus: { in: ['reserved', 'fulfilled'] } },
          });
          if (allocationCount) throw new RequestWorkflowError('A request with allocated units cannot be cancelled.');
          const now = new Date();
          const updated = await transaction.bloodRequest.update({
            where: { id: current.id },
            data: {
              requestStatus: 'cancelled',
              closedAt: now,
              statusHistory: {
                create: {
                  changedByUserId: request.auth.user.id,
                  previousStatus: current.requestStatus,
                  newStatus: 'cancelled',
                  note,
                },
              },
            },
          });
          await writeAudit(transaction, request, {
            action: 'blood_request.cancelled',
            entityType: 'blood_request',
            entityId: current.id,
            changedFields: ['requestStatus', 'closedAt'],
            metadata: {
              changeCategory: 'request_status',
              fromStatus: current.requestStatus,
              toStatus: 'cancelled',
            },
          });
          return updated;
        }, { isolationLevel: 'Serializable' });
        return response.json({ bloodRequest });
      } catch (error) {
        if (error instanceof RequestWorkflowError) return conflict(response, error.message);
        if (error.code === 'P2034') return conflict(response, 'The request changed during cancellation. Refresh and try again.');
        throw error;
      }
    },
  );

  router.post(
    '/:id/dispatch',
    authenticate,
    validateUuidParam('id'),
    requirePermission(prisma, 'bloodRequests', 'dispatch', {
      recordDelegate: 'bloodRequest',
      scoped: true,
    }),
    async (request, response) => {
      const allocationIds = request.body?.allocationIds;
      const unknownDispatchFields = Object.keys(request.body || {}).filter((key) => !['allocationIds', 'note'].includes(key));
      if (
        unknownDispatchFields.length
        || !Array.isArray(allocationIds)
        || allocationIds.length < 1
        || allocationIds.length > 100
        || allocationIds.some((id) => !isUuid(id))
        || new Set(allocationIds).size !== allocationIds.length
      ) {
        return invalid(response, unknownDispatchFields.length
          ? `Unsupported dispatch field(s): ${unknownDispatchFields.join(', ')}.`
          : 'allocationIds must contain 1 to 100 unique allocation IDs.');
      }
      let dispatchNote;
      try {
        dispatchNote = optionalText(request.body?.note, 'note', 1000);
      } catch (error) {
        if (error instanceof RequestWorkflowError) return invalid(response, error.message);
        throw error;
      }

      try {
        const result = await prisma.$transaction(async (transaction) => {
          await lockRequest(transaction, request.authorizedRecord.id);
          const currentRequest = await transaction.bloodRequest.findFirst({
            where: { AND: [{ id: request.authorizedRecord.id }, request.auth.resourceScope] },
          });
          if (!currentRequest || !['approved', 'partially_fulfilled'].includes(currentRequest.requestStatus)) {
            throw new RequestWorkflowError('Only an approved or partially fulfilled request can be dispatched.');
          }
          const staffProfile = await transaction.staff.findFirst({
            where: {
              id: request.auth.user.staffId || undefined,
              userId: request.auth.user.id,
              hospitalId: currentRequest.hospitalId,
              staffStatus: 'active',
              hospital: { isActive: true },
            },
            select: { id: true },
          });
          if (!staffProfile) throw new RequestWorkflowError('Dispatching requires an active staff profile at this hospital.');

          const dispatches = [];
          for (const allocationId of allocationIds) {
            await transaction.$queryRaw`SELECT "id" FROM "allocations" WHERE "id" = ${allocationId} FOR UPDATE`;
            const allocation = await transaction.allocation.findFirst({
              where: {
                id: allocationId,
                bloodRequestId: currentRequest.id,
                allocationStatus: 'reserved',
                dispatch: null,
              },
              include: { bloodUnit: { select: { id: true, unitStatus: true, expiresAt: true } } },
            });
            if (!allocation) throw new RequestWorkflowError('Every selected allocation must be reserved and belong to this request.');
            await transaction.$queryRaw`SELECT "id" FROM "blood_units" WHERE "id" = ${allocation.bloodUnitId} FOR UPDATE`;
            const lockedUnit = await transaction.bloodUnit.findUnique({
              where: { id: allocation.bloodUnitId },
              select: { id: true, unitStatus: true, expiresAt: true },
            });
            if (!lockedUnit || lockedUnit.unitStatus !== 'reserved' || lockedUnit.expiresAt <= new Date()) {
              throw new RequestWorkflowError('An allocated unit is no longer in a dispatchable state.');
            }
            const created = await transaction.bloodDispatch.create({
              data: {
                allocationId: allocation.id,
                bloodRequestId: currentRequest.id,
                bloodUnitId: allocation.bloodUnitId,
                dispatchedByUserId: request.auth.user.id,
                dispatchedByStaffId: staffProfile.id,
                statusHistory: {
                  create: {
                    changedByUserId: request.auth.user.id,
                    newStatus: 'dispatched',
                    note: dispatchNote,
                  },
                },
              },
            });
            await transaction.allocation.update({
              where: { id: allocation.id },
              data: { allocationStatus: 'fulfilled', fulfilledAt: new Date() },
            });
            await writeAudit(transaction, request, {
              action: 'allocation.dispatched',
              entityType: 'allocation',
              entityId: allocation.id,
              changedFields: ['allocationStatus', 'fulfilledAt'],
              metadata: {
                changeCategory: 'dispatch',
                fromStatus: 'reserved',
                toStatus: 'fulfilled',
              },
            });
            const changedUnit = await transaction.bloodUnit.updateMany({
              where: { id: allocation.bloodUnitId, unitStatus: 'reserved', expiresAt: { gt: new Date() } },
              data: { unitStatus: 'issued' },
            });
            if (changedUnit.count !== 1) throw new RequestWorkflowError('A unit changed during dispatch.');
            dispatches.push(created);
            await writeAudit(transaction, request, {
              action: 'blood_unit.dispatched',
              entityType: 'blood_unit',
              entityId: allocation.bloodUnitId,
              changedFields: ['unitStatus', 'allocationStatus', 'bloodDispatchId'],
              metadata: {
                changeCategory: 'inventory_status',
                fromStatus: 'reserved',
                toStatus: 'issued',
              },
            });
            await writeAudit(transaction, request, {
              action: 'blood_dispatch.created',
              entityType: 'blood_dispatch',
              entityId: created.id,
              changedFields: ['deliveryStatus', 'allocationId', 'bloodUnitId'],
              metadata: { changeCategory: 'dispatch', toStatus: created.deliveryStatus },
            });
          }
          const deliveredCount = await transaction.bloodDispatch.count({
            where: { bloodRequestId: currentRequest.id, deliveryStatus: 'delivered' },
          });
          const nextStatus = deliveredCount >= currentRequest.quantityRequested
            ? 'fulfilled'
            : deliveredCount > 0
              ? 'partially_fulfilled'
              : currentRequest.requestStatus;
          if (nextStatus !== currentRequest.requestStatus) {
            await transaction.bloodRequest.update({
              where: { id: currentRequest.id },
              data: {
                requestStatus: nextStatus,
                ...(nextStatus === 'fulfilled' ? { closedAt: new Date() } : {}),
                statusHistory: {
                  create: {
                    changedByUserId: request.auth.user.id,
                    previousStatus: currentRequest.requestStatus,
                    newStatus: nextStatus,
                    note: 'Allocation units dispatched.',
                  },
                },
              },
            });
          }
          return dispatches;
        }, { isolationLevel: 'Serializable' });
        return response.status(201).json({ dispatches: result });
      } catch (error) {
        if (error instanceof RequestWorkflowError) return conflict(response, error.message);
        if (error.code === 'P2002' || error.code === 'P2034') {
          return conflict(response, 'The allocation or request changed during dispatch. Refresh and try again.');
        }
        throw error;
      }
    },
  );

  router.patch(
    '/dispatches/:dispatchId/status',
    authenticate,
    validateUuidParam('dispatchId'),
    requirePermission(prisma, 'bloodDispatches', 'update', {
      recordDelegate: 'bloodDispatch',
      recordIdParam: 'dispatchId',
      scoped: true,
    }),
    async (request, response) => {
      const { deliveryStatus, finalDisposition } = request.body || {};
      const unknown = Object.keys(request.body || {})
        .filter((key) => !['deliveryStatus', 'finalDisposition', 'note'].includes(key));
      if (unknown.length) return invalid(response, `Unsupported delivery field(s): ${unknown.join(', ')}.`);
      if (!Object.hasOwn(dispositions, deliveryStatus)) {
        return invalid(response, 'deliveryStatus must be delivered, returned, or discarded.');
      }
      if (!dispositions[deliveryStatus].includes(finalDisposition)) {
        return invalid(response, `finalDisposition must be one of: ${dispositions[deliveryStatus].join(', ')}.`);
      }
      let note;
      try {
        note = optionalText(request.body?.note, 'note', 1000);
      } catch (error) {
        if (error instanceof RequestWorkflowError) return invalid(response, error.message);
        throw error;
      }
      try {
        const dispatch = await prisma.$transaction(async (transaction) => {
          await lockRequest(transaction, request.authorizedRecord.bloodRequestId);
          await transaction.$queryRaw`SELECT "id" FROM "blood_dispatches" WHERE "id" = ${request.authorizedRecord.id} FOR UPDATE`;
          const current = await transaction.bloodDispatch.findFirst({
            where: { AND: [{ id: request.authorizedRecord.id }, request.auth.resourceScope] },
          });
          if (!current || current.deliveryStatus !== 'dispatched') {
            throw new RequestWorkflowError('Only a dispatched record can receive a final delivery status.');
          }
          const previousDeliveryStatus = current.deliveryStatus;
          await transaction.$queryRaw`SELECT "id" FROM "blood_units" WHERE "id" = ${current.bloodUnitId} FOR UPDATE`;
          const updated = await transaction.bloodDispatch.update({
            where: { id: current.id },
            data: {
              deliveryStatus,
              deliveredAt: new Date(),
              finalDisposition,
              statusHistory: {
                create: {
                  changedByUserId: request.auth.user.id,
                  previousStatus: current.deliveryStatus,
                  newStatus: deliveryStatus,
                  finalDisposition,
                  note,
                },
              },
            },
          });
          if (deliveryStatus === 'returned' || deliveryStatus === 'discarded') {
            const cancelledAllocation = await transaction.allocation.updateMany({
              where: { id: current.allocationId, allocationStatus: 'fulfilled' },
              data: { allocationStatus: 'cancelled', cancelledAt: new Date() },
            });
            if (cancelledAllocation.count !== 1) {
              throw new RequestWorkflowError('The dispatched allocation changed before its final disposition was recorded.');
            }
            await writeAudit(transaction, request, {
              action: `allocation.${deliveryStatus}`,
              entityType: 'allocation',
              entityId: current.allocationId,
              changedFields: ['allocationStatus', 'cancelledAt'],
              metadata: {
                changeCategory: 'allocation',
                fromStatus: 'fulfilled',
                toStatus: 'cancelled',
              },
            });
          }
          if (deliveryStatus === 'returned') {
            const changed = await transaction.bloodUnit.updateMany({
              where: { id: current.bloodUnitId, unitStatus: 'issued' },
              data: { unitStatus: 'quarantined' },
            });
            if (changed.count !== 1) throw new RequestWorkflowError('The dispatched unit changed before it could be returned to quarantine.');
            await writeAudit(transaction, request, {
              action: 'blood_unit.returned_to_quarantine',
              entityType: 'blood_unit',
              entityId: current.bloodUnitId,
              changedFields: ['unitStatus'],
              metadata: {
                changeCategory: 'inventory_status',
                fromStatus: 'issued',
                toStatus: 'quarantined',
              },
            });
          } else if (deliveryStatus === 'discarded') {
            const changed = await transaction.bloodUnit.updateMany({
              where: { id: current.bloodUnitId, unitStatus: 'issued' },
              data: { unitStatus: 'discarded' },
            });
            if (changed.count !== 1) throw new RequestWorkflowError('The dispatched unit changed before it could be discarded.');
            await writeAudit(transaction, request, {
              action: 'blood_unit.discarded',
              entityType: 'blood_unit',
              entityId: current.bloodUnitId,
              changedFields: ['unitStatus'],
              metadata: {
                changeCategory: 'inventory_status',
                fromStatus: 'issued',
                toStatus: 'discarded',
              },
            });
          }
          const requestRecord = await transaction.bloodRequest.findUnique({
            where: { id: current.bloodRequestId },
          });
          const deliveredCount = await transaction.bloodDispatch.count({
            where: { bloodRequestId: current.bloodRequestId, deliveryStatus: 'delivered' },
          });
          const nextStatus = deliveredCount >= requestRecord.quantityRequested
            ? 'fulfilled'
            : deliveredCount > 0
              ? 'partially_fulfilled'
              : requestRecord.requestStatus;
          if (nextStatus !== requestRecord.requestStatus) {
            await transaction.bloodRequest.update({
              where: { id: requestRecord.id },
              data: {
                requestStatus: nextStatus,
                ...(nextStatus === 'fulfilled' ? { closedAt: new Date() } : { closedAt: null }),
                statusHistory: {
                  create: {
                    changedByUserId: request.auth.user.id,
                    previousStatus: requestRecord.requestStatus,
                    newStatus: nextStatus,
                    note: `Dispatch ${deliveryStatus}: ${finalDisposition}.`,
                  },
                },
              },
            });
          }
          await writeAudit(transaction, request, {
            action: `blood_dispatch.${deliveryStatus}`,
            entityType: 'blood_dispatch',
            entityId: current.id,
            changedFields: ['deliveryStatus', 'deliveredAt', 'finalDisposition'],
            metadata: {
              changeCategory: 'dispatch',
              fromStatus: previousDeliveryStatus,
              toStatus: deliveryStatus,
            },
          });
          return updated;
        }, { isolationLevel: 'Serializable' });
        return response.json({ dispatch });
      } catch (error) {
        if (error instanceof RequestWorkflowError) return conflict(response, error.message);
        if (error.code === 'P2034') return conflict(response, 'The dispatch status changed during update. Refresh and try again.');
        throw error;
      }
    },
  );

  return router;
}

export { createBloodRequestRouter, parseListOptions, validateAttestation, validateCreate };
