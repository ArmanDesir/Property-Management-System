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

The client runs at <http://127.0.0.1:5173> and the API at <http://127.0.0.1:3000>. Both servers bind only to `127.0.0.1`; the Vite server proxies `/api` to the local API. The app does not call cloud services or external APIs. Loopback binding limits network exposure but is not complete security; authentication is not implemented in this phase, so protect access to the laptop and its user account.

The SQLite database is stored at `data/pms.db`, outside the frontend's public directory. Set `PMS_DATABASE_PATH` to use another local file path (relative paths are resolved from the project root); paths inside `client/public` are rejected. The database and backup files are ignored by Git. Phase 2 through Phase 6 use additive migrations. Phase 4 extends the existing reservations table in place: legacy reservation IDs, dependent foreign keys, and history are preserved. Legacy reservations retain a null unit assignment because the previous schema did not track units; their reference and lifecycle state are backfilled. Phase 5 adds separate stay status and actual check-in/check-out timestamps to the existing reservations; existing rows start as not checked in, with actual timestamps left null. Phase 6 adds housekeeping status and last-cleaned timestamp columns to units; existing units start as needing cleaning, while their operational and reservation statuses remain unchanged.

## Available commands

| Command | Description |
| --- | --- |
| `npm run dev` | Run the API and client in development mode |
| `npm run build` | Build both workspaces |
| `npm run typecheck` | Type-check both workspaces |
| `npm run db:generate` | Generate a migration from the Drizzle schema |
| `npm run db:migrate` | Apply pending migrations to the local database |
| `npm run test:db` | Verify migrations and synthetic database read/write in a temporary database |
| `npm run test:api` | Exercise property, unit, guest, reservation, front-desk, and housekeeping endpoints against a temporary database |
| `npm test` | Run database and API integration tests |

## Project layout

```text
client/     React + Vite + TypeScript application
server/     Express API, services, middleware, and SQLite database
data/       Local database files (not committed)
backups/    Local backup copies (not committed)
```

The Drizzle schema is in `server/src/db/schema.ts`; generated migrations and journal are under `server/src/db/migrations`. Phase 2 uses an additive SQLite migration so existing property records and reservation references remain intact. Units reference properties with `ON DELETE RESTRICT`; unit names are unique per property, case-insensitively, while not archived. Server startup applies pending migrations. Review future migration SQL before applying it to retained local data.

## API

- `GET http://127.0.0.1:3000/api/health` — service and database status
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

## Local data safety

The SQLite database and backup directory are intentionally excluded from version control. Database and API tests use isolated temporary databases with synthetic data and do not write test records to the retained database. Keep independent backups of `data/` when retaining operational data matters.

Guest profiles intentionally exclude government ID, passport, and payment-card details. Guest and reservation notes are stored as plain text. Guest archiving retains profile and reservation references; archived guests are filtered out by default and must be restored before a pending reservation can be confirmed. Reservation cancellation and completion retain history instead of deleting records. Loopback-only access is a network boundary, not complete security; authentication is not implemented, so protect access to the laptop and its user account.
