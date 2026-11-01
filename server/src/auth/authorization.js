const actions = ['view', 'create', 'update', 'approve', 'allocate', 'dispatch', 'export'];

const permissionDefinitions = {
  users: {
    view: ['ADMIN', 'STAFF', 'DONOR', 'HOSPITAL'],
    create: ['ADMIN'],
    update: ['ADMIN', 'DONOR', 'HOSPITAL'],
    export: ['ADMIN'],
  },
  roles: {
    view: ['ADMIN'],
    create: ['ADMIN'],
    update: ['ADMIN'],
    export: ['ADMIN'],
  },
  hospitalUsers: {
    view: ['ADMIN'],
    create: ['ADMIN'],
    update: ['ADMIN'],
    export: ['ADMIN'],
  },
  hospitals: {
    view: ['ADMIN', 'STAFF', 'HOSPITAL'],
    create: ['ADMIN'],
    update: ['ADMIN'],
    export: ['ADMIN'],
  },
  staff: {
    view: ['ADMIN', 'STAFF'],
    create: ['ADMIN'],
    update: ['ADMIN'],
    export: ['ADMIN'],
  },
  donors: {
    view: ['ADMIN', 'STAFF', 'DONOR'],
    create: ['ADMIN', 'STAFF', 'DONOR'],
    update: ['ADMIN', 'STAFF', 'DONOR'],
    approve: ['ADMIN', 'STAFF'],
    export: ['ADMIN', 'STAFF'],
  },
  bloodTypes: {
    view: ['ADMIN', 'STAFF', 'HOSPITAL'],
    create: ['ADMIN'],
    update: ['ADMIN'],
    export: ['ADMIN', 'STAFF'],
  },
  appointments: {
    view: ['ADMIN', 'STAFF', 'DONOR', 'HOSPITAL'],
    create: ['ADMIN', 'STAFF', 'DONOR'],
    update: ['ADMIN', 'STAFF', 'DONOR'],
    approve: ['ADMIN', 'STAFF'],
    export: ['ADMIN', 'STAFF'],
  },
  donations: {
    view: ['ADMIN', 'STAFF', 'DONOR'],
    create: ['ADMIN', 'STAFF'],
    update: ['ADMIN', 'STAFF'],
    approve: ['ADMIN', 'STAFF'],
    export: ['ADMIN', 'STAFF'],
  },
  laboratoryTests: {
    view: ['ADMIN', 'STAFF'],
    create: ['ADMIN', 'STAFF'],
    update: ['ADMIN', 'STAFF'],
    approve: ['ADMIN', 'STAFF'],
    export: ['ADMIN', 'STAFF'],
  },
  donationBloodTypes: {
    view: ['ADMIN', 'STAFF'],
    create: ['ADMIN', 'STAFF'],
    approve: ['ADMIN', 'STAFF'],
    export: ['ADMIN', 'STAFF'],
  },
  storageLocations: {
    view: ['ADMIN', 'STAFF'],
    create: ['ADMIN', 'STAFF'],
    update: ['ADMIN', 'STAFF'],
    export: ['ADMIN', 'STAFF'],
  },
  bloodUnits: {
    view: ['ADMIN', 'STAFF', 'HOSPITAL'],
    create: ['ADMIN', 'STAFF'],
    update: ['ADMIN', 'STAFF'],
    approve: ['ADMIN', 'STAFF'],
    allocate: ['ADMIN', 'STAFF'],
    dispatch: ['ADMIN', 'STAFF'],
    export: ['ADMIN', 'STAFF'],
  },
  bloodUnitMovements: {
    view: ['ADMIN', 'STAFF', 'HOSPITAL'],
    create: ['ADMIN', 'STAFF'],
    dispatch: ['ADMIN', 'STAFF'],
    export: ['ADMIN', 'STAFF'],
  },
  bloodRequests: {
    view: ['ADMIN', 'STAFF', 'HOSPITAL'],
    create: ['ADMIN', 'STAFF', 'HOSPITAL'],
    update: ['ADMIN', 'STAFF', 'HOSPITAL'],
    approve: ['ADMIN', 'STAFF'],
    allocate: ['ADMIN', 'STAFF'],
    dispatch: ['ADMIN', 'STAFF'],
    export: ['ADMIN', 'STAFF', 'HOSPITAL'],
  },
  bloodDispatches: {
    view: ['ADMIN', 'STAFF', 'HOSPITAL'],
    dispatch: ['ADMIN', 'STAFF'],
    update: ['ADMIN', 'STAFF'],
    export: ['ADMIN', 'STAFF'],
  },
  compatibilityApprovals: {
    view: ['ADMIN', 'STAFF'],
    create: ['ADMIN'],
  },
  allocations: {
    view: ['ADMIN', 'STAFF', 'HOSPITAL'],
    create: ['ADMIN', 'STAFF'],
    update: ['ADMIN', 'STAFF'],
    approve: ['ADMIN', 'STAFF'],
    allocate: ['ADMIN', 'STAFF'],
    dispatch: ['ADMIN', 'STAFF'],
    export: ['ADMIN', 'STAFF', 'HOSPITAL'],
  },
  notifications: {
    view: ['ADMIN', 'STAFF', 'DONOR', 'HOSPITAL'],
    create: ['ADMIN', 'STAFF'],
    update: ['ADMIN', 'STAFF', 'DONOR', 'HOSPITAL'],
  },
  auditLogs: {
    view: ['ADMIN'],
  },
  reports: {
    view: ['ADMIN', 'STAFF'],
    export: ['ADMIN', 'STAFF'],
  },
};

