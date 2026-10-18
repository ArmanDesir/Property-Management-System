import { randomUUID } from "node:crypto";
import type { PmsDatabase } from "../db/connection.js";
import { HttpError } from "../middleware/http-errors.js";
import { withImmediateTransaction } from "./reservations.js";

export type InvoiceStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "void";

export type PaymentMethod = "cash" | "bank_transfer" | "card_terminal" | "other";

export interface InvoiceLineDraft {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export interface InvoiceDraft {
  reservationId: number;
  issueDate: string;
  dueDate: string | null;
  taxRateBps: number;
  notes: string | null;
  items: InvoiceLineDraft[];
}

export interface InvoiceSummary {
  id: number;
  invoiceNumber: string;
  reservationId: number;
  reservationReference: string;
  guestId: number;
  guestName: string;
  propertyName: string;
  unitName: string | null;
  checkIn: string;
  checkOut: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  status: InvoiceStatus;
  taxRateBps: number;
  subtotalCents: number;
  taxAmountCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  notes: string | null;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLineItem extends InvoiceLineDraft {
  id: number;
  lineTotalCents: number;
  position: number;
}

export interface InvoicePayment {
  id: number;
  paymentDate: string;
  amountCents: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

export interface InvoiceRecord extends InvoiceSummary {
  items: InvoiceLineItem[];
  payments: InvoicePayment[];
}

export interface InvoiceFilters {
  status: InvoiceStatus | "all";
  search: string;
  reservationId: number | null;
  limit: number;
  offset: number;
}

export interface PaymentDraft {
  paymentDate: string;
  amountCents: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  idempotencyKey: string;
}

const invoiceSelect = `
  SELECT i.id, i.invoice_number, i.reservation_id, r.reservation_reference,
    r.guest_id, g.first_name || ' ' || g.last_name AS guest_name,
    p.name AS property_name, u.name AS unit_name, r.check_in, r.check_out,
    i.issue_date, i.due_date, i.currency, i.status, i.tax_rate_bps,
    i.subtotal_cents, i.tax_amount_cents, i.total_cents, i.notes,
    i.issued_at, i.created_at, i.updated_at,
    COALESCE((SELECT SUM(pay.amount_cents) FROM payments pay WHERE pay.invoice_id = i.id), 0) AS paid_cents,
    CASE
      WHEN i.status = 'draft' THEN 'draft'
      WHEN i.status = 'void' THEN 'void'
      WHEN COALESCE((SELECT SUM(pay.amount_cents) FROM payments pay WHERE pay.invoice_id = i.id), 0) = 0 THEN 'issued'
      WHEN COALESCE((SELECT SUM(pay.amount_cents) FROM payments pay WHERE pay.invoice_id = i.id), 0) >= i.total_cents
        AND i.total_cents > 0 THEN 'paid'
      ELSE 'partially_paid'
    END AS display_status
  FROM invoices i
  JOIN reservations r ON r.id = i.reservation_id
  JOIN guests g ON g.id = r.guest_id
  JOIN properties p ON p.id = r.property_id
  LEFT JOIN units u ON u.id = r.unit_id`;

export function listInvoiceReservations(database: PmsDatabase, search: string) {
  const pattern = `%${search}%`;
  const rows = database.$client.prepare(`
    SELECT r.id, r.reservation_reference, r.guest_id,
      g.first_name || ' ' || g.last_name AS guest_name,
      p.name AS property_name, u.name AS unit_name, r.check_in, r.check_out,
      r.currency, r.total_amount_cents, r.lifecycle_status
    FROM reservations r
    JOIN guests g ON g.id = r.guest_id
    JOIN properties p ON p.id = r.property_id
    LEFT JOIN units u ON u.id = r.unit_id
    WHERE ? = '%%'
      OR r.reservation_reference LIKE ?
      OR g.first_name || ' ' || g.last_name LIKE ?
      OR p.name LIKE ?
      OR COALESCE(u.name, '') LIKE ?
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT 100
  `).all(pattern, pattern, pattern, pattern, pattern);

  return rows.map(toReservationChoice);
}

export function getInvoiceReservation(database: PmsDatabase, id: number) {
  const row = database.$client.prepare(`
    SELECT r.id, r.reservation_reference, r.guest_id,
      g.first_name || ' ' || g.last_name AS guest_name,
      p.name AS property_name, u.name AS unit_name, r.check_in, r.check_out,
      r.currency, r.total_amount_cents, r.lifecycle_status
    FROM reservations r
    JOIN guests g ON g.id = r.guest_id
    JOIN properties p ON p.id = r.property_id
    LEFT JOIN units u ON u.id = r.unit_id
    WHERE r.id = ?
  `).get(id);
  if (!row) throw new HttpError(404, "Reservation not found.");
  return toReservationChoice(row);
}

export function listInvoices(database: PmsDatabase, filters: InvoiceFilters) {
  const conditions: string[] = [];
  const parameters: Array<string | number> = [];
  if (filters.status !== "all") {
    conditions.push("display_status = ?");
    parameters.push(filters.status);
  }
  if (filters.reservationId !== null) {
    conditions.push("i.reservation_id = ?");
    parameters.push(filters.reservationId);
  }
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    conditions.push(`(
      i.invoice_number LIKE ? OR r.reservation_reference LIKE ? OR
      g.first_name || ' ' || g.last_name LIKE ? OR p.name LIKE ?
    )`);
    parameters.push(pattern, pattern, pattern, pattern);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const count = database.$client.prepare(`
    SELECT COUNT(*) AS count
    FROM (${invoiceSelect}) AS invoice_rows
    JOIN invoices i ON i.id = invoice_rows.id
    JOIN reservations r ON r.id = i.reservation_id
    JOIN guests g ON g.id = r.guest_id
    JOIN properties p ON p.id = r.property_id${where}
  `).get(...parameters);
  const invoices = database.$client.prepare(`
    ${invoiceSelect}${where}
    ORDER BY i.issue_date DESC, i.id DESC
    LIMIT ? OFFSET ?
  `).all(...parameters, filters.limit, filters.offset);
  return {
    invoices: invoices.map(toInvoiceSummary),
    total: integerValue(count?.count),
    limit: filters.limit,
    offset: filters.offset,
  };
}

export function getInvoice(database: PmsDatabase, id: number): InvoiceRecord {
  const row = database.$client.prepare(`${invoiceSelect} WHERE i.id = ?`).get(id);
  if (!row) throw new HttpError(404, "Invoice not found.");
  const items = database.$client.prepare(`
    SELECT id, description, quantity, unit_price_cents, line_total_cents, position
    FROM invoice_line_items WHERE invoice_id = ? ORDER BY position, id
  `).all(id);
  const payments = database.$client.prepare(`
    SELECT id, payment_date, amount_cents, method, reference, note, created_at
    FROM payments WHERE invoice_id = ? ORDER BY payment_date, id
  `).all(id);
  return {
    ...toInvoiceSummary(row),
    items: items.map((item) => ({
      id: integerValue(item.id),
      description: textValue(item.description),
      quantity: integerValue(item.quantity),
      unitPriceCents: integerValue(item.unit_price_cents),
      lineTotalCents: integerValue(item.line_total_cents),
      position: integerValue(item.position),
    })),
    payments: payments.map((payment) => ({
      id: integerValue(payment.id),
      paymentDate: textValue(payment.payment_date),
      amountCents: integerValue(payment.amount_cents),
      method: textValue(payment.method) as PaymentMethod,
      reference: nullableTextValue(payment.reference),
      note: nullableTextValue(payment.note),
      createdAt: textValue(payment.created_at),
    })),
  };
}

export function createInvoice(database: PmsDatabase, draft: InvoiceDraft): InvoiceRecord {
  return withImmediateTransaction(database, (client) => {
    const reservation = findReservation(client, draft.reservationId);
    if (!reservation) throw new HttpError(404, "Reservation not found.");
    const totals = calculateInvoiceTotals(draft.items, draft.taxRateBps);
    const now = new Date().toISOString();
    const invoiceNumber =
      `INV-${draft.issueDate.slice(0, 4)}-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    const result = client.prepare(`
      INSERT INTO invoices (
        invoice_number, reservation_id, issue_date, due_date, currency, status,
        tax_rate_bps, subtotal_cents, tax_amount_cents, total_cents, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invoiceNumber,
      draft.reservationId,
      draft.issueDate,
      draft.dueDate,
      textValue(reservation.currency),
      draft.taxRateBps,
      totals.subtotalCents,
      totals.taxAmountCents,
      totals.totalCents,
      draft.notes,
      now,
      now,
    );
    const id = integerValue(result.lastInsertRowid);
    insertInvoiceItems(client, id, totals.items);
    return getInvoice(database, id);
  });
}

export function updateDraftInvoice(
  database: PmsDatabase,
  id: number,
  draft: InvoiceDraft,
): InvoiceRecord {
  return withImmediateTransaction(database, (client) => {
    const invoice = client.prepare("SELECT status FROM invoices WHERE id = ?").get(id);
    if (!invoice) throw new HttpError(404, "Invoice not found.");
    if (textValue(invoice.status) !== "draft") {
      throw new HttpError(409, "Only draft invoices can be edited.");
    }
    const reservation = findReservation(client, draft.reservationId);
    if (!reservation) throw new HttpError(404, "Reservation not found.");
    const totals = calculateInvoiceTotals(draft.items, draft.taxRateBps);
    client.prepare("DELETE FROM invoice_line_items WHERE invoice_id = ?").run(id);
    insertInvoiceItems(client, id, totals.items);
    client.prepare(`
      UPDATE invoices SET reservation_id = ?, issue_date = ?, due_date = ?,
        currency = ?, tax_rate_bps = ?, subtotal_cents = ?, tax_amount_cents = ?,
        total_cents = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(
      draft.reservationId,
      draft.issueDate,
      draft.dueDate,
      textValue(reservation.currency),
      draft.taxRateBps,
      totals.subtotalCents,
      totals.taxAmountCents,
      totals.totalCents,
      draft.notes,
      new Date().toISOString(),
      id,
    );
    return getInvoice(database, id);
  });
}

export function issueInvoice(database: PmsDatabase, id: number): InvoiceRecord {
  return withImmediateTransaction(database, (client) => {
    const invoice = client.prepare("SELECT status FROM invoices WHERE id = ?").get(id);
    if (!invoice) throw new HttpError(404, "Invoice not found.");
    const status = textValue(invoice.status);
    if (status === "issued") return getInvoice(database, id);
    if (status !== "draft") throw new HttpError(409, "Only draft invoices can be issued.");
    const items = client.prepare(`
      SELECT description, quantity, unit_price_cents
      FROM invoice_line_items WHERE invoice_id = ? ORDER BY position, id
    `).all(id).map((item) => ({
      description: textValue(item.description),
      quantity: integerValue(item.quantity),
      unitPriceCents: integerValue(item.unit_price_cents),
    }));
    if (items.length === 0) throw new HttpError(409, "Add at least one line item before issuing this invoice.");
    const totals = calculateInvoiceTotals(items, integerValue(
      client.prepare("SELECT tax_rate_bps FROM invoices WHERE id = ?").get(id)?.tax_rate_bps,
    ));
    const now = new Date().toISOString();
    for (const item of totals.items) {
      client.prepare(`
        UPDATE invoice_line_items SET line_total_cents = ?
        WHERE invoice_id = ? AND position = ?
      `).run(item.lineTotalCents, id, item.position);
    }
    client.prepare(`
      UPDATE invoices SET status = 'issued', subtotal_cents = ?,
        tax_amount_cents = ?, total_cents = ?, issued_at = ?, updated_at = ?
      WHERE id = ?
    `).run(totals.subtotalCents, totals.taxAmountCents, totals.totalCents, now, now, id);
    return getInvoice(database, id);
  });
}

export function voidInvoice(database: PmsDatabase, id: number): InvoiceRecord {
  return withImmediateTransaction(database, (client) => {
    const invoice = client.prepare("SELECT status FROM invoices WHERE id = ?").get(id);
    if (!invoice) throw new HttpError(404, "Invoice not found.");
    const status = textValue(invoice.status);
    if (status === "void") return getInvoice(database, id);
    if (status !== "issued") throw new HttpError(409, "Only unpaid issued invoices can be voided.");
    const payments = integerValue(
      client.prepare("SELECT COUNT(*) AS count FROM payments WHERE invoice_id = ?").get(id)?.count,
    );
    if (payments > 0) {
      throw new HttpError(409, "Invoices with recorded payments cannot be voided; refunds and reversals are not supported.");
    }
    client.prepare("UPDATE invoices SET status = 'void', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    return getInvoice(database, id);
  });
}

export function recordPayment(
  database: PmsDatabase,
  invoiceId: number,
  draft: PaymentDraft,
): { invoice: InvoiceRecord; payment: InvoicePayment; duplicate: boolean } {
  return withImmediateTransaction(database, (client) => {
    const existingPayment = client.prepare(`
      SELECT id, invoice_id, payment_date, amount_cents, method, reference, note, created_at
      FROM payments WHERE idempotency_key = ?
    `).get(draft.idempotencyKey);
    if (existingPayment) {
      const sameRequest =
        integerValue(existingPayment.invoice_id) === invoiceId &&
        textValue(existingPayment.payment_date) === draft.paymentDate &&
        integerValue(existingPayment.amount_cents) === draft.amountCents &&
        textValue(existingPayment.method) === draft.method &&
        nullableTextValue(existingPayment.reference) === draft.reference &&
        nullableTextValue(existingPayment.note) === draft.note;
      if (!sameRequest) {
        throw new HttpError(409, "This payment submission key was already used for different details.");
      }
      return {
        invoice: getInvoice(database, invoiceId),
        payment: toPayment(existingPayment),
        duplicate: true,
      };
    }

    const invoice = client.prepare("SELECT status, total_cents FROM invoices WHERE id = ?").get(invoiceId);
    if (!invoice) throw new HttpError(404, "Invoice not found.");
    if (textValue(invoice.status) !== "issued") {
      throw new HttpError(409, "Payments can only be recorded against issued, non-void invoices.");
    }
    const paidCents = integerValue(
      client.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS paid FROM payments WHERE invoice_id = ?")
        .get(invoiceId)?.paid,
    );
    const outstanding = integerValue(invoice.total_cents) - paidCents;
    if (draft.amountCents > outstanding) {
      throw new HttpError(409, "Payment amount exceeds the invoice’s outstanding balance.");
    }
    const result = client.prepare(`
      INSERT INTO payments (
        invoice_id, payment_date, amount_cents, method, reference, note,
        idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      invoiceId,
      draft.paymentDate,
      draft.amountCents,
      draft.method,
      draft.reference,
      draft.note,
      draft.idempotencyKey,
    );
    const paymentId = integerValue(result.lastInsertRowid);
    const row = client.prepare(`
      SELECT id, invoice_id, payment_date, amount_cents, method, reference, note, created_at
      FROM payments WHERE id = ?
    `).get(paymentId);
    if (!row) throw new Error("Inserted payment could not be read back.");
    return {
      invoice: getInvoice(database, invoiceId),
      payment: toPayment(row),
      duplicate: false,
    };
  });
}

export function calculateInvoiceTotals(
  items: InvoiceLineDraft[],
  taxRateBps: number,
): { items: Array<InvoiceLineItemDraft & { position: number; lineTotalCents: number }>;
  subtotalCents: number; taxAmountCents: number; totalCents: number } {
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10_000) {
    throw new HttpError(400, "Tax rate must be between 0 and 100 percent.");
  }
  if (items.length > 100) throw new HttpError(400, "An invoice can have at most 100 line items.");
  let subtotal = 0n;
  const calculatedItems = items.map((item, position) => {
    if (
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 100_000
    ) {
      throw new HttpError(400, "Line item quantity must be a whole number from 1 to 100000.");
    }
    if (!Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
      throw new HttpError(400, "Line item unit price must be a valid non-negative amount.");
    }
    const lineTotal = BigInt(item.unitPriceCents) * BigInt(item.quantity);
    if (lineTotal > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new HttpError(400, "Line item total exceeds the supported amount.");
    }
    subtotal += lineTotal;
    if (subtotal > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new HttpError(400, "Invoice subtotal exceeds the supported amount.");
    }
    return {
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      position,
      lineTotalCents: Number(lineTotal),
    };
  });
  const tax = (subtotal * BigInt(taxRateBps) + 5_000n) / 10_000n;
  const total = subtotal + tax;
  if (tax > BigInt(Number.MAX_SAFE_INTEGER) || total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new HttpError(400, "Invoice total exceeds the supported amount.");
  }
  return {
    items: calculatedItems,
    subtotalCents: Number(subtotal),
    taxAmountCents: Number(tax),
    totalCents: Number(total),
  };
}

interface InvoiceLineItemDraft extends InvoiceLineDraft {
  position: number;
  lineTotalCents: number;
}

function insertInvoiceItems(
  client: PmsDatabase["$client"],
  invoiceId: number,
  items: InvoiceLineItemDraft[],
): void {
  const insert = client.prepare(`
    INSERT INTO invoice_line_items (
      invoice_id, description, quantity, unit_price_cents, line_total_cents, position
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const item of items) {
    insert.run(
      invoiceId,
      item.description,
      item.quantity,
      item.unitPriceCents,
      item.lineTotalCents,
      item.position,
    );
  }
}

function findReservation(client: PmsDatabase["$client"], id: number) {
  return client.prepare("SELECT currency FROM reservations WHERE id = ?").get(id);
}

function toInvoiceSummary(row: Record<string, unknown>): InvoiceSummary {
  const status = textValue(row.display_status) as InvoiceStatus;
  const totalCents = integerValue(row.total_cents);
  const paidCents = integerValue(row.paid_cents);
  return {
    id: integerValue(row.id),
    invoiceNumber: textValue(row.invoice_number),
    reservationId: integerValue(row.reservation_id),
    reservationReference: textValue(row.reservation_reference),
    guestId: integerValue(row.guest_id),
    guestName: textValue(row.guest_name),
    propertyName: textValue(row.property_name),
    unitName: nullableTextValue(row.unit_name),
    checkIn: textValue(row.check_in),
    checkOut: textValue(row.check_out),
    issueDate: textValue(row.issue_date),
    dueDate: nullableTextValue(row.due_date),
    currency: textValue(row.currency),
    status,
    taxRateBps: integerValue(row.tax_rate_bps),
    subtotalCents: integerValue(row.subtotal_cents),
    taxAmountCents: integerValue(row.tax_amount_cents),
    totalCents,
    paidCents,
    balanceCents: status === "void" ? 0 : Math.max(0, totalCents - paidCents),
    notes: nullableTextValue(row.notes),
    issuedAt: nullableTextValue(row.issued_at),
    createdAt: textValue(row.created_at),
    updatedAt: textValue(row.updated_at),
  };
}

function toReservationChoice(row: Record<string, unknown>) {
  return {
    id: integerValue(row.id),
    reservationReference: textValue(row.reservation_reference),
    guestId: integerValue(row.guest_id),
    guestName: textValue(row.guest_name),
    propertyName: textValue(row.property_name),
    unitName: nullableTextValue(row.unit_name),
    checkIn: textValue(row.check_in),
    checkOut: textValue(row.check_out),
    currency: textValue(row.currency),
    totalAmountCents: integerValue(row.total_amount_cents),
    status: textValue(row.lifecycle_status),
  };
}

function toPayment(row: Record<string, unknown>): InvoicePayment {
  return {
    id: integerValue(row.id),
    paymentDate: textValue(row.payment_date),
    amountCents: integerValue(row.amount_cents),
    method: textValue(row.method) as PaymentMethod,
    reference: nullableTextValue(row.reference),
    note: nullableTextValue(row.note),
    createdAt: textValue(row.created_at),
  };
}

function textValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("Database returned an invalid text value.");
  return value;
}

function nullableTextValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return textValue(value);
}

function integerValue(value: unknown): number {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number)) {
    throw new Error("Database returned an invalid integer value.");
  }
  return number;
}
