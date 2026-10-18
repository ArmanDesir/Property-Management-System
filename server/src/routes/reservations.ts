import { Router } from "express";
import type { PmsDatabase } from "../db/connection.js";
import { asyncHandler, HttpError } from "../middleware/http-errors.js";
import {
  enumValue,
  optionalText,
  parseRecordId,
  positiveInteger,
  rateToCents,
  requireObject,
} from "../services/validation.js";
import {
  createReservation,
  getAvailabilityQuote,
  getReservation,
  listReservations,
  nightsBetween,
  transitionReservation,
  updateReservation,
  type ReservationDraft,
  type ReservationStatus,
  type ReservationStatusFilter,
} from "../services/reservations.js";
import {
  checkInReservation,
  checkOutReservation,
} from "../services/front-desk.js";

const reservationStatuses = ["pending", "confirmed", "cancelled", "completed"] as const;
const editableFields = new Set([
  "guestId",
  "unitId",
  "checkIn",
  "checkOut",
  "numberOfGuests",
  "nightlyRate",
  "notes",
]);

export function createReservationsRouter(database: PmsDatabase): Router {
  const router = Router();

  router.get(
    "/availability",
    asyncHandler(async (request, response) => {
      const unitId = parseRecordId(singleQuery(request.query.unitId, "Unit ID"));
      const dates = parseDateRange(request.query.checkIn, request.query.checkOut);
      const numberOfGuests = positiveInteger(
        queryNumber(request.query.numberOfGuests, "Number of guests"),
        "Number of guests",
        1000,
      );
      const rate = request.query.nightlyRate === undefined
        ? null
        : rateToCents(queryNumber(request.query.nightlyRate, "Nightly rate"));
      const excludeReservationId = request.query.excludeReservationId === undefined
        ? null
        : parseRecordId(singleQuery(request.query.excludeReservationId, "Reservation ID"));

      const quote = getAvailabilityQuote(
        database,
        {
          unitId,
          checkIn: dates.checkIn,
          checkOut: dates.checkOut,
          numberOfGuests,
          nightlyRateCents: rate,
        },
        dates.nights,
        excludeReservationId,
      );
      response.json({ availability: quote });
    }),
  );

  router.get(
    "/",
    asyncHandler(async (request, response) => {
      response.json({
        ...listReservations(database, parseFilters(request.query)),
      });
    }),
  );

  router.post(
    "/",
    asyncHandler(async (request, response) => {
      const draft = parseDraft(request.body);
      const dates = parseDateRange(draft.checkIn, draft.checkOut);
      const reservation = createReservation(database, draft, dates.nights);
      response.status(201).json({ reservation });
    }),
  );

  router.get(
    "/:reservationId",
    asyncHandler(async (request, response) => {
      const id = parseRecordId(request.params.reservationId);
      response.json({ reservation: getReservation(database, id) });
    }),
  );

  router.put(
    "/:reservationId",
    asyncHandler(async (request, response) => {
      const id = parseRecordId(request.params.reservationId);
      const draft = parseDraft(request.body);
      const dates = parseDateRange(draft.checkIn, draft.checkOut);
      response.json({
        reservation: updateReservation(database, id, draft, dates.nights),
      });
    }),
  );

  router.patch(
    "/:reservationId/status",
    asyncHandler(async (request, response) => {
      const id = parseRecordId(request.params.reservationId);
      const body = requireObject(request.body);
      if (Object.keys(body).some((field) => field !== "status")) {
        throw new HttpError(400, "Only the reservation status can be changed here.");
      }
      const status = enumValue(
        body.status,
        "Status",
        ["confirmed", "cancelled", "completed"] as const,
      );
      response.json({ reservation: transitionReservation(database, id, status) });
    }),
  );

  router.delete(
    "/:reservationId",
    asyncHandler(async (request, response) => {
      const id = parseRecordId(request.params.reservationId);
      response.json({
        reservation: transitionReservation(database, id, "cancelled"),
      });
    }),
  );

  router.post(
    "/:reservationId/check-in",
    asyncHandler(async (request, response) => {
      const id = parseRecordId(request.params.reservationId);
      const reservation = checkInReservation(database, id);
      response.json({ message: "Guest checked in successfully.", reservation });
    }),
  );

  router.post(
    "/:reservationId/check-out",
    asyncHandler(async (request, response) => {
      const id = parseRecordId(request.params.reservationId);
      const reservation = checkOutReservation(database, id);
      response.json({
        message: "Guest checked out. The unit remains in its current operational status.",
        reservation,
      });
    }),
  );

  return router;
}

