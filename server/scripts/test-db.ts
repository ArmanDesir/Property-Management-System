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
  assert.ok(migratedTables.includes("staff_accounts"));
  assert.ok(migratedTables.includes("auth_sessions"));
  assert.ok(migratedTables.includes("maintenance_requests"));
  assert.ok(migratedTables.includes("maintenance_history"));
  assert.equal(
    database.$client.prepare("SELECT COUNT(*) AS count FROM maintenance_requests").get()?.count,
    0,
  );
  assert.equal(
    database.$client.prepare("SELECT COUNT(*) AS count FROM maintenance_history").get()?.count,
    0,
  );
  assert.equal(
    database.$client.prepare("SELECT COUNT(*) AS count FROM staff_accounts").get()?.count,
    0,
  );
  assert.equal(
    database.$client.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get()?.count,
    0,
  );
  assert.ok(
    database.$client.prepare("PRAGMA foreign_key_list(auth_sessions)").all()
      .some((foreignKey) =>
        foreignKey.table === "staff_accounts" &&
        foreignKey.from === "staff_id" &&
        foreignKey.on_delete === "CASCADE"
      ),
  );
  assert.ok(
    database.$client.prepare("PRAGMA foreign_key_list(maintenance_requests)").all()
      .some((foreignKey) =>
        foreignKey.table === "properties" &&
        foreignKey.from === "property_id" &&
        foreignKey.on_delete === "RESTRICT"
      ),
  );
  assert.ok(
    database.$client.prepare("PRAGMA foreign_key_list(maintenance_requests)").all()
      .some((foreignKey) =>
        foreignKey.table === "units" &&
        foreignKey.from === "unit_id" &&
        foreignKey.on_delete === "RESTRICT"
      ),
  );
  assert.ok(
    database.$client.prepare("PRAGMA foreign_key_list(maintenance_requests)").all()
      .some((foreignKey) =>
        foreignKey.table === "staff_accounts" &&
        foreignKey.from === "assigned_staff_id" &&
        foreignKey.on_delete === "SET NULL"
      ),
  );
  assert.deepEqual(database.$client.prepare("PRAGMA foreign_key_check").all(), []);
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
      10,
    );
    assert.equal(
      prePhase5Database.$client.prepare("SELECT COUNT(*) AS count FROM invoices").get()?.count,
      0,
    );
    assert.equal(
      prePhase5Database.$client.prepare("SELECT COUNT(*) AS count FROM payments").get()?.count,
      0,
    );
    assert.equal(
      prePhase5Database.$client.prepare("SELECT COUNT(*) AS count FROM billing_entries").get()?.count,
      0,
    );
    assert.ok(
      prePhase5Database.$client.prepare("PRAGMA foreign_key_list(invoices)").all()
        .some((foreignKey) =>
          foreignKey.table === "reservations" &&
          foreignKey.from === "reservation_id" &&
          foreignKey.on_delete === "RESTRICT"
        ),
    );
    assert.ok(
      prePhase5Database.$client.prepare("PRAGMA foreign_key_list(invoice_line_items)").all()
        .some((foreignKey) =>
          foreignKey.table === "invoices" &&
          foreignKey.from === "invoice_id" &&
          foreignKey.on_delete === "RESTRICT"
        ),
    );
    assert.ok(
      prePhase5Database.$client.prepare("PRAGMA foreign_key_list(payments)").all()
        .some((foreignKey) =>
          foreignKey.table === "invoices" &&
          foreignKey.from === "invoice_id" &&
          foreignKey.on_delete === "RESTRICT"
        ),
    );
    assert.ok(
      prePhase5Database.$client.prepare("PRAGMA index_list(payments)").all()
        .some((index) => index.name === "payments_idempotency_key_unique" && index.unique === 1),
    );
    assert.deepEqual(prePhase5Database.$client.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    prePhase5Database.$client.close();
  }

  const prePhase10MigrationsDirectory = resolve(testDirectory, "pre-phase10-migrations");
  const prePhase10MetaDirectory = resolve(prePhase10MigrationsDirectory, "meta");
  mkdirSync(prePhase10MetaDirectory, { recursive: true });
  const prePhase10Tags = [
    "0000_initial",
    "0001_property_units",
    "0002_guest_management",
    "0003_reservations",
    "0004_front_desk",
    "0005_housekeeping",
    "0006_billing_invoicing",
    "0007_staff_access",
  ];
  for (const tag of prePhase10Tags) {
    copyFileSync(
      resolve(migrationsFolder, `${tag}.sql`),
      resolve(prePhase10MigrationsDirectory, `${tag}.sql`),
    );
    copyFileSync(
      resolve(migrationsFolder, `meta/${tag.slice(0, 4)}_snapshot.json`),
      resolve(prePhase10MetaDirectory, `${tag.slice(0, 4)}_snapshot.json`),
    );
  }
  writeFileSync(
    resolve(prePhase10MetaDirectory, "_journal.json"),
    JSON.stringify({ ...currentJournal, entries: currentJournal.entries.slice(0, 8) }, null, 2),
  );
  const prePhase10Database = createDatabase(resolve(testDirectory, "pre-phase10-existing-data.sqlite"));
  try {
    await runMigrations(prePhase10Database, prePhase10MigrationsDirectory);
    const client = prePhase10Database.$client;
    client.prepare("INSERT INTO properties (name) VALUES (?)").run("Preserved Phase 9 Property");
    client.prepare(`
      INSERT INTO units (property_id, name, capacity, base_nightly_rate_cents)
      VALUES (1, 'Preserved Phase 9 Unit', 2, 15000)
    `).run();
    client.prepare("INSERT INTO guests (first_name, last_name) VALUES (?, ?)").run(
      "Synthetic",
      "Preserved Guest",
    );
    client.prepare(`
      INSERT INTO reservations (
        reservation_reference, property_id, guest_id, unit_id, check_in, check_out
      ) VALUES ('SYN-PRESERVE-RES-01', 1, 1, 1, '2035-01-01', '2035-01-02')
    `).run();
    client.prepare(`
      INSERT INTO invoices (
        invoice_number, reservation_id, issue_date, currency,
        subtotal_cents, total_cents
      ) VALUES ('SYN-PRESERVE-01', 1, '2034-12-01', 'USD', 1000, 1000)
    `).run();
    client.prepare(`
      INSERT INTO invoice_line_items (
        invoice_id, description, quantity, unit_price_cents, line_total_cents, position
      ) VALUES (1, 'Synthetic preserved line', 1, 1000, 1000, 0)
    `).run();
    client.prepare("UPDATE invoices SET status = 'issued', issued_at = ? WHERE id = 1")
      .run("2034-12-01T00:00:00.000Z");
    client.prepare(`
      INSERT INTO payments (
        invoice_id, payment_date, amount_cents, method, idempotency_key
      ) VALUES (1, '2034-12-02T00:00:00.000Z', 250, 'cash', 'synthetic-preserve-payment')
    `).run();
    client.prepare("INSERT INTO housekeeping_tasks (property_id, title) VALUES (1, ?)").run(
      "Synthetic preserved housekeeping task",
    );
    client.prepare(`
      INSERT INTO staff_accounts (display_name, username, password_hash, role)
      VALUES ('Synthetic Preserved Staff', 'preserved-staff', 'synthetic-bcrypt-hash', 'administrator')
    `).run();
    client.prepare(`
      INSERT INTO auth_sessions (token_hash, staff_id, csrf_token_hash, expires_at)
      VALUES (?, 1, ?, '2036-01-01T00:00:00.000Z')
    `).run("a".repeat(64), "b".repeat(64));

    await runMigrations(prePhase10Database, migrationsFolder);
    const expectedPreservedCounts = {
      properties: 1,
      units: 1,
      guests: 1,
      reservations: 1,
      invoices: 1,
      invoice_line_items: 1,
      payments: 1,
      housekeeping_tasks: 1,
      staff_accounts: 1,
      auth_sessions: 1,
      maintenance_requests: 0,
      maintenance_history: 0,
    };
    for (const [table, expected] of Object.entries(expectedPreservedCounts)) {
      assert.equal(
        client.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get()?.count,
        expected,
        `${table} rows should survive the additive maintenance migration`,
      );
    }
    assert.equal(
      client.prepare("SELECT name FROM properties WHERE id = 1").get()?.name,
      "Preserved Phase 9 Property",
    );
    assert.equal(
      client.prepare("SELECT status FROM invoices WHERE id = 1").get()?.status,
      "issued",
    );
    assert.deepEqual(client.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    prePhase10Database.$client.close();
  }

  console.log("Additive migration, prior-version preservation, repeat safety, and data integrity tests passed.");
} finally {
  database.$client.close();
  rmSync(testDirectory, { recursive: true, force: true });
}
