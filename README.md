# Local PMS

A local-first property management system starter built with React, Vite, TypeScript, Express, and SQLite.

## Requirements

- Node.js 22.13+
- npm 10+

## Getting started

From the project root:

```bash
npm install
npm run dev
```

The client runs at <http://localhost:5173> and the API at <http://localhost:3000>. The API creates `data/pms.db` on first startup. Database files and backups are ignored by Git.

## Available commands

| Command | Description |
| --- | --- |
| `npm run dev` | Run the API and client in development mode |
| `npm run build` | Build both workspaces |
| `npm run typecheck` | Type-check both workspaces |

## Project layout

```text
client/     React + Vite + TypeScript application
server/     Express API, services, middleware, and SQLite database
data/       Local database files (not committed)
backups/    Local backup copies (not committed)
```

The initial SQLite migration creates properties, guests, reservations, billing entries, and housekeeping tasks. Add subsequent schema changes as new, numbered SQL files under `server/src/db/migrations`.

## API

- `GET /api/health` — service and database status

## Local data safety

The SQLite database and backup directory are intentionally excluded from version control. Keep independent backups of `data/` when retaining operational data matters.
