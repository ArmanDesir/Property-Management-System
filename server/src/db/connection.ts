import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDirectory, "../../..");
const defaultDatabasePath = resolve(projectRoot, "data/pms.db");
const publicDirectory = resolve(projectRoot, "client/public");

export function createDatabase(
  databasePath = process.env.PMS_DATABASE_PATH ?? defaultDatabasePath,
) {
  const resolvedDatabasePath = resolve(projectRoot, databasePath);
  const relativeToPublic = relative(publicDirectory, resolvedDatabasePath);
  if (
    relativeToPublic === "" ||
    (!relativeToPublic.startsWith("..") && !isAbsolute(relativeToPublic))
  ) {
    throw new Error("SQLite database must be stored outside the frontend public directory");
  }

  mkdirSync(dirname(resolvedDatabasePath), { recursive: true });
  const client = new DatabaseSync(resolvedDatabasePath);
  client.exec("PRAGMA busy_timeout = 5000");
  client.exec("PRAGMA journal_mode = WAL");
  client.exec("PRAGMA foreign_keys = ON");

  const database = drizzle(
    async (query, params, method) => {
      const statement = client.prepare(query);
      if (method === "all") {
        return {
          rows: statement.all(...params).map((row) => Object.values(row)),
        };
      }
      if (method === "values") {
        return { rows: statement.all(...params).map((row) => Object.values(row)) };
      }
      if (method === "get") {
        const row = statement.get(...params);
        return { rows: row ? Object.values(row) : [] };
      }

      const result = statement.run(...params);
      return {
        rows: [{
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        }],
      };
    },
    { schema },
  );

  return Object.assign(database, { $client: client });
}

export type PmsDatabase = ReturnType<typeof createDatabase>;
