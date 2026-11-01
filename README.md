# Blood Bank Management System

A beginner-friendly full-stack blood bank application built with React/Vite, Express, Prisma, and PostgreSQL. It includes secure sign-in, backend role/ownership checks, donor management, staff and facility administration, donation collection, unit-level laboratory review, blood inventory, hospital requests, and dispatch traceability.

Authorized hospital users can submit and track requests. Staff review requests, allocate eligible units only after a qualified exact ABO/Rh policy attestation is recorded, and dispatch reserved units with an auditable final disposition. New units stay quarantined; release requires completed, approved test attempts, a confirmed blood group, a non-expired unit, and a locally configured list of required test-type codes. The application does not define clinical thresholds, testing protocols, or broader compatibility rules.

The interface uses a restrained deep-teal, warm-neutral, and muted blood-red palette; Georgia headings with a system sans-serif; shared application layout, breadcrumbs, buttons, panels, status indicators, accessible dialogs, error/loading messages, form fields, and data tables. The layout adapts for desktop, tablet, and mobile. Donor, hospital, and staff dashboards load PostgreSQL records through ownership-scoped Express APIs.

## Stack

- React and Vite for the browser frontend
- JavaScript ES modules
- Express for the REST API
- PostgreSQL and Prisma for database access
- root npm scripts for running both applications

## Prerequisites

- Node.js 20 or newer
- npm
- PostgreSQL 18 or newer
- Windows PowerShell or Command Prompt

## PostgreSQL and Prisma

PostgreSQL is the only application database. Prisma 7 uses the PostgreSQL provider and the `pg` adapter for Node.js.

The approved relational design is documented in [DATABASE-DESIGN.md](./DATABASE-DESIGN.md). Prisma models and additive migrations cover authentication, authorization scopes, donor registration, collection records, and unit-level laboratory review.

The local server configuration belongs in `server/.env`:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/blood_bank?schema=public
```

The committed [.env.example](.env.example) contains only placeholders. `server/.env` is ignored by Git. Never commit a real password or database URL.

### Authentication configuration

The server stores opaque sessions in PostgreSQL and signs the session cookie using `AUTH_SESSION_SECRET`. Generate a random secret locally and write it into the ignored server environment file without printing it:

```powershell
$secret = node -p "require('node:crypto').randomBytes(48).toString('base64url')"
Add-Content -Path server\.env -Value "AUTH_SESSION_SECRET=$secret"
Remove-Variable secret
```

Set `CLIENT_ORIGIN=http://localhost:5173` in `server/.env`. The browser uses the Vite `/api` proxy; session cookies are HTTP-only, same-site, path-scoped, and expire after eight hours. Production cookies are marked `Secure`, so production must use HTTPS. Login, registration, logout, and request cancellation validate the exact configured Origin to prevent cross-site request forgery. The secret is server-only and must never be copied into a `VITE_` variable or sent to the browser.

Public registration accepts only an email, display name, and password and grants only the `DONOR` role. The endpoint rejects role fields. Staff and administrator roles must be assigned by trusted operators; no role-management UI or bootstrap-admin flow is implemented. The existing overview is protected to staff and administrators. No password recovery or MFA flow is implemented.

The [permissions matrix](./PERMISSIONS.md) defines administrator, blood bank staff, donor, and hospital-user access for every record type and operation. Backend middleware enforces permissions on protected endpoints and applies record-ownership scopes. Hospital users can access only requests they submitted at an active member hospital. Hospital membership and active facility status are rechecked on every authenticated request. Donors can only access their own records; their dashboard shows only their staff-recorded donor status and review date, not consent metadata or laboratory results. The donor system records status and review metadata only; it does not determine medical eligibility.

Donor accounts land on `/donor-dashboard`, showing their own profile, donation history, appointments, and staff-recorded donor status/review date. Hospital users land on `/hospital-dashboard`, showing requests submitted by their account, current statuses, and allocation/dispatch history. Both dashboards use dedicated read-only APIs with ownership filters; dashboard data excludes donor consent, request notes, and laboratory screening information.

