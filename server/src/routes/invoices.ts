import { Router } from "express";
import type { PmsDatabase } from "../db/connection.js";
import { asyncHandler, HttpError } from "../middleware/http-errors.js";
import {
  enumValue,
  optionalText,
  parseRecordId,
  positiveInteger,
  requiredText,
  requireObject,
} from "../services/validation.js";
import {
  createInvoice,
  getInvoiceReservation,
  getInvoice,
  issueInvoice,
  listInvoiceReservations,
  listInvoices,
  recordPayment,
  updateDraftInvoice,
  voidInvoice,
  type InvoiceDraft,
  type InvoiceStatus,
  type PaymentMethod,
} from "../services/billing.js";

const invoiceStatuses = ["draft", "issued", "partially_paid", "paid", "void"] as const;
const paymentMethods = ["cash", "bank_transfer", "card_terminal", "other"] as const;

export function createInvoicesRouter(database: PmsDatabase): Router {
  const router = Router();

  router.get(
    "/reservations",
    asyncHandler(async (request, response) => {
      response.json({ reservations: listInvoiceReservations(database, queryText(request.query.q)) });
    }),
  );

  router.get(
    "/reservations/:reservationId",
    asyncHandler(async (request, response) => {
      response.json({
        reservation: getInvoiceReservation(database, parseRecordId(request.params.reservationId)),
      });
    }),
  );

  router.get(
    "/",
    asyncHandler(async (request, response) => {
      const status = request.query.status === undefined
        ? "all"
        : enumValue(request.query.status, "Status", [...invoiceStatuses, "all"] as const);
      const reservationId = request.query.reservationId === undefined
        ? null
        : parseRecordId(singleQuery(request.query.reservationId, "Reservation ID"));
      response.json({
        ...listInvoices(database, {
          status: status as InvoiceStatus | "all",
          search: queryText(request.query.q),
          reservationId,
          limit: queryInteger(request.query.limit, "Limit", 50, 1, 200),
          offset: queryInteger(request.query.offset, "Offset", 0, 0, 1_000_000),
        }),
      });
    }),
  );

  router.post(
    "/",
    asyncHandler(async (request, response) => {
      const draft = parseInvoiceDraft(request.body);
      response.status(201).json({ invoice: createInvoice(database, draft) });
    }),
  );

  router.get(
    "/:invoiceId",
    asyncHandler(async (request, response) => {
      response.json({ invoice: getInvoice(database, parseRecordId(request.params.invoiceId)) });
    }),
  );

  router.put(
    "/:invoiceId",
    asyncHandler(async (request, response) => {
      const id = parseRecordId(request.params.invoiceId);
      response.json({ invoice: updateDraftInvoice(database, id, parseInvoiceDraft(request.body)) });
    }),
  );

  router.post(
    "/:invoiceId/issue",
    asyncHandler(async (request, response) => {
      response.json({ invoice: issueInvoice(database, parseRecordId(request.params.invoiceId)) });
    }),
  );

  router.post(
    "/:invoiceId/void",
    asyncHandler(async (request, response) => {
      response.json({ invoice: voidInvoice(database, parseRecordId(request.params.invoiceId)) });
    }),
  );

  router.post(
    "/:invoiceId/payments",
    asyncHandler(async (request, response) => {
      const id = parseRecordId(request.params.invoiceId);
      const payment = parsePayment(request.body);
      const result = recordPayment(database, id, payment);
      response.status(result.duplicate ? 200 : 201).json(result);
    }),
  );

  return router;
}

