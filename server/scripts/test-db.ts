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
  assert.throws(
    () => createDatabase(resolve(process.cwd(), "../client/public/rejected-test.sqlite")),
    /outside the frontend public directory/,
  );

  database.$client.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE guests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
      guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
      check_in TEXT NOT NULL,
      check_out TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'booked',
      total_amount_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (check_out > check_in)
    );
  `);
  database.$client
    .prepare("INSERT INTO properties (name, address) VALUES (?, ?)")
    .run("Existing Synthetic Property", "2 Example Street");
  database.$client
    .prepare("INSERT INTO guests (first_name, last_name) VALUES (?, ?)")
    .run("Test", "Guest");
  database.$client
    .prepare(`
      INSERT INTO reservations (property_id, guest_id, check_in, check_out)
      VALUES (?, ?, ?, ?)
    `)
    .run(1, 1, "2030-01-02", "2030-01-05");

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
  const retainedReservation = database.$client
    .prepare("SELECT property_id, guest_id, check_in FROM reservations WHERE id = 1")
    .all();
  assert.deepEqual(
    retainedReservation.map((row) => Object.fromEntries(Object.entries(row))),
    [{ property_id: 1, guest_id: 1, check_in: "2030-01-02" }],
  );
  assert.deepEqual(database.$client.prepare("PRAGMA foreign_key_check").all(), []);

  const migratedTables = database.$client
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
    .all()
    .map((row) => row.name);
  assert.ok(migratedTables.includes("reservations"));
  assert.ok(migratedTables.includes("units"));

  const migratedProperty = database.$client
    .prepare("SELECT property_type, default_currency, status FROM properties WHERE name = ?")
    .get("Existing Synthetic Property");
  assert.deepEqual(Object.fromEntries(Object.entries(migratedProperty ?? {})), {
    property_type: "other",
    default_currency: "USD",
    status: "active",
  });

  const foreignKeys = database.$client.prepare("PRAGMA foreign_key_list(units)").all();
  assert.ok(foreignKeys.some((foreignKey) =>
    foreignKey.table === "properties" &&
    foreignKey.from === "property_id" &&
    foreignKey.on_delete === "RESTRICT"
  ));
  console.log("Additive migration, history, defaults, and synthetic record preservation test passed.");
} finally {
  database.$client.close();
  rmSync(testDirectory, { recursive: true, force: true });
}
