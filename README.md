# Local PMS

A local-first property management system starter built with React, Vite, TypeScript, Express, Drizzle ORM, and SQLite.

## Requirements

- Node.js 22.13+ (uses the built-in `node:sqlite` module)
- npm 10+

## Getting started

From the project root:

```bash
npm install
npm run db:migrate
npm run dev
```

The client runs at <http://127.0.0.1:5173> and the API at <http://127.0.0.1:3000>. Both servers bind only to `127.0.0.1`; the Vite server proxies `/api` to the local API. The app does not call cloud services or external APIs. Loopback binding limits network exposure but is not complete security; continue protecting access to the laptop and its user account.

The backend applies any pending migrations when it starts, including when launched by `npm run dev`. Back up and verify retained local data before starting after an upgrade. To start each development server separately, use `npm run dev:server` and `npm run dev:client` in separate terminals; the backend still applies pending migrations. `npm run dev` starts both together and stops the other process if either one exits.

The SQLite database is stored at `data/pms.db`, outside the frontend's public directory. Set `PMS_DATABASE_PATH` to use another local file path (relative paths are resolved from the project root); paths inside `client/public` are rejected. The database and backup files are ignored by Git. Phase 2 through Phase 7 use additive migrations. Phase 4 extends the existing reservations table in place: legacy reservation IDs, dependent foreign keys, and history are preserved. Legacy reservations retain a null unit assignment because the previous schema did not track units; their reference and lifecycle state are backfilled. Phase 5 adds separate stay status and actual check-in/check-out timestamps to the existing reservations; existing rows start as not checked in, with actual timestamps left null. Phase 6 adds housekeeping status and last-cleaned timestamp columns to units; existing units start as needing cleaning, while their operational and reservation statuses remain unchanged. Phase 7 adds separate invoice, invoice-line-item, and payment tables; it does not alter or seed existing reservations, guests, or the legacy `billing_entries` table.

## Available commands

| Command | Description |
| --- | --- |
| `npm run dev` | Run the API and client in development mode |
| `npm run dev:server` | Run only the API workspace (startup applies pending migrations) |
| `npm run dev:client` | Run only the Vite client |
| `npm run build` | Build both workspaces |
| `npm run typecheck` | Type-check both workspaces |
| `npm run db:generate` | Generate a migration from the Drizzle schema |
| `npm run db:migrate` | Apply pending migrations to the local database |
| `npm run test:db` | Verify migrations and synthetic database read/write in a temporary database |
| `npm run test:api` | Exercise property, unit, guest, reservation, front-desk, and housekeeping endpoints against a temporary database |
| `npm run test:billing` | Exercise invoice and manual-payment endpoints against a temporary database |
| `npm run test:reports` | Exercise read-only reports against a temporary database with synthetic data |
| `npm run test:auth` | Exercise authentication, staff, and authorization against an isolated database |
| `npm run test:maintenance` | Exercise maintenance workflows and role controls against an isolated database |
| `npm run test:phase11` | Exercise property-manager scope, team-task workflow, room availability, and authorization against an isolated database |
| `npm test` | Run migration, API regression, billing, reports, access-control, and maintenance integration tests |

## Project layout

```text
client/     React + Vite + TypeScript application
server/     Express API, services, middleware, and SQLite database
data/       Local database files (not committed)
backups/    Local backup copies (not committed)
```

The Drizzle schema is in `server/src/db/schema.ts`; generated migrations and journal are under `server/src/db/migrations`. Phase 2 uses an additive SQLite migration so existing property records and reservation references remain intact. Units reference properties with `ON DELETE RESTRICT`; unit names are unique per property, case-insensitively, while not archived. Phase 10 adds maintenance request and status-history tables in migration `0008_magical_lady_mastermind`; it does not rewrite prior migrations. Server startup applies pending migrations. Review future migration SQL before applying it to retained local data.

## API

