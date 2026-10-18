import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";
import { properties } from "../src/db/schema.js";

const testDirectory = mkdtempSync(resolve(tmpdir(), "local-pms-db-test-"));
const database = createDatabase(resolve(testDirectory, "test.sqlite"));
const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/db/migrations",
);

try {
  database.$client.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  database.$client
    .prepare("INSERT INTO properties (name, address) VALUES (?, ?)")
    .run("Existing Synthetic Property", "2 Example Street");

  await runMigrations(database, migrationsFolder);
  await runMigrations(database, migrationsFolder);

  await database
    .insert(properties)
    .values({ name: "Synthetic Test Property", address: "1 Example Street" })
    .run();

  const rows = await database
    .select({ id: properties.id, name: properties.name, address: properties.address })
    .from(properties)
    .where(eq(properties.name, "Synthetic Test Property"))
    .all();
  assert.deepEqual(rows, [{
    id: 2,
    name: "Synthetic Test Property",
    address: "1 Example Street",
  }]);

  const retainedRow = await database
    .select({ name: properties.name })
    .from(properties)
    .where(eq(properties.name, "Existing Synthetic Property"))
    .all();
  assert.deepEqual(retainedRow, [{ name: "Existing Synthetic Property" }]);

  const migratedTables = database.$client
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
    .all()
    .map((row) => row.name);
  assert.ok(migratedTables.includes("reservations"));
  console.log("Idempotent migration and synthetic read/write preservation test passed.");
} finally {
  database.$client.close();
  rmSync(testDirectory, { recursive: true, force: true });
}
