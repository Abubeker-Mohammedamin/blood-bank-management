# Backend permissions

The API uses the authenticated account's active role assignments for every authorization decision. A frontend may use the same policy to tailor its display, but hiding a button is never an access control.

## Permission matrix

Action abbreviations: **V** view, **C** create, **U** update, **Ap** approve, **Al** allocate, **Dp** dispatch, **E** export. A dash means no access.

| Record type | Administrator | Blood bank staff | Donor | Hospital user |
|---|---|---|---|---|
| Users | V/C/U/E | V | V/U | V/U |
| Roles | V/C/U/E | - | - | - |
| Hospital memberships | V/C/U/E | - | - | - |
| Hospitals | V/C/U/E | V | - | V |
| Staff | V/C/U/E | V | - | - |
| Donors | V/C/U/Ap/E | V/C/U/Ap/E | V/C/U | - |
| Blood types | V/C/U/E | V/E | - | V |
| Appointments | V/C/U/Ap/E | V/C/U/Ap/E | V/C/U | V |
| Donations | V/C/U/Ap/E | V/C/U/Ap/E | V | - |
| Laboratory tests | V/C/U/Ap/E | V/C/U/Ap/E | - | - |
| Verified donation blood types | V/C/Ap/E | V/C/Ap/E | - | - |
| Storage locations | V/C/U/E | V/C/U/E | - | - |
| Blood units | V/C/U/Ap/Al/Dp/E | V/C/U/Ap/Al/Dp/E | - | V |
| Blood unit movements | V/C/Dp/E | V/C/Dp/E | - | V |
| Blood requests | V/C/U/Ap/Al/Dp/E | V/C/U/Ap/Al/Dp/E | - | V/C/U/E |
| Allocations | V/C/U/Ap/Al/Dp/E | V/C/U/Ap/Al/Dp/E | - | V/E |
| Dispatch records | V/Dp/U/E | V/Dp/U/E | - | V |
| Compatibility approvals | V/C | V | - | - |
| Notifications | V/C/U | V/C/U | V/U | V/U |
| Audit logs | V | - | - | - |
| Operational reports | V/E | V/E | - | - |

Audit logs are available through the read-only `/api/audit-logs` endpoint to administrators only. The API has no audit-log create, update, or delete route; application events are written by trusted server workflows, and a PostgreSQL trigger rejects updates and deletes. Ordinary users cannot read or alter audit history. Delete is not an allowed action for any record type. Business records and their history must be closed, revoked, or deactivated rather than deleted.

## Record ownership and organization scope

- **Donors:** user, donor profile, appointments, donations, and notifications are limited to that donor's own account/profile. The donor dashboard may show only the account owner's staff-recorded donor status and eligibility-review timestamp; these are administrative records, not a medical eligibility determination. Donors may not read consent metadata, internal lab tests, or other screening details, including through filters. They cannot choose or change another donor's ID on a write.
- **User records:** every non-administrator can view only their own user record. Staff do not get general access to all user accounts.
- **Hospital users:** each active hospital membership is stored in `hospital_users`. A hospital user may view records belonging to those assigned hospitals. Blood requests and their allocations are additionally limited to requests submitted by that user. A create/update handler must bind `requestedByUserId` to the authenticated user and validate every hospital ID against active memberships; never trust ownership IDs from the request body.
- **Blood bank staff:** access to hospital-scoped operational records is limited to the hospital on the active staff profile and to active hospitals. Staff views of donor profiles are limited to donors registered at, booked at, or donating at those hospitals.
- **Administrators:** may access records across hospitals. Audit history remains read-only.
- **Shared reference data:** permitted users may access the specific shared lookup records in the matrix, such as blood types.
- **Exports:** are explicitly granted per record type and use the same record ownership filter as ordinary reads. Exports must not bypass the scope applied to list/detail queries.
- **Audit logs:** audit-list queries are administrator-only and filterable by action, entity, actor, and timestamp. Opening the audit log is itself recorded. Event metadata is allowlisted and contains only non-sensitive categories/status transitions; passwords, session tokens, lab result values, and personal data are never recorded.
- **Operational reports:** administrators can report across facilities; staff reports and CSV exports are restricted to active assigned hospitals. Donors and hospital users cannot access reports. Report output is aggregate-only and excludes personal identifiers and laboratory results.