Phase 9 requires a local staff account to access PMS operations. On the first launch after migration, create the initial administrator in the setup screen; no default or demo account is created. Passwords must be at least 12 characters and are stored as bcrypt hashes. Sessions use random opaque tokens with an eight-hour lifetime, an HttpOnly session cookie, a readable SameSite CSRF cookie, and exact local Origin checks. The CSRF cookie uses `/` so the frontend can read it on application routes; unsafe API requests still require the matching header and session-bound hash. The API accepts unsafe requests only from `http://127.0.0.1:5173` by default. For a different local UI port, set `PMS_FRONTEND_ORIGIN` to that exact `http://127.0.0.1:<port>` origin for the server. Do not allow other origins: cookies are shared across ports on the same host. Staff changes and deactivation invalidate existing sessions. There is no password recovery workflow; keep the laptop account and independent database backups secure.

Property managers are assigned to specific active properties by an administrator. Their dashboard, maintenance tools, team tasks, and room calendar are limited to those assignments. Team tasks support manager assignment/editing, staff progress and submission, and manager approval or return for correction. Room availability is read-only and uses actual stay timestamps and half-open reservation nights; starting a reservation continues through the existing reservation workflow.

The API applies default-deny backend authorization to all supported operations:

| Role | Backend access |
| --- | --- |
| Administrator | All supported property, unit, guest, reservation, front desk, housekeeping, invoice, report, and staff operations |
| Property Manager | Assigned-property dashboard, maintenance, team-task administration, and hotel room availability; no access to staff administration or guest/reservation/billing APIs |
| Front Desk | Read properties/units for booking; guest and reservation operations, front-desk dashboard, read-only invoice views, and read-only maintenance views plus request creation; cannot edit, assign, or change maintenance status |
| Housekeeping | Housekeeping overview and housekeeping status transitions; read maintenance information and create cleaning-related requests only; cannot edit, assign, or change maintenance status |
| Accounting | Invoice and payment operations plus read-only reports; no maintenance access |

The API routes below are protected by an active staff session and backend role checks, except for the explicitly public authentication and health routes: property, unit, guest, reservation, front-desk, housekeeping, invoice, report, staff, and maintenance endpoints. Frontend navigation restrictions are only a usability layer; the API authorization middleware is authoritative.

Public/bootstrap routes are `GET /api/health`, `GET /api/auth/status`, `POST /api/auth/setup` (only before the first staff account exists), and `POST /api/auth/login`. `GET /api/auth/me` requires a valid active session. `POST /api/auth/logout` is safe to call without a session and requires CSRF validation when a session is present. The setup status may return a short-lived, one-time bootstrap token while the staff table is empty.

This installation uses local HTTP, so its session cookie cannot use the `Secure` attribute. Loopback binding, cookies, and role checks do not provide protection from malware, a compromised local account, or other local processes. Do not expose the service or treat it as a hardened multi-user network service.

