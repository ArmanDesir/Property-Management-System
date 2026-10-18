import { dirname, resolve } from "node:path";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./connection.js";

const database = createDatabase();
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "migrations");

try {
  migrate(database, { migrationsFolder });
  console.log("Database migrations applied successfully.");
} finally {
  database.$client.close();
}
