import { dirname, resolve } from "node:path";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./connection.js";

const database = createDatabase();
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "migrations");
migrate(database, { migrationsFolder });

export function getDatabase() {
  return database;
}

export function closeDatabase(): void {
  database.$client.close();
}