const permissionMatrix = Object.fromEntries(
  Object.entries(permissionDefinitions).map(([resource, permissions]) => [
    resource,
    Object.fromEntries(actions.map((action) => [action, permissions[action] || []])),
  ]),
);

function can(user, resource, action) {
  return Boolean(
    user
    && actions.includes(action)
    && permissionMatrix[resource]?.[action]?.some((role) => user.roles?.includes(role)),
  );
}

function buildOwnershipFilter(user, resource) {
  if (!user?.id) return null;
  if (user.roles?.includes('ADMIN')) return {};

  const hospitalIds = user.hospitalIds || [];
  const hasHospitals = hospitalIds.length > 0;
  const hospitalScope = { in: hospitalIds };
  const donorDonationScope = user.donorId
    ? { donation: { donorId: user.donorId } }
    : null;
  const staffDonorScope = hasHospitals
    ? {
      OR: [
        { appointments: { some: { hospitalId: hospitalScope } } },
        { donations: { some: { hospitalId: hospitalScope } } },
      ],
    }
    : null;

  switch (resource) {
    case 'users':
      return { id: user.id };
    case 'roles':
    case 'hospitalUsers':
    case 'auditLogs':
      return null;
    case 'reports':
      return user.roles?.includes('STAFF') && hasHospitals ? {} : null;
    case 'hospitals':
      return hasHospitals ? { id: hospitalScope } : null;
    case 'staff':
    case 'storageLocations':
      return hasHospitals ? { hospitalId: hospitalScope } : null;
    case 'donors':
      if (user.roles?.includes('DONOR')) return { userId: user.id };
      return user.roles?.includes('STAFF') && hasHospitals
        ? {
          OR: [
            { registrationHospitalId: hospitalScope },
            ...staffDonorScope.OR,
          ],
        }
        : null;
    case 'appointments':
      if (user.roles?.includes('DONOR') && user.donorId) return { donorId: user.donorId };
      return hasHospitals ? { hospitalId: hospitalScope } : null;
    case 'donations':
      if (user.roles?.includes('DONOR') && user.donorId) return { donorId: user.donorId };
      return hasHospitals ? { hospitalId: hospitalScope } : null;
    case 'laboratoryTests':
    case 'donationBloodTypes':
      if (user.roles?.includes('DONOR')) return donorDonationScope;
      return hasHospitals ? { donation: { hospitalId: hospitalScope } } : null;
    case 'bloodTypes':
      return {};
    case 'bloodUnits':
      if (user.roles?.includes('DONOR') && user.donorId) {
        return { donation: { donorId: user.donorId } };
      }
      if (hasHospitals) {
        return {
          OR: [
            { donation: { hospitalId: hospitalScope } },
            { currentStorageLocation: { hospitalId: hospitalScope } },
          ],
        };
      }
      return null;
    case 'bloodUnitMovements':
      return hasHospitals
        ? {
          OR: [
            { bloodUnit: { donation: { hospitalId: hospitalScope } } },
            { fromStorageLocation: { hospitalId: hospitalScope } },
            { toStorageLocation: { hospitalId: hospitalScope } },
          ],
        }
        : null;
    case 'bloodRequests':
      if (user.roles?.includes('HOSPITAL') && hasHospitals) {
        return { requestedByUserId: user.id, hospitalId: hospitalScope };
      }
      return user.roles?.includes('STAFF') && hasHospitals
        ? { hospitalId: hospitalScope }
        : null;
    case 'bloodDispatches':
      if (user.roles?.includes('HOSPITAL') && hasHospitals) {
        return { bloodRequest: { requestedByUserId: user.id, hospitalId: hospitalScope } };
      }
      return user.roles?.includes('STAFF') && hasHospitals
        ? { bloodRequest: { hospitalId: hospitalScope } }
        : null;
    case 'allocations':
      if (user.roles?.includes('HOSPITAL') && hasHospitals) {
        return { bloodRequest: { requestedByUserId: user.id, hospitalId: hospitalScope } };
      }
      return user.roles?.includes('STAFF') && hasHospitals
        ? { bloodRequest: { hospitalId: hospitalScope } }
        : null;
    case 'notifications':
      return { userId: user.id };
    default:
      return null;
  }
}

function requirePermission(
  prisma,
  resource,
  action,
  {
    recordDelegate,
    recordIdParam = 'id',
    recordIdField = 'id',
    organizationField,
    scoped = false,
  } = {},
) {
  return async (request, response, next) => {
    const user = request.auth?.user;
    if (!user) {
      return response.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Your session is missing or has expired. Please sign in again.',
        },
      });
    }

    if (!can(user, resource, action)) {
      return response.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to perform this operation.',
        },
      });
    }

    const scope = buildOwnershipFilter(user, resource);
    if (scoped && scope === null) {
      return response.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have access to records in this scope.',
        },
      });
    }

    if (
      organizationField
      && !user.roles?.includes('ADMIN')
      && !user.hospitalIds?.includes(request.body?.[organizationField])
    ) {
      return response.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have access to the selected hospital.',
        },
      });
    }

    if (scope !== null) request.auth.resourceScope = scope;

    if (recordDelegate) {
      const recordId = request.params[recordIdParam];
      if (!recordId || scope === null) {
        return response.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have access to this record.',
          },
        });
      }

      const record = await prisma[recordDelegate].findFirst({
        where: { AND: [{ [recordIdField]: recordId }, scope] },
      });
      if (!record) {
        return response.status(404).json({
          error: {
            code: 'RECORD_NOT_FOUND',
            message: 'The requested record was not found.',
          },
        });
      }
      request.authorizedRecord = record;
    }

    return next();
  };
}

export { actions, buildOwnershipFilter, can, permissionMatrix, requirePermission };
