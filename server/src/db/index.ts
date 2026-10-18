import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { initializeSchema } from "./schema.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultDatabasePath = resolve(moduleDirectory, "../../../data/pms.db");
const databasePath = process.env.DATABASE_PATH
  ? resolve(process.env.DATABASE_PATH)
  : defaultDatabasePath;

mkdirSync(dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec("PRAGMA journal_mode = WAL");
database.exec("PRAGMA foreign_keys = ON");

const migrationPath = fileURLToPath(new URL("./migrations/0001_initial.sql", import.meta.url));
initializeSchema(database, migrationPath);

export function getDatabase(): DatabaseSync {
  return database;
}

export function closeDatabase(): void {
  database.close();
}
