function clearSessionCookie(request, response) {
  response.clearCookie('hema.sid', {
    httpOnly: true,
    secure: request.secure,
    sameSite: 'lax',
    path: '/',
  });
}

function sendUnauthorized(request, response) {
  clearSessionCookie(request, response);
  return response.status(401).json({
    error: {
      code: 'UNAUTHENTICATED',
      message: 'Your session is missing or has expired. Please sign in again.',
    },
  });
}

function requireAuthentication(prisma) {
  return async (request, response, next) => {
    const userId = request.session?.userId;
    if (!userId) return sendUnauthorized(request, response);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        accountStatus: true,
        disabledAt: true,
        roleAssignments: {
          where: { revokedAt: null },
          select: { role: { select: { code: true } } },
        },
        donorProfile: { select: { id: true } },
        staffProfile: {
          select: {
            id: true,
            hospitalId: true,
            staffStatus: true,
            hospital: { select: { isActive: true } },
          },
        },
        hospitalMemberships: {
          where: { isActive: true },
          select: {
            hospitalId: true,
            hospital: { select: { isActive: true } },
          },
        },
      },
    });

    if (!user || user.accountStatus !== 'active' || user.disabledAt) {
      await new Promise((resolve, reject) => {
        request.session.destroy((error) => (error ? reject(error) : resolve()));
      });

      if (!user) return sendUnauthorized(request, response);
      return response.status(403).json({
        error: {
          code: 'ACCOUNT_INACTIVE',
          message: 'This account is unavailable. Contact an administrator.',
        },
      });
    }

    request.auth = {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: user.roleAssignments.map(({ role }) => role.code),
        donorId: user.donorProfile?.id || null,
        staffId: user.staffProfile?.staffStatus === 'active' ? user.staffProfile.id : null,
        hospitalIds: [
          ...(
            user.staffProfile?.staffStatus === 'active' && user.staffProfile.hospital.isActive
              ? [user.staffProfile.hospitalId]
              : []
          ),
          ...(user.hospitalMemberships || [])
            .filter(({ hospital }) => hospital.isActive)
            .map(({ hospitalId }) => hospitalId),
        ],
      },
    };
    return next();
  };
}

export { requireAuthentication };
