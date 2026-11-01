import { Router } from 'express';
import { requireAuthentication } from '../auth/auth-middleware.js';
import { requirePermission } from '../auth/authorization.js';
import { writeAuditAccess } from '../management/management-utils.js';

function isDonor(user) {
  return user.roles.includes('DONOR')
    && !user.roles.some((role) => ['ADMIN', 'STAFF', 'HOSPITAL'].includes(role));
}

function isHospitalUser(user) {
  return user.roles.includes('HOSPITAL')
    && !user.roles.some((role) => ['ADMIN', 'STAFF'].includes(role));
}

function createPortalRouter({ prisma }) {
  const router = Router();
  const authenticate = requireAuthentication(prisma);

  router.get(
    '/donor',
    authenticate,
    requirePermission(prisma, 'donors', 'view', { scoped: true }),
    async (request, response) => {
      const user = request.auth.user;
      if (!isDonor(user)) {
        return response.status(403).json({
          error: { code: 'FORBIDDEN', message: 'The donor dashboard is available to donor accounts.' },
        });
      }

      const profile = await prisma.donor.findFirst({
        where: { userId: user.id },
        select: {
          id: true,
          donorNumber: true,
          dateOfBirth: true,
          donorStatus: true,
          eligibilityReviewedAt: true,
          user: {
            select: { displayName: true, email: true, phoneE164: true },
          },
        },
      });

      if (!profile) {
        return response.json({ profile: null, donations: [], appointments: [] });
      }

      const [donations, appointments] = await Promise.all([
        prisma.donation.findMany({
          where: { donorId: profile.id },
          orderBy: [{ collectedAt: 'desc' }, { id: 'asc' }],
          select: {
            id: true,
            donationNumber: true,
            donationStatus: true,
            collectedAt: true,
            volumeMl: true,
            hospital: { select: { name: true } },
          },
        }),
        prisma.appointment.findMany({
          where: { donorId: profile.id },
          orderBy: [{ scheduledStartAt: 'desc' }, { id: 'asc' }],
          select: {
            id: true,
            scheduledStartAt: true,
            scheduledEndAt: true,
            appointmentStatus: true,
            hospital: { select: { name: true } },
          },
        }),
      ]);
      await writeAuditAccess(prisma, request, {
        action: 'donor.sensitive_information_viewed',
        entityType: 'donor',
        entityId: profile.id,
        metadata: { accessScope: 'donor_profile' },
      });

      return response.json({
        profile: {
          id: profile.id,
          donorNumber: profile.donorNumber,
          dateOfBirth: profile.dateOfBirth,
          donorStatus: profile.donorStatus,
          eligibilityReviewedAt: profile.eligibilityReviewedAt,
          user: {
            displayName: profile.user.displayName,
            email: profile.user.email,
            phoneE164: profile.user.phoneE164,
          },
        },
        donations,
        appointments,
      });
    },
  );

  router.get(
    '/hospital',
    authenticate,
    requirePermission(prisma, 'bloodRequests', 'view', { scoped: true }),
    async (request, response) => {
      const user = request.auth.user;
      if (!isHospitalUser(user)) {
        return response.status(403).json({
          error: { code: 'FORBIDDEN', message: 'The hospital dashboard is available to hospital accounts.' },
        });
      }

      const where = {
        AND: [request.auth.resourceScope, { requestedByUserId: user.id }],
      };
      const [requests, total] = await Promise.all([
        prisma.bloodRequest.findMany({
          where,
          orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }],
          take: 50,
          select: {
            id: true,
            requestNumber: true,
            requestStatus: true,
            priority: true,
            componentType: true,
            quantityRequested: true,
            requestedAt: true,
            neededBy: true,
            hospital: { select: { name: true } },
            bloodType: { select: { code: true } },
            statusHistory: {
              orderBy: { changedAt: 'asc' },
              select: { newStatus: true, changedAt: true },
            },
            allocations: {
              orderBy: { allocatedAt: 'asc' },
              select: {
                allocationStatus: true,
                allocatedAt: true,
                fulfilledAt: true,
                cancelledAt: true,
                dispatch: {
                  select: {
                    deliveryStatus: true,
                    dispatchedAt: true,
                    deliveredAt: true,
                    finalDisposition: true,
                    statusHistory: {
                      orderBy: { changedAt: 'asc' },
                      select: { newStatus: true, changedAt: true, finalDisposition: true },
                    },
                  },
                },
              },
            },
          },
        }),
        prisma.bloodRequest.count({ where }),
      ]);

      return response.json({ requests, total, limited: total > requests.length });
    },
  );

  return router;
}

export { createPortalRouter };