When adding an endpoint, put `requireAuthentication(prisma)` before `requirePermission(prisma, resource, action)`. For a detail endpoint, pass its Prisma delegate as `recordDelegate` so the row is fetched using both its ID and ownership scope. For list endpoints, pass `{ scoped: true }`, then combine `request.auth.resourceScope` with the endpoint's filters in the Prisma `where` clause. For creates that accept a hospital, pass `{ organizationField: 'hospitalId' }` so membership is checked before handler logic. Create handlers must still set actor/owner fields from `request.auth.user` and validate required fields. Update, approve, allocate, and dispatch handlers must validate allowed state transitions and ownership in the same database operation/transaction. Do not rely on client-provided role, user, donor, hospital, staff, or audit actor IDs.

The server implements authentication, donor registration/profile/history, administrator-only staff and hospital management, donation collection, laboratory testing/review, controlled blood-unit release, storage-location management, inventory listing/alerts, hospital blood requests, request review, allocation, dispatch, and administrator-only audit-log reads.

The donor and hospital dashboards use dedicated read-only endpoints. Donor data is selected by the authenticated user's donor profile; hospital requests are filtered to both the authenticated submitter and their active hospital memberships. Dashboard responses omit consent records, request notes, laboratory results, and donor/unit identifying details from hospital fulfillment history.

Donation collection and unit-level laboratory endpoints require administrator or blood bank staff roles and apply active-hospital ownership scope to staff. A collection links the donor, facility, active collection staff member, date, volume, and unique unit identifier(s) in one transaction. Each new unit is forced to `quarantined`; clients cannot set its status during creation.

Laboratory result codes and review history are returned only from administrator/staff laboratory endpoints. Hospital users may view unit inventory but receive no laboratory test relation from the unit-list endpoint. A test's result value is never copied into audit metadata. Corrections are new attempts; reviews are final and recorded with the reviewer staff profile and time. The additive workflow migration leaves prior donation-level tests intact; new test creation requires a specific blood unit.

Release is an `approve` permission on a blood unit. The server requires `BLOOD_UNIT_REQUIRED_TEST_TYPES` to list organization-approved type codes, checks the latest attempt for each configured and recorded type, and blocks release unless those latest attempts are completed, have result codes, and are approved. Earlier attempts remain in history and may be superseded by later attempts. A missing configuration blocks all release. The application does not prescribe tests, thresholds, or result interpretation.

Hospital and staff management write append-only audit entries in the same database transaction as each change. Audit entries record the authenticated actor, action, entity, and changed field names, but never field values or credentials. Records with historical links are deactivated rather than deleted. Staff employee numbers are normalized to uppercase and unique within their hospital; hospital registration identifiers are normalized to uppercase and unique across hospitals.

Hospital requests are created with the authenticated submitter and an active hospital membership from the session. A hospital account may view and cancel only its own submitted requests; it cannot review, allocate, dispatch, or change another account's records. Staff are limited to active assigned hospitals, and administrators have global scope. Cross-hospital and cross-user detail lookup returns not found.

Requests begin in `open` and require administrator/staff review before allocation. Only `approved` or `partially_fulfilled` requests may receive allocations. Cancellation is limited to requests with no active allocations; allocated and historical records are retained. The API records every request status transition and operational audit entry.

Allocation requires an active administrator-recorded attestation of qualified review of the exact ABO/Rh matching policy. The attestation stores reviewer name and credential, review date, policy version, and description. The application performs strict exact ABO/Rh and component matching; it does not implement broader compatibility logic. Allocation locks both the request and blood unit in a PostgreSQL transaction, checks the current release/testing/expiry state, and prevents over-fulfillment and duplicate active unit allocation.

Dispatch requires an active staff profile at the request's hospital. Each reserved allocation can be dispatched once. The API records the staff member, actor, timestamps, request, unit, and status history in one transaction. Terminal outcomes are delivered (with a recorded `transfused` or `not_transfused` disposition), returned to inventory quarantine, or discarded. Returned units are quarantined and are not automatically made available. Hospital users can see their request's allocation and dispatch history but do not receive laboratory result details; laboratory result records remain restricted to staff and administrators.

The donor module assigns a random, unique donor number and relies on database uniqueness for both donor number and account email. Staff-created donor accounts have no password hash and therefore cannot sign in until credentials are provisioned separately. Public donor registration creates both the account and its donor profile. Screening fields are limited to the existing manual record status, review timestamp, and consent metadata; the system does not apply or invent medical eligibility rules.

## Implementation and tests

The central policy is in `server/src/auth/authorization.js`. Hospital ownership is resolved from current active database memberships during authentication. The additive `20261029160000_authorization_scopes` migration creates `hospital_users`; only an administrator can link a hospital account through the API. Public registration cannot grant the `HOSPITAL` role.

Run the backend tests from the project root:

```powershell
npm.cmd test
```

The automated tests cover every role/resource/action combination, unauthenticated and denied access, record-level ownership filters, and cross-hospital isolation. No database migration is applied by the test suite.
