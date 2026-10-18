import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
    CREATE UNIQUE INDEX guests_email_unique
      ON guests(email) WHERE email IS NOT NULL AND email <> '';
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
    .prepare("INSERT INTO guests (first_name, last_name, email) VALUES (?, ?, ?)")
    .run("Test", "Guest", "family@example.test");
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
  const migratedReservation = database.$client
    .prepare(`
      SELECT id, reservation_reference, unit_id, number_of_guests,
        nightly_rate_cents, lifecycle_status, stay_status,
        actual_check_in_at, actual_check_out_at
      FROM reservations WHERE id = 1
    `)
    .get();
  assert.deepEqual(Object.fromEntries(Object.entries(migratedReservation ?? {})), {
    id: 1,
    reservation_reference: "LEGACY-000001",
    unit_id: null,
    number_of_guests: 1,
    nightly_rate_cents: 0,
    lifecycle_status: "confirmed",
    stay_status: "not_checked_in",
    actual_check_in_at: null,
    actual_check_out_at: null,
  });
  assert.ok(
    database.$client.prepare("PRAGMA foreign_key_list(billing_entries)").all()
      .some((foreignKey) => foreignKey.table === "reservations"),
  );
  assert.ok(
    database.$client.prepare("PRAGMA foreign_key_list(housekeeping_tasks)").all()
      .some((foreignKey) => foreignKey.table === "reservations"),
  );
  assert.deepEqual(database.$client.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(
    database.$client
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND name = ?")
      .get("guests_email_unique"),
    undefined,
  );
  const migratedGuest = database.$client
    .prepare("SELECT first_name, email, status, address, country FROM guests WHERE id = 1")
    .get();
  assert.deepEqual(Object.fromEntries(Object.entries(migratedGuest ?? {})), {
    first_name: "Test",
    email: "family@example.test",
    status: "active",
    address: null,
    country: null,
  });
  database.$client
    .prepare("INSERT INTO guests (first_name, last_name, email) VALUES (?, ?, ?)")
    .run("Another", "Family Member", "family@example.test");
  assert.equal(database.$client.prepare("SELECT COUNT(*) AS count FROM guests").get()?.count, 2);

  const migratedTables = database.$client
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
    .all()
    .map((row) => row.name);
  assert.ok(migratedTables.includes("reservations"));
  assert.ok(migratedTables.includes("units"));
  assert.ok(
    database.$client.prepare("PRAGMA table_info(units)").all()
      .some((column) => column.name === "housekeeping_status"),
  );

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

  const phase3MigrationDirectory = resolve(testDirectory, "phase3-migrations");
  const phase3MetaDirectory = resolve(phase3MigrationDirectory, "meta");
  mkdirSync(phase3MetaDirectory, { recursive: true });
  copyFileSync(
    resolve(migrationsFolder, "0002_guest_management.sql"),
    resolve(phase3MigrationDirectory, "0002_guest_management.sql"),
  );
  writeFileSync(
    resolve(phase3MetaDirectory, "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [{
        idx: 0,
        version: "6",
        when: 1,
        tag: "0002_guest_management",
        breakpoints: true,
      }],
    }),
  );

  const phase3Database = createDatabase(resolve(testDirectory, "phase3-existing-data.sqlite"));
  try {
    phase3Database.$client.exec(`
      CREATE TABLE properties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT,
        property_type TEXT NOT NULL DEFAULT 'hotel',
        status TEXT NOT NULL DEFAULT 'active',
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
      CREATE UNIQUE INDEX guests_email_unique
        ON guests(email) WHERE email IS NOT NULL AND email <> '';
      CREATE TABLE units (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        capacity INTEGER NOT NULL,
        base_nightly_rate_cents INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        archived_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
        guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
        check_in TEXT NOT NULL,
        check_out TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO properties (name, address)
        VALUES ('Preserved Synthetic Property', '1 Example Road');
      INSERT INTO units (property_id, name, capacity, base_nightly_rate_cents)
        VALUES (1, 'Preserved Synthetic Unit', 2, 12345);
      INSERT INTO guests (first_name, last_name, email)
        VALUES ('Existing', 'Synthetic Guest', 'shared@example.test');
      INSERT INTO reservations (property_id, guest_id, check_in, check_out)
        VALUES (1, 1, '2030-04-01', '2030-04-02');
    `);

    await runMigrations(phase3Database, phase3MigrationDirectory);
    await runMigrations(phase3Database, phase3MigrationDirectory);

    assert.equal(
      phase3Database.$client.prepare("SELECT name FROM properties WHERE id = 1").get()?.name,
      "Preserved Synthetic Property",
    );
    assert.equal(
      phase3Database.$client.prepare("SELECT name FROM units WHERE id = 1").get()?.name,
      "Preserved Synthetic Unit",
    );
    assert.equal(
      phase3Database.$client.prepare("SELECT guest_id FROM reservations WHERE id = 1").get()?.guest_id,
      1,
    );
    assert.deepEqual(phase3Database.$client.prepare("PRAGMA foreign_key_check").all(), []);
    phase3Database.$client
      .prepare("INSERT INTO guests (first_name, last_name, email) VALUES (?, ?, ?)")
      .run("Second", "Synthetic Guest", "shared@example.test");
    assert.equal(phase3Database.$client.prepare("SELECT COUNT(*) AS count FROM guests").get()?.count, 2);
  } finally {
    phase3Database.$client.close();
  }

  const priorPhase5MigrationsDirectory = resolve(testDirectory, "prior-phase5-migrations");
  const priorPhase5MetaDirectory = resolve(priorPhase5MigrationsDirectory, "meta");
  mkdirSync(priorPhase5MetaDirectory, { recursive: true });
  const priorMigrationTags = [
    "0000_initial",
    "0001_property_units",
    "0002_guest_management",
    "0003_reservations",
    "0004_front_desk",
  ];
  for (const tag of priorMigrationTags) {
    copyFileSync(
      resolve(migrationsFolder, `${tag}.sql`),
      resolve(priorPhase5MigrationsDirectory, `${tag}.sql`),
    );
  }
  const currentJournal = JSON.parse(
    readFileSync(resolve(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as { version: string; dialect: string; entries: unknown[] };
  writeFileSync(
    resolve(priorPhase5MetaDirectory, "_journal.json"),
    JSON.stringify({ ...currentJournal, entries: currentJournal.entries.slice(0, 5) }, null, 2),
  );

  const prePhase5Database = createDatabase(resolve(testDirectory, "pre-phase5-existing-data.sqlite"));
  try {
    await runMigrations(prePhase5Database, priorPhase5MigrationsDirectory);
    prePhase5Database.$client
      .prepare("INSERT INTO properties (name) VALUES (?)")
      .run("Housekeeping Preservation Property");
    prePhase5Database.$client.prepare(`
      INSERT INTO units (property_id, name, unit_type, capacity, base_nightly_rate_cents, status)
      VALUES (1, 'Existing Maintenance Unit', 'room', 2, 14000, 'maintenance')
    `).run();

    await runMigrations(prePhase5Database, migrationsFolder);
    const preservedUnit = prePhase5Database.$client.prepare(`
      SELECT id, property_id, name, status, housekeeping_status, last_cleaned_at
      FROM units WHERE id = 1
    `).get();
    assert.deepEqual(Object.fromEntries(Object.entries(preservedUnit ?? {})), {
      id: 1,
      property_id: 1,
      name: "Existing Maintenance Unit",
      status: "maintenance",
      housekeeping_status: "dirty",
      last_cleaned_at: null,
    });
    assert.equal(
      prePhase5Database.$client.prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()?.count,
      6,
    );
    assert.deepEqual(prePhase5Database.$client.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    prePhase5Database.$client.close();
  }

  console.log("Additive migration, preserved unit/reservation records, repeat safety, and data integrity tests passed.");
} finally {
  database.$client.close();
  rmSync(testDirectory, { recursive: true, force: true });
}
