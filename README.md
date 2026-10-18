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

The client runs at <http://127.0.0.1:5173> and the API at <http://127.0.0.1:3000>. Both servers bind only to `127.0.0.1`; the Vite server proxies `/api` to the local API. The app does not call cloud services or external APIs.

The SQLite database is stored at `data/pms.db`, outside the frontend's public directory. Set `PMS_DATABASE_PATH` to use another local file path; paths inside `client/public` are rejected. The database and backup files are ignored by Git. Existing database tables are kept intact: the initial migration uses `IF NOT EXISTS` statements and only adds Drizzle's migration tracking table.

## Available commands

| Command | Description |
| --- | --- |
| `npm run dev` | Run the API and client in development mode |
| `npm run build` | Build both workspaces |
| `npm run typecheck` | Type-check both workspaces |
| `npm run db:generate` | Generate a migration from the Drizzle schema |
| `npm run db:migrate` | Apply pending migrations to the local database |
| `npm run test:db` | Verify migrations and synthetic database read/write in a temporary database |

## Project layout

```text
client/     React + Vite + TypeScript application
server/     Express API, services, middleware, and SQLite database
data/       Local database files (not committed)
backups/    Local backup copies (not committed)
```

The Drizzle schema is in `server/src/db/schema.ts`; generated migrations and journal are under `server/src/db/migrations`. Update the schema and run `npm run db:generate` when making schema changes, then run `npm run db:migrate`. Server startup also applies pending migrations. Migration SQL should be reviewed before applying it to retained local data.

## API

- `GET http://127.0.0.1:3000/api/health` — service and database status

## Local data safety

The SQLite database and backup directory are intentionally excluded from version control. Database verification uses an isolated temporary database with synthetic data and does not write test records to the retained database. Keep independent backups of `data/` when retaining operational data matters.