function parseInvoiceDraft(value: unknown): InvoiceDraft {
  const body = requireObject(value);
  rejectFields(body, new Set([
    "reservationId",
    "issueDate",
    "dueDate",
    "taxRate",
    "notes",
    "items",
  ]));
  if (!("reservationId" in body) || !("issueDate" in body) || !("items" in body)) {
    throw new HttpError(400, "Reservation, issue date, and line items are required.");
  }
  const issueDate = isoDate(body.issueDate, "Issue date");
  const dueDate = body.dueDate === undefined || body.dueDate === null || body.dueDate === ""
    ? null
    : isoDate(body.dueDate, "Due date");
  if (dueDate !== null && dueDate < issueDate) {
    throw new HttpError(400, "Due date cannot be before the issue date.");
  }
  if (!Array.isArray(body.items)) throw new HttpError(400, "Line items must be an array.");
  const items = body.items.map((value, index) => {
    const item = requireObject(value);
    rejectFields(item, new Set(["description", "quantity", "unitPrice"]));
    return {
      description: requiredText(item.description, `Line item ${index + 1} description`, 250),
      quantity: positiveInteger(item.quantity, `Line item ${index + 1} quantity`, 100_000),
      unitPriceCents: amountToCents(item.unitPrice, `Line item ${index + 1} unit price`),
    };
  });
  return {
    reservationId: positiveInteger(body.reservationId, "Reservation ID", Number.MAX_SAFE_INTEGER),
    issueDate,
    dueDate,
    taxRateBps: taxRateToBasisPoints(body.taxRate ?? "0"),
    notes: optionalText(body.notes, "Invoice notes", 2000),
    items,
  };
}

function parsePayment(value: unknown) {
  const body = requireObject(value);
  rejectFields(body, new Set([
    "paymentDate",
    "amount",
    "method",
    "reference",
    "note",
    "idempotencyKey",
  ]));
  const amountCents = amountToCents(body.amount, "Payment amount");
  if (amountCents <= 0) throw new HttpError(400, "Payment amount must be greater than zero.");
  const idempotencyKey = requiredText(body.idempotencyKey, "Payment submission key", 128);
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    throw new HttpError(400, "Payment submission key must contain 8 to 128 safe characters.");
  }
  return {
    paymentDate: isoTimestamp(body.paymentDate),
    amountCents,
    method: enumValue(body.method, "Payment method", paymentMethods) as PaymentMethod,
    reference: optionalText(body.reference, "Payment reference", 120),
    note: optionalText(body.note, "Payment note", 500),
    idempotencyKey,
  };
}

function amountToCents(value: unknown, field: string): number {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)) {
    throw new HttpError(400, `${field} must be a non-negative amount with at most two decimal places.`);
  }
  const [whole, fraction = ""] = value.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new HttpError(400, `${field} exceeds the supported amount.`);
  }
  return Number(cents);
}

function taxRateToBasisPoints(value: unknown): number {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d?)(?:\.\d{1,2})?$|^100(?:\.0{1,2})?$/.test(value)) {
    throw new HttpError(400, "Tax rate must be between 0 and 100 percent with at most two decimal places.");
  }
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function isoDate(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith("0000-")
  ) {
    throw new HttpError(400, `${field} must be a valid date in YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${field} must be a valid calendar date.`);
  }
  return value;
}

function isoTimestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new HttpError(400, "Payment date must be an ISO timestamp in UTC.");
  }
  const timestamp = new Date(value);
  if (
    Number.isNaN(timestamp.valueOf()) ||
    timestamp.toISOString().slice(0, 19) !== value.slice(0, 19)
  ) {
    throw new HttpError(400, "Payment date must be a valid timestamp.");
  }
  return timestamp.toISOString();
}

function queryText(value: unknown): string {
  if (value === undefined) return "";
  const text = singleQuery(value, "Search query").trim();
  if (text.length > 120) throw new HttpError(400, "Search query must be 120 characters or fewer.");
  return text;
}

function queryInteger(
  value: unknown,
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  const text = singleQuery(value, field);
  if (!/^\d+$/.test(text)) throw new HttpError(400, `${field} must be a whole number.`);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new HttpError(400, `${field} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function singleQuery(value: unknown, field: string): string {
  if (typeof value !== "string") throw new HttpError(400, `${field} must be supplied once.`);
  return value;
}

function rejectFields(body: Record<string, unknown>, supported: ReadonlySet<string>): void {
  const unsupported = Object.keys(body).find((field) => !supported.has(field));
  if (unsupported) throw new HttpError(400, `Unsupported invoice field: ${unsupported}.`);
}