Donation collection is available at `/donations` to administrators and blood bank staff. Each collection is linked to a donor, facility, active collection staff member, date, volume, and one or more uniquely identified blood units. Collection location is the hospital/clinic record; optional storage location remains a separate inventory concept. New units are always created as `quarantined`. Laboratory records at `/laboratory` are linked to individual units, retain attempts, separate test status from review status, and are visible only to administrators and blood bank staff. Result codes are not written to audit logs.

Unit release is blocked unless `BLOOD_UNIT_REQUIRED_TEST_TYPES` in `server/.env` contains the organization's approved comma-separated test type codes. An empty or missing setting disables release. The latest attempt for each configured and recorded type must be completed and approved; earlier attempts remain in the audit history and can be superseded by a later attempt. These settings are workflow configuration only: the application does not select medical tests, interpret result codes, establish thresholds, or calculate expiry dates. Set this variable only after the organization approves the applicable rules.

The staff dashboard at `/overview` uses scoped PostgreSQL-backed APIs and displays stock for all blood-group/component pairs, including zero counts. Eligible stock counts only units with `available` status, a confirmed blood group, a future expiry, and no release blockers: the latest attempt of each configured or recorded laboratory test type must be completed, approved, and have a result code. The required test-type configuration is described above; the dashboard never counts quarantined, reserved, issued, expired, discarded, unconfirmed, or otherwise blocked units as available stock. Pending requests are those with `open`, `approved`, or `partially_fulfilled` status; their totals include all matching records while the dashboard list shows the eight most recently submitted. Expiry alerts include units expiring after the current time and on or before the configured warning-window cutoff, excluding `expired`, `discarded`, and `issued` units; they may include reserved or quarantined units and are not a statement of release eligibility. Recent donations require a recorded collection time, and recent activity combines collection and request-submission events. Dashboard filters and links open the corresponding inventory, donation, or request records. The staff inventory page is available at `/inventory`; hospital requests are managed at `/requests`. Inventory includes searchable and paginated blood units, group/component/status filters, storage-location management, assignment history, eligible stock summaries, approaching-expiry alerts, and release blockers. Low-stock alerts are configured in `INVENTORY_LOW_STOCK_THRESHOLDS` as comma-separated `BLOOD_GROUP|component:count` entries, for example `A+|red_cells:5,O-|platelets:2`. Expiry alerts use `INVENTORY_EXPIRY_WARNING_DAYS` as a whole number from 1 to 365. Both settings are intentionally blank by default; their values must come from the organization's approved inventory policy. Allocation runs in a PostgreSQL transaction, locks both the request and unit, checks the active exact-match compatibility attestation, and relies on database uniqueness to prevent active duplicate reservations and over-fulfillment.

Administrators and blood bank staff can open `/reports` for aggregate operational reports and CSV export. Reports accept inclusive UTC dates covering at most 366 days and apply active facility scope for staff; output contains no personal identifiers or lab results. Donation trends group by collection date and sum recorded volume. Blood-group/component distribution includes units collected in range and current stored-status counts; its separate release-eligible count applies the same configured eligibility rules as inventory. Inventory turnover is explicitly an end-stock proxy: units dispatched during the range divided by those dispatches plus currently release-eligible stock, not an average-inventory accounting ratio. Request fulfillment includes requests submitted during the range and reports their current statuses; its rate is the share currently fulfilled. Expired/rejected counts refer to units collected in range that are currently marked expired or past expiry, or whose latest recorded test attempt is rejected. Operational activity counts collections, request submissions/status changes, dispatches, and inventory movements by UTC event date. CSV fields are quoted and spreadsheet formula prefixes neutralized.

Authentication requires the additive `20261029150000_authentication` migration, which adds a nullable password hash column and the PostgreSQL session store table. Authorization scopes require `20261029160000_authorization_scopes`, which adds the hospital membership table. Donor management uses `20261029170000_donor_management`, which adds an optional registration-hospital link for staff-scoped donor access. These migrations are additive and do not reset or delete existing data. Existing accounts without a password hash cannot sign in until a secure credential-provisioning process is approved.

