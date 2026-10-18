import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";

const testDirectory = mkdtempSync(resolve(tmpdir(), "local-pms-reports-test-"));
const database = createDatabase(resolve(testDirectory, "reports-test.sqlite"));
const migrationsFolder = resolve(process.cwd(), "src/db/migrations");
let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;

try {
  await runMigrations(database, migrationsFolder);
  createSyntheticFixtures();
  server = createApp(database).listen(0, "127.0.0.1");
  await new Promise<void>((resolveListening, reject) => {
    server?.once("listening", resolveListening);
    server?.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  assert.equal(address.address, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${address.port}/api/reports`;
  const query = "?from=2030-03-01&to=2030-03-04";
  const before = snapshot();

  const request = async (path: string) => {
    const response = await fetch(`${baseUrl}${path}`);
    return { status: response.status, data: await response.json() as Record<string, any> };
  };

  const summary = await request(`/summary${query}`);
  assert.equal(summary.status, 200);
  assert.equal(summary.data.report.metrics.activeProperties, 2);
  assert.equal(summary.data.report.metrics.activeUnits, 2);
  assert.equal(summary.data.report.metrics.arrivals, 4);
  assert.equal(summary.data.report.metrics.departures, 4);
  assert.equal(summary.data.report.metrics.checkedInStays, 1);
  assert.equal(summary.data.report.metrics.dirtyUnits, 1);
  assert.equal(summary.data.report.metrics.cleaningUnits, 2);
  assert.equal(summary.data.report.metrics.cleanUnits, 1);
  assert.equal(summary.data.report.metrics.maintenanceUnits, 1);
  assert.deepEqual(summary.data.report.metrics.issuedInvoiceTotals, [
    { currency: "EUR", totalCents: "5000" },
    { currency: "USD", totalCents: "10000" },
  ]);
  assert.deepEqual(summary.data.report.metrics.outstandingBalances, [
    { currency: "USD", balanceCents: "7500" },
  ]);
  const propertySummary = await request(`/summary${query}&propertyId=1`);
  assert.equal(propertySummary.status, 200);
  assert.equal(propertySummary.data.report.metrics.activeProperties, 1);
  assert.equal(propertySummary.data.report.metrics.activeUnits, 1);
  assert.equal(propertySummary.data.report.metrics.arrivals, 2);
  assert.equal(propertySummary.data.report.metrics.departures, 2);
  assert.equal(propertySummary.data.report.metrics.checkedInStays, 0);

  const reservations = await request(`/reservations${query}`);
  assert.equal(reservations.status, 200);
  assert.deepEqual(reservations.data.report.statusCounts, {
    pending: 1,
    confirmed: 2,
    cancelled: 1,
    completed: 1,
  });
  assert.deepEqual(reservations.data.report.arrivalsByDate, [
    { date: "2030-03-01", count: 1 },
    { date: "2030-03-02", count: 2 },
    { date: "2030-03-03", count: 1 },
  ]);
  assert.deepEqual(reservations.data.report.departuresByDate, [
    { date: "2030-03-03", count: 1 },
    { date: "2030-03-04", count: 3 },
  ]);
  assert.equal(reservations.data.report.byProperty.length, 2);
  assert.equal(reservations.data.report.byUnit.length, 2);
  assert.equal("guestName" in reservations.data.report, false);

  const occupancy = await request(`/occupancy${query}`);
  assert.equal(occupancy.status, 200);
  assert.equal(occupancy.data.report.totalEligibleUnits, 2);
  assert.equal(occupancy.data.report.totalEligibleUnitNights, 8);
  assert.equal(occupancy.data.report.occupiedUnitNights, 4);
  assert.equal(occupancy.data.report.availableUnitNights, 4);
  assert.equal(occupancy.data.report.occupancyPercentage, 50);
  assert.deepEqual(
    occupancy.data.report.breakdown.map((row: Record<string, number | string>) => row.occupiedUnits),
    [1, 2, 1, 0],
  );
  const propertyAOccupancy = await request(`/occupancy${query}&propertyId=1`);
  assert.equal(propertyAOccupancy.data.report.totalEligibleUnits, 1);
  assert.equal(propertyAOccupancy.data.report.occupiedUnitNights, 3);
  const actualCheckInDate = database.$client.prepare(`
    SELECT substr(actual_check_in_at, 1, 10) AS date
    FROM reservations WHERE reservation_reference = 'SYN-RES-CURRENT'
  `).get()?.date as string;
  const actualOccupancy = await request(
    `/occupancy?from=${actualCheckInDate}&to=${actualCheckInDate}&propertyId=2`,
  );
  assert.equal(actualOccupancy.data.report.occupiedUnitNights, 1);

  const housekeeping = await request(`/housekeeping${query}`);
  assert.equal(housekeeping.status, 200);
  assert.deepEqual(housekeeping.data.report.current, {
    dirty: 1,
    cleaning: 2,
    clean: 1,
    maintenance: 1,
    inactive: 1,
  });
  assert.deepEqual(housekeeping.data.report.lastRecordedCleaningsByDate, [
    { date: "2030-03-03", count: 1 },
  ]);

  const billing = await request(`/billing${query}`);
  assert.equal(billing.status, 200);
  assert.deepEqual(
    billing.data.report.issuedTotalsByCurrency.map((row: Record<string, string>) => ({
      currency: row.currency,
      totalCents: row.totalCents,
    })),
    [
      { currency: "EUR", totalCents: "5000" },
      { currency: "USD", totalCents: "10000" },
    ],
  );
  assert.deepEqual(billing.data.report.paymentsByDate.map((row: Record<string, string>) => ({
    date: row.date,
    currency: row.currency,
    amountCents: row.amountCents,
  })), [
    { date: "2030-03-03", currency: "USD", amountCents: "2500" },
    { date: "2030-03-04", currency: "EUR", amountCents: "5000" },
  ]);
  assert.deepEqual(billing.data.report.invoiceStatusCounts, {
    draft: 1,
    issued: 0,
    partially_paid: 1,
    paid: 1,
    void: 1,
  });
  assert.deepEqual(billing.data.report.outstandingTotalsByCurrency, [
    { currency: "USD", balanceCents: "7500" },
  ]);
  assert.equal(billing.data.report.outstandingInvoices.length, 1);
  assert.equal(billing.data.report.outstandingInvoices[0].balanceCents, "7500");

  const filteredBilling = await request(`/billing${query}&propertyId=1`);
  assert.equal(filteredBilling.data.report.issuedTotalsByCurrency.length, 1);
  assert.equal(filteredBilling.data.report.issuedTotalsByCurrency[0].currency, "USD");
  assert.equal(filteredBilling.data.report.paymentsByDate.length, 1);

  assert.equal((await request("/summary?from=2030-02-30&to=2030-03-01")).status, 400);
  assert.equal((await request("/summary?from=2030-03-02&to=2030-03-01")).status, 400);
  assert.equal((await request("/summary?from=2030-01-01&to=2031-01-02")).status, 400);
  assert.equal((await request(`/summary${query}&propertyId=99999`)).status, 404);
  assert.equal((await request(`/summary${query}&propertyId=1&propertyId=2`)).status, 400);

  const empty = await request("/occupancy?from=2032-01-01&to=2032-01-02&propertyId=3");
  assert.equal(empty.status, 200);
  assert.equal(empty.data.report.totalEligibleUnitNights, 0);
  assert.equal(empty.data.report.occupancyPercentage, null);
  assert.equal(snapshot(), before);

  console.log("Reports integration tests passed: date filters, privacy, summary, reservations, occupancy, housekeeping, billing, and read-only checks.");
} finally {
  if (server?.listening) {
    await new Promise<void>((resolveClose, reject) => {
      server?.close((error) => error ? reject(error) : resolveClose());
    });
  }
  database.$client.close();
  rmSync(testDirectory, { recursive: true, force: true });
}

function createSyntheticFixtures(): void {
  const client = database.$client;
  client.prepare("INSERT INTO properties (name, property_type, default_currency) VALUES (?, ?, ?)").run("Synthetic North", "hotel", "USD");
  client.prepare("INSERT INTO properties (name, property_type, default_currency) VALUES (?, ?, ?)").run("Synthetic South", "resort", "EUR");
  client.prepare("INSERT INTO properties (name, status) VALUES (?, 'archived')").run("Synthetic Archived");

  const addUnit = client.prepare(`
    INSERT INTO units (
      property_id, name, unit_type, capacity, base_nightly_rate_cents, status,
      housekeeping_status, last_cleaned_at, archived_at
    ) VALUES (?, ?, 'room', 2, 10000, ?, ?, ?, ?)
  `);
  addUnit.run(1, "N-01", "active", "clean", "2030-03-03T11:00:00.000Z", null);
  addUnit.run(1, "N-02", "maintenance", "dirty", null, null);
  addUnit.run(1, "N-03", "inactive", "cleaning", null, null);
  addUnit.run(1, "N-04", "active", "clean", null, "2030-01-01T00:00:00.000Z");
  addUnit.run(2, "S-01", "active", "cleaning", null, null);
  addUnit.run(3, "A-01", "active", "dirty", null, null);

  const addGuest = client.prepare("INSERT INTO guests (first_name, last_name) VALUES (?, ?)");
  for (let index = 1; index <= 5; index += 1) {
    addGuest.run("Synthetic", `Guest ${index}`);
  }
  const addReservation = client.prepare(`
    INSERT INTO reservations (
      reservation_reference, property_id, guest_id, unit_id, check_in, check_out, lifecycle_status,
      stay_status, actual_check_in_at, actual_check_out_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  addReservation.run("SYN-RES-1", 1, 1, 1, "2030-03-01", "2030-03-04", "confirmed", "not_checked_in", null, null);
  addReservation.run("SYN-RES-2", 1, 2, 1, "2030-03-02", "2030-03-04", "completed", "not_checked_in", null, null);
  addReservation.run("SYN-RES-3", 1, 3, 1, "2030-03-01", "2030-03-04", "cancelled", "not_checked_in", null, null);
  addReservation.run("SYN-RES-4", 2, 4, 5, "2030-03-02", "2030-03-03", "pending", "not_checked_in", null, null);
  client.exec("DROP TRIGGER reservations_insert_guard");
  addReservation.run("SYN-RES-5", 2, 5, null, "2030-03-03", "2030-03-04", "confirmed", "not_checked_in", null, null);

  const today = localDate();
  const tomorrow = addDays(today, 3);
  const yesterday = addDays(today, -1);
  const currentStay = addReservation.run(
    "SYN-RES-CURRENT", 2, 5, 5, yesterday, tomorrow, "confirmed",
    "not_checked_in", null, null,
  );
  client.prepare(`
    UPDATE reservations
    SET stay_status = 'checked_in', actual_check_in_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), Number(currentStay.lastInsertRowid));

  const invoice = client.prepare(`
    INSERT INTO invoices (
      invoice_number, reservation_id, issue_date, currency, status, total_cents,
      subtotal_cents, tax_amount_cents
    ) VALUES (?, ?, ?, ?, 'draft', ?, ?, 0)
  `);
  const addLine = client.prepare(`
    INSERT INTO invoice_line_items (
      invoice_id, description, quantity, unit_price_cents, line_total_cents, position
    ) VALUES (?, 'Synthetic accommodation', 1, ?, ?, 0)
  `);
  const issue = client.prepare(`
    UPDATE invoices SET status = 'issued', issued_at = ?, updated_at = ?
    WHERE id = ?
  `);
  const addIssuedInvoice = (number: string, reservationId: number, date: string, currency: string, amount: number) => {
    const result = invoice.run(number, reservationId, date, currency, amount, amount);
    const id = Number(result.lastInsertRowid);
    addLine.run(id, amount, amount);
    issue.run(`${date}T10:00:00.000Z`, `${date}T10:00:00.000Z`, id);
    return id;
  };
  const partialInvoice = addIssuedInvoice("SYN-INV-1", 1, "2030-03-02", "USD", 10000);
  client.prepare(`
    INSERT INTO payments (invoice_id, payment_date, amount_cents, method, idempotency_key)
    VALUES (?, '2030-03-03', 2500, 'cash', 'synthetic-report-payment-1')
  `).run(partialInvoice);
  const paidInvoice = addIssuedInvoice("SYN-INV-2", 4, "2030-03-03", "EUR", 5000);
  client.prepare(`
    INSERT INTO payments (invoice_id, payment_date, amount_cents, method, idempotency_key)
    VALUES (?, '2030-03-04', 5000, 'bank_transfer', 'synthetic-report-payment-2')
  `).run(paidInvoice);
  invoice.run("SYN-INV-3", 1, "2030-03-02", "USD", 7000, 7000);
  const voidInvoice = addIssuedInvoice("SYN-INV-4", 4, "2030-03-02", "EUR", 2000);
  client.prepare("UPDATE invoices SET status = 'void' WHERE id = ?").run(voidInvoice);
}

function snapshot(): string {
  const tables = ["properties", "units", "guests", "reservations", "invoices", "invoice_line_items", "payments"];
  const counts = tables.map((table) => {
    const row = database.$client.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get();
    return `${table}:${row?.count}`;
  });
  counts.push(`foreignKeys:${database.$client.prepare("PRAGMA foreign_key_check").all().length}`);
  counts.push(`totalChanges:${database.$client.prepare("SELECT total_changes() AS changes").get()?.changes}`);
  return counts.join("|");
}

function localDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}
