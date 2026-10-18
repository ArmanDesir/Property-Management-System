import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./connection.js";
import { runMigrations } from "./migrations.js";

const database = createDatabase();
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "migrations");

try {
  await runMigrations(database, migrationsFolder);
  console.log("Database migrations applied successfully.");
} finally {
  database.$client.close();
}