- `GET http://127.0.0.1:3000/api/health` — service and database status
- `GET /api/auth/status` — indicates whether initial administrator setup is required
- `POST /api/auth/setup` — create the first administrator using the short-lived setup token
- `POST /api/auth/login` — sign in to a local staff account
- `GET /api/auth/me` — current staff account
- `POST /api/auth/logout` — end the current session
- `GET /api/staff` — administrator-only staff listing
- `POST /api/staff` — administrator-only staff creation
- `PUT /api/staff/:staffId` — administrator-only staff edit (optional password replacement)
- `PATCH /api/staff/:staffId/status` — administrator-only deactivate/reactivate
- `GET /api/guests?status=active&q=...` — search active guests (status may be `active`, `archived`, or `all`; search checks name, email, and phone)
- `GET /api/guests/:guestId` — read a guest profile
- `POST /api/guests` — create a guest (requires a name and at least one email or phone number)
- `PATCH /api/guests/:guestId` — update an active guest profile
- `POST /api/guests/:guestId/archive` — archive without deleting
- `POST /api/guests/:guestId/restore` — restore an archived guest
- `GET /api/properties?includeArchived=true` — list properties (active by default)
- `POST /api/properties` — create a property
- `GET /api/properties/:propertyId` — read property details
- `PUT /api/properties/:propertyId` — update active property details
- `DELETE /api/properties/:propertyId` — archive a property; does not delete it
- `PATCH /api/properties/:propertyId/status` — restore or archive a property
- `GET /api/properties/:propertyId/units?includeArchived=true` — list units (active by default)
- `POST /api/properties/:propertyId/units` — create a unit for an active property
- `GET /api/properties/:propertyId/units/:unitId` — read unit details
- `PUT /api/properties/:propertyId/units/:unitId` — update an unarchived unit
- `DELETE /api/properties/:propertyId/units/:unitId` — archive a unit; does not delete it
- `PATCH /api/properties/:propertyId/units/:unitId/status` — change status or restore an archived unit
- `GET /api/housekeeping?propertyId=...&status=dirty|cleaning|clean|all` — housekeeping summary and unit list, optionally filtered by active property and cleaning status
- `PATCH /api/housekeeping/units/:unitId/status` — transition housekeeping state among dirty, cleaning, and clean
- `GET /api/maintenance/dashboard` — current maintenance totals, breakdowns, and the latest completed requests
- `GET /api/maintenance/options` — active properties and units; active staff assignment choices are administrator-only
- `GET /api/maintenance?q=...&propertyId=...&unitId=...&status=...&priority=...&category=...&overdue=true&sort=updated&order=desc&limit=50&offset=0` — search, filter, sort, and paginate requests
- `POST /api/maintenance` — create a request; Housekeeping may create cleaning-related requests only
- `GET /api/maintenance/:requestId` — request details and status history
- `PUT /api/maintenance/:requestId` — administrator-only edit of an open or in-progress request
- `PATCH /api/maintenance/:requestId/status` — administrator-only valid status transition
- `GET /api/invoices/reservations?q=...` — search existing reservations for explicit invoice selection
- `GET /api/invoices/reservations/:reservationId` — read the selected reservation summary for invoice review
- `GET /api/invoices` — list/search invoices with status and reservation filters
- `POST /api/invoices` — create a draft invoice for a selected reservation
- `GET /api/invoices/:invoiceId` — read invoice lines, balance, and payment history
- `PUT /api/invoices/:invoiceId` — edit a draft invoice and its line items
- `POST /api/invoices/:invoiceId/issue` — issue and lock a draft invoice snapshot
- `POST /api/invoices/:invoiceId/void` — void an unpaid issued invoice; invoices with payments cannot be voided
- `POST /api/invoices/:invoiceId/payments` — record a manual bookkeeping payment with an idempotency key
- `GET /api/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&propertyId=...` — current operating metrics and selected-period summary
- `GET /api/reports/reservations?from=YYYY-MM-DD&to=YYYY-MM-DD&propertyId=...` — planned arrival/departure and reservation status breakdowns
- `GET /api/reports/occupancy?from=YYYY-MM-DD&to=YYYY-MM-DD&propertyId=...` — eligible unit-night occupancy, aggregated by date
- `GET /api/reports/housekeeping?from=YYYY-MM-DD&to=YYYY-MM-DD&propertyId=...` — current unit status counts and most-recent clean timestamps in range
- `GET /api/reports/billing?from=YYYY-MM-DD&to=YYYY-MM-DD&propertyId=...` — issue-date invoice totals, recorded payments, statuses, and current balances
- `GET /api/front-desk?date=YYYY-MM-DD` — local arrivals, departures, in-house stays, and overdue arrivals for a date (defaults to the machine's local date)
- `POST /api/reservations/:reservationId/check-in` — record an eligible guest check-in and its actual timestamp
- `POST /api/reservations/:reservationId/check-out` — record a current guest check-out and its actual timestamp
- `GET /api/reservations?status=pending&q=...&propertyId=...&unitId=...&guestId=...&checkInFrom=...&checkInTo=...` — search and filter reservations
- `GET /api/reservations/:reservationId` — read reservation details
- `GET /api/reservations/availability?unitId=...&checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&numberOfGuests=...` — calculate an indicative quote and check unit availability
- `POST /api/reservations` — create a pending reservation; the unit's base rate is used unless an override is supplied
- `PUT /api/reservations/:reservationId` — edit a pending or confirmed reservation with eligibility and availability revalidated
- `PATCH /api/reservations/:reservationId/status` — confirm, cancel, or complete a reservation using allowed lifecycle transitions
- `DELETE /api/reservations/:reservationId` — safely cancel an active reservation; it does not delete history

Reservations use half-open stay intervals (`check_in <= date < check_out`). Pending and confirmed reservations hold inventory; cancelled and completed records do not. Creation, confirmation, and edits validate unit/property/guest eligibility, capacity, and overlap inside a synchronous SQLite `BEGIN IMMEDIATE` transaction. Database triggers independently reject invalid relationships and conflicting active reservations. Check-in requires a confirmed reservation, an eligible date, and an active property, guest, and unit; an active stay occupies its assigned unit until check-out. Reservation lifecycle, occupancy, housekeeping, and operational unit status are distinct. Housekeeping progresses through dirty → cleaning → clean, with cleaning able to return to dirty; clean records the completion timestamp. Cleaning actions cannot mark an occupied unit clean or start cleaning it, and do not change the unit's operational status. A checked-out stay marks its unit dirty atomically while retaining the reservation and checkout timestamp. A unit under maintenance remains unavailable after housekeeping is completed; housekeeping status does not override reservation availability or overlap rules. SQLite's busy timeout is five seconds; a lock timeout is reported as a retryable `503`. Reservation references are generated locally and kept unique.

Maintenance requests use categories `plumbing`, `electrical`, `hvac`, `appliance`, `furniture`, `structural`, `cleaning_related`, and `other`; priorities `low`, `normal`, `high`, and `urgent`; and statuses `open`, `in_progress`, `awaiting_parts`, `completed`, and `cancelled`. Transitions are open → in progress/cancelled, in progress → awaiting parts/completed/cancelled, and awaiting parts → in progress/completed/cancelled. Completed and cancelled requests are terminal. Dashboard totals are current snapshots; overdue means a nonterminal request whose target completion date is before the current UTC date, and the completed list contains at most the latest 10 records. Every creation and status transition is recorded in maintenance history. Finishing a request never changes a unit's operational or housekeeping status. Maintenance requests do not yet implement request-linked downtime dates, reservation-conflict checks, or a unit take-out-of-service workflow; use the existing authorized unit status workflow separately and resolve reservation conflicts explicitly.

Billing requires a user to explicitly select an existing reservation; no invoice is created automatically. Draft charges use integer minor currency units, whole-number quantities, and a manually entered tax rate in basis points. The API computes totals and rounds tax to the nearest cent, half up. Invoice currency is inherited from the reservation without conversion. Issued invoice lines and totals are immutable; `partially_paid` and `paid` are derived from recorded payment totals. Payments are bookkeeping records only (no gateway, bank integration, refunds, or reversals); they are idempotent, cannot exceed the outstanding balance, and are retained as immutable history. The existing `billing_entries` table is legacy storage and is not used by the invoice workflow.

Reports are read-only and use inclusive `from`/`to` calendar dates with a maximum range of 366 days. Reservation arrivals and departures use planned check-in/check-out dates; checked-in summary counts use actual stay status. Occupancy follows existing inventory rules: pending and confirmed reservations hold planned unit-nights, while completed reservations represent historical stays. Actual stay timestamps are used when present and planned intervals otherwise; planned nights do not prove that a guest arrived. The report excludes currently inactive, archived, maintenance, or archived-property inventory and de-duplicates overlapping unit-nights. Historical unit eligibility is unavailable, so current eligibility is applied across the selected period. Housekeeping status is a current snapshot; cleaning-date counts use each unit's most recent `last_cleaned_at` timestamp and are not a complete historical cleaning log. Invoice totals use invoice `issue_date`, payments use `payment_date`, and balances/status counts are current. Monetary totals stay grouped by currency; invoice totals are not presented as collected money. Reports do not persist analytics, alter PMS records, or create synthetic data.

## Local data safety

The SQLite database and backup directory are intentionally excluded from version control. Database and API tests use isolated temporary databases with synthetic data and do not write test records to the retained database. Keep independent backups of `data/` when retaining operational data matters.

Guest profiles intentionally exclude government ID, passport, and payment-card details. Guest and reservation notes are stored as plain text. Guest archiving retains profile and reservation references; archived guests are filtered out by default and must be restored before a pending reservation can be confirmed. Reservation cancellation and completion retain history instead of deleting records. Phase 9 adds the additive `0007_staff_access` migration, creating only `staff_accounts` and `auth_sessions`; it does not rewrite earlier migrations or alter existing operational tables. Server startup applies pending migrations, so take and verify a backup before starting the application after an upgrade.
