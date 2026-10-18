import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../src/db/connection.js";
import { properties } from "../src/db/schema.js";

const testDirectory = mkdtempSync(resolve(tmpdir(), "local-pms-db-test-"));
const database = createDatabase(resolve(testDirectory, "test.sqlite"));
const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/db/migrations",
);

try {
  migrate(database, { migrationsFolder });
  const [inserted] = database
    .insert(properties)
    .values({ name: "Synthetic Test Property", address: "1 Example Street" })
    .returning({ id: properties.id, name: properties.name })
    .all();
  assert.ok(inserted);

  const [readBack] = database
    .select({ id: properties.id, name: properties.name, address: properties.address })
    .from(properties)
    .where((fields, { eq }) => eq(fields.id, inserted.id))
    .all();
  assert.deepEqual(readBack, {
    id: inserted.id,
    name: "Synthetic Test Property",
    address: "1 Example Street",
  });

  console.log("Database migration and synthetic read/write test passed.");
} finally {
  database.$client.close();
  rmSync(testDirectory, { recursive: true, force: true });
}
