import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./connection.js";
import { runMigrations } from "./migrations.js";

const database = createDatabase();
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "migrations");
await runMigrations(database, migrationsFolder);

export function getDatabase() {
  return database;
}

export function closeDatabase(): void {
  database.$client.close();
}
