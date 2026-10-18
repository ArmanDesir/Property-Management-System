import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeSchema } from "./schema.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultDatabasePath = resolve(moduleDirectory, "../../../data/pms.db");
const databasePath = process.env.DATABASE_PATH
  ? resolve(process.env.DATABASE_PATH)
  : defaultDatabasePath;

mkdirSync(dirname(databasePath), { recursive: true });
const database = new Database(databasePath);
database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");

const migrationPath = fileURLToPath(new URL("./migrations/0001_initial.sql", import.meta.url));
initializeSchema(database, migrationPath);

export function getDatabase(): Database.Database {
  return database;
}

export function closeDatabase(): void {
  if (database.open) database.close();
}
