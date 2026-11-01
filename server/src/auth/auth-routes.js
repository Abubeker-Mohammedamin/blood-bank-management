import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { requireAuthentication } from './auth-middleware.js';
import { requirePermission } from './authorization.js';
import { requireExpectedOrigin } from './origin-middleware.js';
import { createDonorNumber } from '../donors/donor-utils.js';
import { writeAudit } from '../management/management-utils.js';

const passwordRounds = 12;
const fallbackPasswordHash = bcrypt.hashSync('not-a-valid-user-password', passwordRounds);
const invalidCredentials = {
  error: {
    code: 'INVALID_CREDENTIALS',
    message: 'Email or password is incorrect.',
  },
};

function createRateLimiter(options) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    ...options,
  });
}

function isValidEmail(email) {
  return typeof email === 'string'
    && email.trim().length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function publicUser(user, roles) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    roles,
  };
}

function createAuthRouter({
  prisma,
  clientOrigin,
  loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 10 }),
  registrationLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, limit: 5 }),
}) {
  const router = Router();
  const originCheck = requireExpectedOrigin(clientOrigin);

  router.post('/register', registrationLimiter, originCheck, async (request, response) => {
    const { email, displayName, password } = request.body || {};
    const allowedKeys = new Set(['email', 'displayName', 'password']);

    if (
      Object.keys(request.body || {}).some((key) => !allowedKeys.has(key))
      || !isValidEmail(email)
      || typeof displayName !== 'string'
      || displayName.trim().length < 1
      || displayName.trim().length > 120
      || typeof password !== 'string'
      || password.length < 12
      || Buffer.byteLength(password, 'utf8') > 72
    ) {
      return response.status(400).json({
        error: {
          code: 'INVALID_REGISTRATION',
          message: 'Provide a valid email, display name, and password of 12 to 72 bytes.',
        },
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, passwordRounds);

    try {
      const user = await prisma.$transaction(async (transaction) => {
        const donorRole = await transaction.role.upsert({
          where: { code: 'DONOR' },
          update: {},
          create: {
            code: 'DONOR',
            name: 'Donor',
            description: 'Publicly assigned basic account role.',
          },
        });

        const created = await transaction.user.create({
          data: {
            email: normalizedEmail,
            displayName: displayName.trim(),
            passwordHash,
            accountStatus: 'active',
            roleAssignments: {
              create: {
                role: { connect: { id: donorRole.id } },
              },
            },
            donorProfile: {
              create: {
                donorNumber: createDonorNumber(),
              },
            },
          },
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        });
        await writeAudit(transaction, request, {
          action: 'account.publicly_registered',
          entityType: 'user',
          entityId: created.id,
          changedFields: ['accountStatus', 'roleAssignments', 'donorProfile'],
          metadata: { changeCategory: 'account', roleCode: 'DONOR', source: 'public_registration' },
        });
        await writeAudit(transaction, request, {
          action: 'permission.role_assigned',
          entityType: 'user',
          entityId: created.id,
          changedFields: ['roleAssignments'],
          metadata: { changeCategory: 'permission', roleCode: 'DONOR', source: 'public_registration' },
        });
        return created;
      });

      return response.status(201).json({ user: publicUser(user, ['DONOR']) });
    } catch (error) {
      if (error.code === 'P2002') {
        return response.status(409).json({
          error: {
            code: 'ACCOUNT_EXISTS',
            message: 'An account with that email address already exists.',
          },
        });
      }
      throw error;
    }
  });

  router.post('/login', loginLimiter, originCheck, async (request, response) => {
    const { email, password } = request.body || {};
    if (
      !isValidEmail(email)
      || typeof password !== 'string'
      || Buffer.byteLength(password, 'utf8') > 72
    ) {
      return response.status(401).json(invalidCredentials);
    }

    const user = await prisma.user.findFirst({
      where: { email: email.trim().toLowerCase() },
      select: {
        id: true,
        email: true,
        displayName: true,
        passwordHash: true,
        accountStatus: true,
        disabledAt: true,
        roleAssignments: {
          where: { revokedAt: null },
          select: { role: { select: { code: true } } },
        },
      },
    });

    const passwordMatches = await bcrypt.compare(
      password,
      user?.passwordHash || fallbackPasswordHash,
    );
    if (!user || !user.passwordHash || !passwordMatches) {
      return response.status(401).json(invalidCredentials);
    }

    if (user.accountStatus !== 'active' || user.disabledAt) {
      return response.status(403).json({
        error: {
          code: 'ACCOUNT_INACTIVE',
          message: 'This account is unavailable. Contact an administrator.',
        },
      });
    }

    await new Promise((resolve, reject) => {
      request.session.regenerate((error) => (error ? reject(error) : resolve()));
    });
    request.session.userId = user.id;
    await new Promise((resolve, reject) => {
      request.session.save((error) => (error ? reject(error) : resolve()));
    });

    const roles = user.roleAssignments.map(({ role }) => role.code);
    return response.json({ user: publicUser(user, roles) });
  });

  router.get(
    '/me',
    requireAuthentication(prisma),
    requirePermission(prisma, 'users', 'view'),
    (request, response) => response.json({ user: request.auth.user }),
  );

  router.post('/logout', originCheck, (request, response, next) => {
    if (!request.session) return response.sendStatus(204);

    request.session.destroy((error) => {
      if (error) return next(error);
      response.clearCookie('hema.sid', {
        httpOnly: true,
        secure: request.secure,
        sameSite: 'lax',
        path: '/',
      });
      return response.sendStatus(204);
    });
  });

  return router;
}

export { createAuthRouter };