Staff-created donor accounts have no password hash and cannot sign in until credentials are provisioned through a separate secure process. New staff user accounts also have no password hash; an administrator must use a secure credential-provisioning process before sign-in. Existing user accounts can be linked to staff profiles and are assigned the staff role by the administrator. Do not assign a password in a profile form or share passwords through email.

Administrators use `/staff` to search, filter, create, update, and deactivate staff profiles, and `/hospitals` to manage facilities and link hospital-user accounts. Staff employee identifiers are unique within each hospital. Hospital registration identifiers are normalized to uppercase and unique across facilities. Hospital-user links are stored as revocable `hospital_users` memberships; assigning a link grants the `HOSPITAL` role, while inactive membership or hospital status removes that hospital from the user's live authorization scope. Staff and facility changes write append-only audit entries containing the actor, record type, action, and changed field names, but not personal field values. Records are deactivated rather than deleted.

Significant account, role/membership, donor-profile, laboratory workflow, inventory-status, allocation, dispatch, and selected sensitive-record access events are recorded in `audit_logs` with actor, action, affected entity, database timestamp, changed field names, and allowlisted non-sensitive status/category metadata. Passwords, session tokens, laboratory result values, and personal field values are not stored in audit entries. Administrators can filter audit history at `/api/audit-logs`; other roles cannot read it. Audit logs are append-only: the API exposes no mutation route and a PostgreSQL trigger rejects updates and deletes. Apply the `20261121120000_audit_log_immutability` migration with the guarded `npm.cmd run db:migrate:dev --prefix server` command.

### Create the database

Create a dedicated application role and database only when you are ready. Run this once as a PostgreSQL administrator; the commands below do not create application tables:

```sql
CREATE ROLE blood_bank_app LOGIN PASSWORD 'choose-a-strong-local-password';
CREATE DATABASE blood_bank OWNER blood_bank_app;
```

Then use the role in `server/.env`. In SQL, database names and role names are not the connection URL itself; URL values must be percent-encoded if they contain reserved characters.

Expected settings:

- Host: `localhost`
- Port: `5432`
- Database: `blood_bank`
- Schema: `public`
- Authentication: password

Validate and verify configuration with:

```powershell
npm.cmd run db:validate --prefix server
npm.cmd run db:generate --prefix server
npm.cmd run db:verify --prefix server
```

`db:verify` performs only `SELECT 1`. It does not create, reset, drop, migrate, or seed anything.

Run the unit and Express API workflow suite with:

```powershell
npm.cmd test
```

The server suite uses synthetic Prisma test doubles for fast role/ownership and business-workflow tests, with Supertest exercising the Express API. It covers login, permissions, donor registration and ownership, collection and laboratory release, inventory expiration and concurrent allocation, requests, fulfillment, and audit events. The optional PostgreSQL suite uses synthetic records in rollback-only transactions and also exercises donor registration and account-scoped dashboard access through the real Express app and database.

```powershell
$env:TEST_DATABASE_URL = 'postgresql://USER:PASSWORD@localhost:5432/blood_bank_test?schema=public'
npm.cmd run test:postgres
Remove-Item Env:TEST_DATABASE_URL
```

Create a separate local test database first; never reuse the application or production database. The target database name must end in `_test`. The test runner verifies the actual PostgreSQL server address is loopback, rejects a target matching `DATABASE_URL`, deploys only versioned Prisma migrations (never reset/drop), then runs PostgreSQL checks for synthetic dashboard request aggregates, release-eligible versus expired inventory, active allocation uniqueness, and request-to-dispatch traceability. Database tests are skipped from the normal `npm.cmd test` run. No browser automation framework is currently configured; end-to-end coverage is at the HTTP/API workflow level.

### Apply the development schema and seed synthetic data

