import { mkdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultDatabasePath = resolve(moduleDirectory, "../../../data/pms.db");
const publicDirectory = resolve(moduleDirectory, "../../../client/public");

export function createDatabase(databasePath = defaultDatabasePath) {
  const resolvedDatabasePath = resolve(databasePath);
  const relativeToPublic = relative(publicDirectory, resolvedDatabasePath);
  if (
    relativeToPublic === "" ||
    (relativeToPublic !== ".." &&
      !relativeToPublic.startsWith(`..${sep}`) &&
      !relativeToPublic.startsWith(`..${sep === "\\" ? "/" : "\\"}`))
  ) {
    throw new Error("SQLite database must be stored outside the frontend public directory");
  }

  mkdirSync(dirname(resolvedDatabasePath), { recursive: true });
  const client = new DatabaseSync(resolvedDatabasePath);
  client.exec("PRAGMA journal_mode = WAL");
  client.exec("PRAGMA foreign_keys = ON");

  return drizzle(client, { schema });
}

export type PmsDatabase = ReturnType<typeof createDatabase>;
