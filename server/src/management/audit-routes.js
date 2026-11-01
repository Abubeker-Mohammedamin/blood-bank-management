import { Router } from 'express';
import { requireAuthentication } from '../auth/auth-middleware.js';
import { requirePermission } from '../auth/authorization.js';
import { isUuid, writeAuditAccess } from './management-utils.js';

const pageSizeLimit = 100;

function parsePage(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= maximum ? parsed : null;
}

function parseDate(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return false;
  return new Date(value);
}

function createAuditRouter({ prisma }) {
  const router = Router();

  router.get(
    '/',
    requireAuthentication(prisma),
    requirePermission(prisma, 'auditLogs', 'view'),
    async (request, response) => {
      const page = parsePage(request.query.page, 1, 1000000);
      const pageSize = parsePage(request.query.pageSize, 50, pageSizeLimit);
      const occurredFrom = parseDate(request.query.occurredFrom);
      const occurredTo = parseDate(request.query.occurredTo);
      const { action, entityType, entityId, actorUserId } = request.query;
      if (page === null || pageSize === null) {
        return response.status(400).json({
          error: { code: 'INVALID_AUDIT_FILTER', message: 'page and pageSize must be valid positive numbers.' },
        });
      }
      if (
        occurredFrom === false
        || occurredTo === false
        || (occurredFrom && occurredTo && occurredFrom > occurredTo)
        || (action !== undefined && (typeof action !== 'string' || action.length > 40))
        || (entityType !== undefined && (typeof entityType !== 'string' || entityType.length > 50))
        || (entityId !== undefined && !isUuid(entityId))
        || (actorUserId !== undefined && !isUuid(actorUserId))
      ) {
        return response.status(400).json({
          error: { code: 'INVALID_AUDIT_FILTER', message: 'One or more audit filters are invalid.' },
        });
      }

      await writeAuditAccess(prisma, request, {
        action: 'audit_log.viewed',
        entityType: 'audit_log_query',
        entityId: request.auth.user.id,
        metadata: { accessScope: 'audit_log_collection' },
      });

      const where = {
        ...(action ? { action } : {}),
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(actorUserId ? { actorUserId } : {}),
        ...(occurredFrom || occurredTo
          ? {
            occurredAt: {
              ...(occurredFrom ? { gte: occurredFrom } : {}),
              ...(occurredTo ? { lte: occurredTo } : {}),
            },
          }
          : {}),
      };
      const [auditLogs, totalItems] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            actorUserId: true,
            action: true,
            entityType: true,
            entityId: true,
            occurredAt: true,
            changedFields: true,
            metadata: true,
            actor: { select: { id: true, displayName: true } },
          },
        }),
        prisma.auditLog.count({ where }),
      ]);
      return response.json({
        auditLogs,
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize),
        },
      });
    },
  );

  return router;
}

export { createAuditRouter };