After confirming `server/.env` points to your dedicated development database named `blood_bank`, run:

```powershell
npm.cmd run db:migrate:dev --prefix server
npm.cmd run db:seed:dev --prefix server
```

The migration command checks the database name and refuses to proceed if any of the design's application tables already exist without a successful migration record. It never resets or drops data. The seed command is also insert-only: it refuses to run if any managed application table already contains records, and it inserts clearly synthetic `example.test` data only. Do not run this development seed against production or real donor data.

The additive `20261117115900_blood_unit_test_link_constraint` migration creates the composite key needed to ensure a unit belongs to its linked donation. `20261117120000_donation_laboratory_workflow` associates new laboratory tests with a blood unit, adds review metadata, and permits an explicit failed test status while preserving older donation-level test rows. `20261117130000_blood_unit_test_link_constraint` is an idempotent safeguard for the same composite key. The `20261120120000_blood_requests_and_dispatch` migration adds request review details/history, compatibility attestations, and dispatch/status-history records without resetting existing data. Before applying new migrations, validate and generate the Prisma client, verify the local development connection, then run the guarded development migration:

```powershell
npm.cmd run db:validate --prefix server
npm.cmd run db:generate --prefix server
npm.cmd run db:verify --prefix server
npm.cmd run db:migrate:dev --prefix server
```

## Project structure

```text
blood-bank-management/
├── client/                 # React/Vite application
│   ├── src/
│   │   ├── AppRoutes.jsx   # Login, registration, and protected routes
│   │   ├── auth/           # Browser session state and route guards
│   │   ├── components/     # Shared layout, form, table, dialog, and status UI
│   │   ├── pages/          # Login, donor, staff, hospital, donation, lab, inventory, request, and dashboard pages
│   │   ├── management/     # Shared authenticated administration API client
│   │   ├── main.jsx        # React entry point
│   │   └── styles.css      # Page styles
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── server/                 # Express API
│   ├── src/
│   │   ├── auth/           # Login, session, and authorization middleware
│   │   ├── donors/         # Donor profile, directory, and donation-history API
│   │   ├── management/     # Administrator staff, hospital, and membership APIs
│   │   ├── workflows/      # Collection, lab review, inventory, requests, allocation, and dispatch APIs
│   │   ├── app.js          # Express app, CORS, and PostgreSQL sessions
│   │   └── index.js        # API entry point
│   ├── prisma/
│   │   ├── schema.prisma   # PostgreSQL data model
│   │   └── migrations/     # Versioned SQL migrations
│   ├── scripts/            # Safe database verification, migration, and seed scripts
│   └── package.json
├── DATABASE-DESIGN.md      # Approved ERD and relational design
├── PERMISSIONS.md          # Backend role and ownership policy matrix
├── .env.example
├── .gitignore
├── AGENTS.md
└── package.json
```

## Install

Open PowerShell in the project root and run:

```powershell
npm.cmd install --prefix client
npm.cmd install --prefix server
npm.cmd install
```

Copy the example environment file only if you need to change API settings:

```powershell
Copy-Item .env.example server\.env
```

The example database URL is a placeholder. The health endpoint is independent of PostgreSQL, but authentication requires the PostgreSQL schema migration and valid credentials.

## Start both applications on Windows

From the project root:

```powershell
npm.cmd run dev
```

This starts:

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:5000>
- Health endpoint: <http://localhost:5000/api/health>

To start them separately, open two terminals:

```powershell
npm.cmd run dev --prefix client
```

```powershell
npm.cmd run dev --prefix server
```

## Build and verify

Build the frontend:

```powershell
npm.cmd run build
```

Start the backend and verify its health endpoint:

```powershell
npm.cmd run start
```

In another terminal:

```powershell
npm.cmd run health
```

The response should be:

```json
{ "status": "ok", "service": "blood-bank-api" }
```

If PowerShell blocks `npm.ps1`, use `npm.cmd` as shown above instead of changing system execution policy.