function parseDraft(value: unknown): ReservationDraft {
  const body = requireObject(value);
  rejectUnsupportedFields(body, editableFields);
  if (!("guestId" in body) || !("unitId" in body) || !("checkIn" in body) ||
      !("checkOut" in body) || !("numberOfGuests" in body)) {
    throw new HttpError(
      400,
      "Guest, unit, stay dates, and guest count are required.",
    );
  }
  const dates = parseDateRange(body.checkIn, body.checkOut);
  return {
    guestId: positiveInteger(body.guestId, "Guest ID", Number.MAX_SAFE_INTEGER),
    unitId: positiveInteger(body.unitId, "Unit ID", Number.MAX_SAFE_INTEGER),
    checkIn: dates.checkIn,
    checkOut: dates.checkOut,
    numberOfGuests: positiveInteger(body.numberOfGuests, "Number of guests", 1000),
    nightlyRateCents: body.nightlyRate === undefined
      ? null
      : rateToCents(body.nightlyRate),
    notes: optionalText(body.notes, "Reservation notes", 2000),
  };
}

function parseFilters(query: Record<string, unknown>) {
  const status = query.status === undefined
    ? "all"
    : enumValue(query.status, "Status", [
        ...reservationStatuses,
        "all",
      ] as const);
  const checkInFrom = query.checkInFrom === undefined
    ? null
    : parseIsoDate(singleQuery(query.checkInFrom, "Check-in start"), "Check-in start");
  const checkInTo = query.checkInTo === undefined
    ? null
    : parseIsoDate(singleQuery(query.checkInTo, "Check-in end"), "Check-in end");
  if (checkInFrom && checkInTo && checkInFrom > checkInTo) {
    throw new HttpError(400, "Check-in start must not be after check-in end.");
  }
  return {
    status: status as ReservationStatusFilter,
    search: queryText(query.q),
    propertyId: optionalQueryId(query.propertyId, "Property ID"),
    unitId: optionalQueryId(query.unitId, "Unit ID"),
    guestId: optionalQueryId(query.guestId, "Guest ID"),
    checkInFrom,
    checkInTo,
    limit: queryInteger(query.limit, "Limit", 50, 1, 200),
    offset: queryInteger(query.offset, "Offset", 0, 0, 1_000_000),
  };
}

function parseDateRange(checkInValue: unknown, checkOutValue: unknown) {
  const checkIn = parseIsoDate(checkInValue, "Check-in date");
  const checkOut = parseIsoDate(checkOutValue, "Check-out date");
  if (checkOut <= checkIn) {
    throw new HttpError(400, "Check-out date must be after check-in date.");
  }
  return { checkIn, checkOut, nights: nightsBetween(checkIn, checkOut) };
}

function parseIsoDate(value: unknown, field: string): string {
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

function optionalQueryId(value: unknown, field: string): number | null {
  return value === undefined ? null : parseRecordId(singleQuery(value, field));
}

function singleQuery(value: unknown, field: string): string {
  if (typeof value !== "string") throw new HttpError(400, `${field} must be supplied once.`);
  return value;
}

function queryNumber(value: unknown, field: string): number {
  const text = singleQuery(value, field);
  if (!/^(?:\d+)(?:\.\d+)?$/.test(text)) {
    throw new HttpError(400, `${field} must be a valid number.`);
  }
  const number = Number(text);
  if (!Number.isFinite(number)) throw new HttpError(400, `${field} is out of range.`);
  return number;
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
  if (!/^\d+$/.test(text)) {
    throw new HttpError(400, `${field} must be a whole number.`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpError(400, `${field} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function queryText(value: unknown): string {
  if (value === undefined) return "";
  const text = singleQuery(value, "Search query").trim();
  if (text.length > 120) {
    throw new HttpError(400, "Search query must be 120 characters or fewer.");
  }
  return text;
}

function rejectUnsupportedFields(
  body: Record<string, unknown>,
  supported: ReadonlySet<string>,
): void {
  const invalidField = Object.keys(body).find((field) => !supported.has(field));
  if (invalidField) throw new HttpError(400, `Unsupported reservation field: ${invalidField}.`);
}

export function parseReservationStatus(value: unknown): ReservationStatus {
  return enumValue(value, "Status", reservationStatuses);
}
