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

The SQLite database is stored at `data/pms.db`, outside the frontend's public directory. Set `PMS_DATABASE_PATH` to use another local file path (relative paths are resolved from the project root); paths inside `client/public` are rejected. The database and backup files are ignored by Git. Phase 2 and Phase 3 use additive migrations. Phase 3 adds guest address, country, and status fields, search indexes, and drops the legacy unique email index so family members can share an address. It preserves guest, reservation, property, and unit records.

## Available commands

| Command | Description |
| --- | --- |
| `npm run dev` | Run the API and client in development mode |
| `npm run build` | Build both workspaces |
| `npm run typecheck` | Type-check both workspaces |
| `npm run db:generate` | Generate a migration from the Drizzle schema |
| `npm run db:migrate` | Apply pending migrations to the local database |
| `npm run test:db` | Verify migrations and synthetic database read/write in a temporary database |
| `npm run test:api` | Exercise property and unit endpoints against a temporary database |
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

## Local data safety

The SQLite database and backup directory are intentionally excluded from version control. Database and API tests use isolated temporary databases with synthetic data and do not write test records to the retained database. Keep independent backups of `data/` when retaining operational data matters.

Guest profiles intentionally exclude government ID, passport, and payment-card details. Guest notes are stored as plain text. Guest archiving retains profile and reservation references; archived guests are filtered out by default and must be restored before future reservation workflows should select them. Reservations are not implemented in this phase.
