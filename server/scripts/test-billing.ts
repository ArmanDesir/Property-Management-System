import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";
import { createTestApiClient } from "./test-api-client.js";

const testDirectory = mkdtempSync(resolve(tmpdir(), "local-pms-billing-test-"));
const database = createDatabase(resolve(testDirectory, "billing-test.sqlite"));
const migrationsFolder = resolve(process.cwd(), "src/db/migrations");
let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;

try {
  await runMigrations(database, migrationsFolder);
  server = createApp(database).listen(0, "127.0.0.1");
  await new Promise<void>((resolveListening, reject) => {
    server?.once("listening", resolveListening);
    server?.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  assert.equal(address.address, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const request = await createTestApiClient(baseUrl);

  const propertyResult = await request("/properties", "POST", {
    name: "Synthetic Billing Property",
    propertyType: "hotel",
    defaultCurrency: "USD",
  });
  assert.equal(propertyResult.status, 201);
  const propertyId = propertyResult.data.property.id as number;

  const unitResult = await request(`/properties/${propertyId}/units`, "POST", {
    name: "B-01",
    capacity: 2,
    baseNightlyRate: 50,
  });
  assert.equal(unitResult.status, 201);
  const unitId = unitResult.data.unit.id as number;

  const guestResult = await request("/guests", "POST", {
    firstName: "Synthetic",
    lastName: "Billing Guest",
    email: "billing@example.test",
  });
  assert.equal(guestResult.status, 201);
  const guestId = guestResult.data.guest.id as number;

  const reservationResult = await request("/reservations", "POST", {
    guestId,
    unitId,
    checkIn: "2031-01-01",
    checkOut: "2031-01-04",
    numberOfGuests: 1,
  });
  assert.equal(reservationResult.status, 201);
  const reservationId = reservationResult.data.reservation.id as number;
  assert.equal(
    database.$client.prepare("SELECT COUNT(*) AS count FROM invoices").get()?.count,
    0,
  );
  assert.equal(
    database.$client.prepare("SELECT COUNT(*) AS count FROM payments").get()?.count,
    0,
  );

  const baseDraft = {
    reservationId,
    issueDate: "2030-01-01",
    dueDate: "2030-01-10",
    taxRate: "10.00",
    notes: "Synthetic invoice note",
    items: [
      { description: "Accommodation", quantity: 2, unitPrice: "10.00" },
      { description: "Additional service", quantity: 1, unitPrice: "5.00" },
    ],
  };
  assert.equal((await request("/invoices", "POST", { ...baseDraft, reservationId: 999999 })).status, 404);
  assert.equal((await request("/invoices", "POST", { ...baseDraft, taxRate: "100.01" })).status, 400);
  assert.equal((await request("/invoices", "POST", {
    ...baseDraft,
    items: [{ description: "Bad precision", quantity: 1, unitPrice: "1.001" }],
  })).status, 400);
  assert.equal((await request("/invoices", "POST", {
    ...baseDraft,
    items: [{ description: "Negative", quantity: 1, unitPrice: "-1.00" }],
  })).status, 400);
  assert.equal((await request("/invoices", "POST", {
    ...baseDraft,
    items: [{ description: "Fractional quantity", quantity: 1.5, unitPrice: "1.00" }],
  })).status, 400);
  assert.equal((await request("/invoices", "POST", {
    ...baseDraft,
    items: [{ description: "Overflow", quantity: 100_000, unitPrice: "999999999999.99" }],
  })).status, 400);
  assert.equal((await request("/invoices", "POST", {
    ...baseDraft,
    dueDate: "2029-12-31",
  })).status, 400);

  const draftResult = await request("/invoices", "POST", baseDraft);
  assert.equal(draftResult.status, 201);
  const invoiceId = draftResult.data.invoice.id as number;
  assert.match(draftResult.data.invoice.invoiceNumber as string, /^INV-2030-[A-F0-9]{12}$/);
  assert.equal(draftResult.data.invoice.status, "draft");
  assert.equal(draftResult.data.invoice.currency, "USD");
  assert.equal(draftResult.data.invoice.subtotalCents, 2500);
  assert.equal(draftResult.data.invoice.taxAmountCents, 250);
  assert.equal(draftResult.data.invoice.totalCents, 2750);
  assert.deepEqual(
    (draftResult.data.invoice.items as Array<Record<string, unknown>>).map((item) => item.lineTotalCents),
    [2000, 500],
  );

  const draftUpdate = await request(`/invoices/${invoiceId}`, "PUT", {
    ...baseDraft,
    items: [{ description: "Updated room charge", quantity: 3, unitPrice: "10.00" }],
  });
  assert.equal(draftUpdate.status, 200);
  assert.equal(draftUpdate.data.invoice.subtotalCents, 3000);
  assert.equal(draftUpdate.data.invoice.totalCents, 3300);
  assert.equal((await request(`/invoices/${invoiceId}/payments`, "POST", {
    paymentDate: "2030-01-02T10:00:00.000Z",
    amount: "1.00",
    method: "cash",
    idempotencyKey: "draft-payment-key-001",
  })).status, 409);

  const emptyDraft = await request("/invoices", "POST", { ...baseDraft, items: [] });
  assert.equal(emptyDraft.status, 201);
  assert.equal((await request(`/invoices/${emptyDraft.data.invoice.id}/issue`, "POST")).status, 409);

  const issueResult = await request(`/invoices/${invoiceId}/issue`, "POST");
  assert.equal(issueResult.status, 200);
  assert.equal(issueResult.data.invoice.status, "issued");
  assert.equal((await request(`/invoices/${invoiceId}`, "PUT", baseDraft)).status, 409);
  assert.equal((await request(`/invoices/${invoiceId}/issue`, "POST")).status, 200);

  const concurrentDrafts = await Promise.all([
    request("/invoices", "POST", baseDraft),
    request("/invoices", "POST", baseDraft),
  ]);
  assert.deepEqual(concurrentDrafts.map((result) => result.status), [201, 201]);
  assert.notEqual(
    concurrentDrafts[0].data.invoice.invoiceNumber,
    concurrentDrafts[1].data.invoice.invoiceNumber,
  );

  const firstPayment = {
    paymentDate: "2030-01-02T10:00:00.000Z",
    amount: "10.00",
    method: "cash",
    reference: "SYN-REF-1",
    note: "Synthetic partial payment",
    idempotencyKey: "payment-key-00000001",
  };
  const partial = await request(`/invoices/${invoiceId}/payments`, "POST", firstPayment);
  assert.equal(partial.status, 201);
  assert.equal(partial.data.invoice.status, "partially_paid");
  assert.equal(partial.data.invoice.paidCents, 1000);
  assert.equal(partial.data.invoice.balanceCents, 2300);
  const duplicate = await request(`/invoices/${invoiceId}/payments`, "POST", firstPayment);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.duplicate, true);
  assert.equal(duplicate.data.invoice.payments.length, 1);
  assert.equal((await request(`/invoices/${invoiceId}/payments`, "POST", {
    ...firstPayment,
    amount: "9.00",
  })).status, 409);
  assert.equal((await request(`/invoices/${invoiceId}/payments`, "POST", {
    ...firstPayment,
    idempotencyKey: "payment-key-00000002",
    amount: "100.00",
  })).status, 409);
  for (const amount of ["0", "-1.00", "1.001"]) {
    assert.equal((await request(`/invoices/${invoiceId}/payments`, "POST", {
      ...firstPayment,
      idempotencyKey: `invalid-${amount}`,
      amount,
    })).status, 400);
  }
  assert.equal((await request(`/invoices/${invoiceId}/void`, "POST")).status, 409);

  let paymentRace = await request("/invoices", "POST", {
    ...baseDraft,
    items: [{ description: "Race test charge", quantity: 1, unitPrice: "100.00" }],
    taxRate: "0",
  });
  const raceInvoiceId = paymentRace.data.invoice.id as number;
  assert.equal((await request(`/invoices/${raceInvoiceId}/issue`, "POST")).status, 200);
  const racePayments = await Promise.all([
    request(`/invoices/${raceInvoiceId}/payments`, "POST", {
      paymentDate: "2030-01-03T10:00:00.000Z",
      amount: "70.00",
      method: "bank_transfer",
      idempotencyKey: "race-payment-key-000001",
    }),
    request(`/invoices/${raceInvoiceId}/payments`, "POST", {
      paymentDate: "2030-01-03T10:00:00.000Z",
      amount: "70.00",
      method: "bank_transfer",
      idempotencyKey: "race-payment-key-000002",
    }),
  ]);
  assert.deepEqual(racePayments.map((result) => result.status).sort(), [201, 409]);
  paymentRace = await request(`/invoices/${raceInvoiceId}`);
  assert.equal(paymentRace.data.invoice.paidCents, 7000);
  assert.equal(paymentRace.data.invoice.balanceCents, 3000);
  assert.equal(paymentRace.data.invoice.status, "partially_paid");

  const voidable = await request("/invoices", "POST", {
    ...baseDraft,
    items: [{ description: "Void test", quantity: 1, unitPrice: "1.00" }],
    taxRate: "0",
  });
  assert.equal((await request(`/invoices/${voidable.data.invoice.id}/issue`, "POST")).status, 200);
  const voidResult = await request(`/invoices/${voidable.data.invoice.id}/void`, "POST");
  assert.equal(voidResult.status, 200);
  assert.equal(voidResult.data.invoice.status, "void");
  assert.equal((await request(`/invoices/${voidable.data.invoice.id}/payments`, "POST", {
    ...firstPayment,
    amount: "0.50",
    idempotencyKey: "void-payment-key-000001",
  })).status, 409);

  const rounded = await request("/invoices", "POST", {
    ...baseDraft,
    items: [{ description: "Rounding test", quantity: 1, unitPrice: "0.05" }],
    taxRate: "10",
  });
  assert.equal(rounded.data.invoice.subtotalCents, 5);
  assert.equal(rounded.data.invoice.taxAmountCents, 1);
  assert.equal(rounded.data.invoice.totalCents, 6);

  const issuedBeforeReservationEdit = await request(`/invoices/${invoiceId}`);
  const reservationEdit = await request(`/reservations/${reservationId}`, "PUT", {
    guestId,
    unitId,
    checkIn: "2031-01-01",
    checkOut: "2031-01-04",
    numberOfGuests: 1,
    nightlyRate: 60,
    notes: null,
  });
  assert.equal(reservationEdit.status, 200);
  const issuedAfterReservationEdit = await request(`/invoices/${invoiceId}`);
  assert.equal(
    issuedAfterReservationEdit.data.invoice.totalCents,
    issuedBeforeReservationEdit.data.invoice.totalCents,
  );

  const fullPayment = await request(`/invoices/${invoiceId}/payments`, "POST", {
    ...firstPayment,
    amount: "23.00",
    reference: "SYN-REF-2",
    idempotencyKey: "payment-key-00000003",
  });
  assert.equal(fullPayment.status, 201);
  assert.equal(fullPayment.data.invoice.status, "paid");
  assert.equal(fullPayment.data.invoice.balanceCents, 0);
  assert.equal((await request(`/invoices/${invoiceId}/void`, "POST")).status, 409);
  assert.throws(() => {
    database.$client.prepare("UPDATE invoices SET total_cents = 1 WHERE id = ?").run(invoiceId);
  });
  assert.throws(() => {
    database.$client.prepare("UPDATE invoices SET status = 'paid' WHERE id = ?").run(invoiceId);
  });
  assert.throws(() => {
    database.$client.prepare("UPDATE invoice_line_items SET description = 'Changed' WHERE invoice_id = ?").run(invoiceId);
  });
  assert.throws(() => {
    database.$client.prepare("UPDATE payments SET amount_cents = 1 WHERE invoice_id = ?").run(invoiceId);
  });
  assert.throws(() => {
    database.$client.prepare("DELETE FROM payments WHERE invoice_id = ?").run(invoiceId);
  });

  const list = await request("/invoices?status=paid&q=INV-2030");
  assert.equal(list.status, 200);
  assert.ok((list.data.invoices as Array<Record<string, unknown>>).some((item) => item.id === invoiceId));
  assert.equal((await request(`/invoices?reservationId=${reservationId}`)).status, 200);
  assert.equal((await request("/invoices?status=unknown")).status, 400);
  assert.equal((await request("/invoices/not-an-id")).status, 400);
  assert.equal((await request("/invoices/999999")).status, 404);
  assert.deepEqual(database.$client.prepare("PRAGMA foreign_key_check").all(), []);

  console.log("Invoice, tax, payment, idempotency, lifecycle, reservation snapshot, and concurrency API tests passed.");
} finally {
  if (server?.listening) {
    await new Promise<void>((resolveClose, reject) => {
      server?.close((error) => error ? reject(error) : resolveClose());
    });
  }
  database.$client.close();
  rmSync(testDirectory, { recursive: true, force: true });
}
