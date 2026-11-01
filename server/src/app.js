import cors from "cors";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { requireAuthentication } from "./auth/auth-middleware.js";
import { requirePermission } from "./auth/authorization.js";
import { createAuthRouter } from "./auth/auth-routes.js";
import { createDonorRouter } from "./donors/donor-routes.js";
import { createHospitalRouter } from "./management/hospital-routes.js";
import { createStaffRouter } from "./management/staff-routes.js";
import { createAuditRouter } from "./management/audit-routes.js";
import {
  createBloodUnitRouter,
  createDonationRouter,
  createLaboratoryRouter,
  parseRequiredTestTypes,
} from "./workflows/donation-routes.js";
import {
  createInventoryRouter,
  parseExpiryWarningDays,
  parseThresholds,
} from "./workflows/inventory-routes.js";
import { createBloodRequestRouter } from "./workflows/blood-request-routes.js";
import { createDashboardRouter } from "./workflows/dashboard-routes.js";
import { createPortalRouter } from "./portal/portal-routes.js";
import { createReportsRouter } from "./reports/report-routes.js";

const sessionLifetimeMs = 8 * 60 * 60 * 1000;

function createApp({
  prisma,
  sessionStore,
  sessionSecret = process.env.AUTH_SESSION_SECRET,
  clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173",
  secureCookies = process.env.NODE_ENV === "production",
  bloodUnitRequiredTestTypes = process.env.BLOOD_UNIT_REQUIRED_TEST_TYPES,
  inventoryLowStockThresholds = process.env.INVENTORY_LOW_STOCK_THRESHOLDS,
  inventoryExpiryWarningDays = process.env.INVENTORY_EXPIRY_WARNING_DAYS,
} = {}) {
  if (!prisma)
    throw new Error(
      "A Prisma client is required to create the API application.",
    );
  if (
    typeof sessionSecret !== "string" ||
    Buffer.byteLength(sessionSecret) < 32
  ) {
    throw new Error("AUTH_SESSION_SECRET must contain at least 32 bytes.");
  }

  const app = express();
  const requiredTestTypes = parseRequiredTestTypes(bloodUnitRequiredTestTypes);
  const lowStockThresholds = parseThresholds(inventoryLowStockThresholds);
  const expiryWarningDays = parseExpiryWarningDays(inventoryExpiryWarningDays);
  app.disable("x-powered-by");
  if (secureCookies) app.set("trust proxy", 1);

  app.use(cors({ origin: clientOrigin, credentials: true }));
  app.use(express.json({ limit: "16kb" }));
  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", service: "blood-bank-api" });
  });

  app.use(
    session({
      name: "hema.sid",
      secret: sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: secureCookies,
        sameSite: "lax",
        path: "/",
        maxAge: sessionLifetimeMs,
      },
    }),
  );

  app.use("/api/auth", createAuthRouter({ prisma, clientOrigin }));
  app.use("/api/portal", createPortalRouter({ prisma }));
  app.use("/api/donors", createDonorRouter({ prisma }));
  app.get(
    "/api/staff/session",
    requireAuthentication(prisma),
    requirePermission(prisma, "staff", "view"),
    (request, response) => response.json({ user: request.auth.user }),
  );
  app.use("/api/staff", createStaffRouter({ prisma }));
  app.use("/api/audit-logs", createAuditRouter({ prisma }));
  app.use("/api/hospitals", createHospitalRouter({ prisma }));
  app.use(
    "/api/blood-units",
    createInventoryRouter({
      prisma,
      requiredTestTypes,
      lowStockThresholds,
      expiryWarningDays,
    }),
  );
  app.use("/api/blood-requests", createBloodRequestRouter({ prisma, clientOrigin }));
  app.use("/api/donations", createDonationRouter({ prisma }));
  app.use("/api/laboratory-tests", createLaboratoryRouter({ prisma }));
  app.use(
    "/api/blood-units",
    createBloodUnitRouter({ prisma, requiredTestTypes }),
  );
  app.use(
    "/api/dashboard",
    createDashboardRouter({
      prisma,
      requiredTestTypes,
      lowStockThresholds,
      expiryWarningDays,
    }),
  );
  app.use("/api/reports", createReportsRouter({ prisma, requiredTestTypes }));

  app.use((error, _request, response, _next) => {
    console.error(`API request failed (${error.name || "Error"}).`);
    const status =
      error.status === 413 ? 413 : error.status === 400 ? 400 : 500;
    response.status(status).json({
      error: {
        code:
          status === 400
            ? "INVALID_REQUEST"
            : status === 413
              ? "REQUEST_TOO_LARGE"
              : "INTERNAL_ERROR",
        message:
          status === 400
            ? "The request contains invalid JSON."
            : status === 413
              ? "The request body is too large."
              : "The request could not be completed.",
      },
    });
  });

  return app;
}

function createPostgresSessionStore(pool) {
  if (!pool)
    throw new Error("A PostgreSQL connection pool is required for sessions.");
  const PostgreSqlSessionStore = connectPgSimple(session);
  return new PostgreSqlSessionStore({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: false,
    pruneSessionInterval: 15,
  });
}

export { createApp, createPostgresSessionStore };
