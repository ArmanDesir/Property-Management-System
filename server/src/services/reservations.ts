import { randomUUID } from "node:crypto";
import type { SQLInputValue } from "node:sqlite";
import type { PmsDatabase } from "../db/connection.js";
import { HttpError } from "../middleware/http-errors.js";

export type ReservationStatus = "pending" | "confirmed" | "cancelled" | "completed";
export type ReservationStatusFilter = ReservationStatus | "all";

export interface ReservationDraft {
  guestId: number;
  unitId: number;
  checkIn: string;
  checkOut: string;
  numberOfGuests: number;
  nightlyRateCents: number | null;
  notes: string | null;
}

export interface ReservationFilters {
  status: ReservationStatusFilter;
  search: string;
  propertyId: number | null;
  unitId: number | null;
  guestId: number | null;
  checkInFrom: string | null;
  checkInTo: string | null;
  limit: number;
  offset: number;
}

export interface ReservationRecord {
  id: number;
  reservationReference: string;
  propertyId: number;
  propertyName: string;
  guestId: number;
  guestName: string;
  unitId: number | null;
  unitName: string | null;
  unitStatus: string | null;
  checkIn: string;
  checkOut: string;
  numberOfGuests: number;
  nightlyRateCents: number;
  totalAmountCents: number;
  currency: string;
  status: ReservationStatus;
  stayStatus: "not_checked_in" | "checked_in" | "checked_out";
  actualCheckInAt: string | null;
  actualCheckOutAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AvailabilityQuote {
  unitId: number;
  unitName: string;
  propertyId: number;
  propertyName: string;
  currency: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  numberOfGuests: number;
  nightlyRateCents: number;
  totalAmountCents: number;
  available: boolean;
  reason: string | null;
}

const reservationSelect = `
  SELECT r.id, r.reservation_reference, r.property_id, p.name AS property_name,
    r.guest_id, g.first_name, g.last_name, r.unit_id, u.name AS unit_name,
    u.status AS unit_status,
    r.check_in, r.check_out, r.number_of_guests, r.nightly_rate_cents,
    r.total_amount_cents, r.currency, r.lifecycle_status, r.stay_status,
    r.actual_check_in_at, r.actual_check_out_at, r.notes,
    r.created_at, r.updated_at
  FROM reservations r
  JOIN properties p ON p.id = r.property_id
  JOIN guests g ON g.id = r.guest_id
  LEFT JOIN units u ON u.id = r.unit_id`;

export function listReservations(database: PmsDatabase, filters: ReservationFilters) {
  const conditions: string[] = [];
  const parameters: SQLInputValue[] = [];
  if (filters.status !== "all") {
    conditions.push("r.lifecycle_status = ?");
    parameters.push(filters.status);
  }
  if (filters.propertyId !== null) {
    conditions.push("r.property_id = ?");
    parameters.push(filters.propertyId);
  }
  if (filters.unitId !== null) {
    conditions.push("r.unit_id = ?");
    parameters.push(filters.unitId);
  }
  if (filters.guestId !== null) {
    conditions.push("r.guest_id = ?");
    parameters.push(filters.guestId);
  }
  if (filters.checkInFrom !== null) {
    conditions.push("r.check_in >= ?");
    parameters.push(filters.checkInFrom);
  }
  if (filters.checkInTo !== null) {
    conditions.push("r.check_in <= ?");
    parameters.push(filters.checkInTo);
  }
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    conditions.push(`(
      r.reservation_reference LIKE ? OR
      g.first_name || ' ' || g.last_name LIKE ? OR
      p.name LIKE ? OR COALESCE(u.name, '') LIKE ?
    )`);
    parameters.push(pattern, pattern, pattern, pattern);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const count = database.$client.prepare(
    `SELECT COUNT(*) AS count FROM reservations r
      JOIN properties p ON p.id = r.property_id
      JOIN guests g ON g.id = r.guest_id
      LEFT JOIN units u ON u.id = r.unit_id${where}`,
  ).get(...parameters);
  const records = database.$client.prepare(
    `${reservationSelect}${where}
      ORDER BY r.check_in DESC, r.id DESC LIMIT ? OFFSET ?`,
  ).all(...parameters, filters.limit, filters.offset);
  return {
    reservations: records.map(toReservation),
    total: integerValue(count?.count),
    limit: filters.limit,
    offset: filters.offset,
  };
}

export function getReservation(database: PmsDatabase, id: number): ReservationRecord {
  const row = database.$client.prepare(`${reservationSelect} WHERE r.id = ?`).get(id);
  if (!row) throw new HttpError(404, "Reservation not found.");
  return toReservation(row);
}

export function getAvailabilityQuote(
  database: PmsDatabase,
  draft: Pick<ReservationDraft, "unitId" | "checkIn" | "checkOut" | "numberOfGuests" | "nightlyRateCents">,
  nights: number,
  excludeReservationId: number | null = null,
): AvailabilityQuote {
  const unit = getUnitContext(database, draft.unitId);
  const rate = draft.nightlyRateCents ?? integerValue(unit.base_nightly_rate_cents);
  const total = calculateTotal(rate, nights);
  let reason: string | null = null;
  if (unit.property_status !== "active") reason = "This property is archived.";
  else if (unit.unit_status !== "active" || unit.archived_at !== null) {
    reason = "This unit is not active.";
  } else if (draft.numberOfGuests > integerValue(unit.capacity)) {
    reason = "Guest count exceeds this unit’s capacity.";
  } else if (hasOverlap(database, draft, excludeReservationId)) {
    reason = "The unit is already reserved for some or all of these dates.";
  }
  return {
    unitId: integerValue(unit.id),
    unitName: textValue(unit.unit_name),
    propertyId: integerValue(unit.property_id),
    propertyName: textValue(unit.property_name),
    currency: textValue(unit.default_currency),
    checkIn: draft.checkIn,
    checkOut: draft.checkOut,
    nights,
    numberOfGuests: draft.numberOfGuests,
    nightlyRateCents: rate,
    totalAmountCents: total,
    available: reason === null,
    reason,
  };
}

export function createReservation(
  database: PmsDatabase,
  draft: ReservationDraft,
  nights: number,
): ReservationRecord {
  return withImmediateTransaction(database, (client) => {
    const unit = getUnitContext(database, draft.unitId);
    assertEligible(unit, draft.numberOfGuests);
    assertActiveGuest(client, draft.guestId);
    const quote = getAvailabilityQuote(database, draft, nights);
    if (!quote.available) throw new HttpError(409, quote.reason ?? "The unit is unavailable.");

    const reference = `R-${randomUUID().toUpperCase()}`;
    const result = client.prepare(`
      INSERT INTO reservations (
        reservation_reference, property_id, guest_id, unit_id, check_in, check_out,
        number_of_guests, nightly_rate_cents, lifecycle_status, status,
        total_amount_cents, currency, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'booked', ?, ?, ?)
    `).run(
      reference,
      unit.property_id,
      draft.guestId,
      draft.unitId,
      draft.checkIn,
      draft.checkOut,
      draft.numberOfGuests,
      quote.nightlyRateCents,
      quote.totalAmountCents,
      unit.default_currency,
      draft.notes,
    );
    return getReservation(database, Number(result.lastInsertRowid));
  });
}

export function updateReservation(
  database: PmsDatabase,
  id: number,
  draft: ReservationDraft,
  nights: number,
): ReservationRecord {
  return withImmediateTransaction(database, (client) => {
    const existing = findRawReservation(client, id);
    if (!existing) throw new HttpError(404, "Reservation not found.");
    const status = textValue(existing.lifecycle_status) as ReservationStatus;
    if (status !== "pending" && status !== "confirmed") {
      throw new HttpError(409, "Cancelled or completed reservations cannot be edited.");
    }
    if (textValue(existing.stay_status) !== "not_checked_in") {
      throw new HttpError(409, "A reservation cannot be edited after its stay has started.");
    }

    const unit = getUnitContext(database, draft.unitId);
    assertEligible(unit, draft.numberOfGuests);
    assertActiveGuest(client, draft.guestId);
    const quote = getAvailabilityQuote(database, draft, nights, id);
    if (!quote.available) throw new HttpError(409, quote.reason ?? "The unit is unavailable.");

    client.prepare(`
      UPDATE reservations
      SET property_id = ?, guest_id = ?, unit_id = ?, check_in = ?, check_out = ?,
        number_of_guests = ?, nightly_rate_cents = ?, total_amount_cents = ?,
        currency = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(
      unit.property_id,
      draft.guestId,
      draft.unitId,
      draft.checkIn,
      draft.checkOut,
      draft.numberOfGuests,
      quote.nightlyRateCents,
      quote.totalAmountCents,
      unit.default_currency,
      draft.notes,
      new Date().toISOString(),
      id,
    );
    return getReservation(database, id);
  });
}

export function transitionReservation(
  database: PmsDatabase,
  id: number,
  nextStatus: Exclude<ReservationStatus, "pending">,
): ReservationRecord {
  return withImmediateTransaction(database, (client) => {
    const existing = findRawReservation(client, id);
    if (!existing) throw new HttpError(404, "Reservation not found.");
    const currentStatus = textValue(existing.lifecycle_status) as ReservationStatus;
    if (currentStatus === nextStatus) return getReservation(database, id);
    const allowed =
      (currentStatus === "pending" &&
        (nextStatus === "confirmed" || nextStatus === "cancelled")) ||
      (currentStatus === "confirmed" &&
        (nextStatus === "cancelled" || nextStatus === "completed"));
    if (!allowed) {
      throw new HttpError(
        409,
        `A ${currentStatus} reservation cannot transition to ${nextStatus}.`,
      );
    }
    if (
      textValue(existing.stay_status) === "checked_in" &&
      (nextStatus === "cancelled" || nextStatus === "completed")
    ) {
      throw new HttpError(409, "Check out the guest before completing or cancelling this reservation.");
    }

    if (nextStatus === "confirmed") {
      const unitId = nullableIntegerValue(existing.unit_id);
      if (unitId === null) {
        throw new HttpError(409, "This legacy reservation has no assigned unit.");
      }
      const unit = getUnitContext(database, unitId);
      assertEligible(unit, integerValue(existing.number_of_guests));
      assertActiveGuest(client, integerValue(existing.guest_id));
      const draft: ReservationDraft = {
        guestId: integerValue(existing.guest_id),
        unitId,
        checkIn: textValue(existing.check_in),
        checkOut: textValue(existing.check_out),
        numberOfGuests: integerValue(existing.number_of_guests),
        nightlyRateCents: integerValue(existing.nightly_rate_cents),
        notes: nullableTextValue(existing.notes),
      };
      const quote = getAvailabilityQuote(
        database,
        draft,
        nightsBetween(draft.checkIn, draft.checkOut),
        id,
      );
      if (!quote.available) {
        throw new HttpError(409, quote.reason ?? "The unit is unavailable.");
      }
    }

    const legacyStatus = nextStatus === "cancelled"
      ? "cancelled"
      : nextStatus === "completed"
        ? "checked_out"
        : "booked";
    client.prepare(`
      UPDATE reservations SET lifecycle_status = ?, status = ?, updated_at = ? WHERE id = ?
    `).run(nextStatus, legacyStatus, new Date().toISOString(), id);
    return getReservation(database, id);
  });
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return (Date.parse(`${checkOut}T00:00:00.000Z`) -
    Date.parse(`${checkIn}T00:00:00.000Z`)) / 86_400_000;
}

export function withImmediateTransaction<T>(
  database: PmsDatabase,
  operation: (client: PmsDatabase["$client"]) => T,
): T {
  const client = database.$client;
  // Keep the transaction synchronous so this shared connection cannot interleave requests.
  client.exec("BEGIN IMMEDIATE");
  try {
    const result = operation(client);
    client.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      client.exec("ROLLBACK");
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Reservation operation and transaction rollback both failed.",
      );
    }
    throw error;
  }
}

function hasOverlap(
  database: PmsDatabase,
  draft: Pick<ReservationDraft, "unitId" | "checkIn" | "checkOut">,
  excludeReservationId: number | null,
): boolean {
  const exclusion = excludeReservationId === null ? "" : " AND id <> ?";
  const parameters: SQLInputValue[] = [
    draft.unitId,
    draft.checkOut,
    draft.checkIn,
  ];
  if (excludeReservationId !== null) parameters.push(excludeReservationId);
  const result = database.$client.prepare(`
    SELECT 1 AS conflict
    FROM reservations
    WHERE unit_id = ?
      AND lifecycle_status IN ('pending', 'confirmed')
      AND check_in < ?
      AND check_out > ?${exclusion}
    LIMIT 1
  `).get(...parameters);
  return result !== undefined;
}

function getUnitContext(database: PmsDatabase, unitId: number) {
  const unit = database.$client.prepare(`
    SELECT u.id, u.name AS unit_name, u.capacity, u.base_nightly_rate_cents,
      u.status AS unit_status, u.archived_at, u.property_id,
      p.name AS property_name, p.status AS property_status,
      p.default_currency
    FROM units u
    JOIN properties p ON p.id = u.property_id
    WHERE u.id = ?
  `).get(unitId);
  if (!unit) throw new HttpError(404, "Unit not found.");
  return unit;
}

function assertEligible(
  unit: ReturnType<typeof getUnitContext>,
  numberOfGuests: number,
): void {
  if (textValue(unit.property_status) !== "active") {
    throw new HttpError(409, "Reservations cannot be made at an archived property.");
  }
  if (textValue(unit.unit_status) !== "active" || unit.archived_at !== null) {
    throw new HttpError(409, "Reservations require an active unit.");
  }
  if (numberOfGuests > integerValue(unit.capacity)) {
    throw new HttpError(400, "Number of guests exceeds this unit’s capacity.");
  }
}

function assertActiveGuest(client: PmsDatabase["$client"], guestId: number): void {
  const guest = client.prepare("SELECT status FROM guests WHERE id = ?").get(guestId);
  if (!guest) throw new HttpError(404, "Guest not found.");
  if (textValue(guest.status) !== "active") {
    throw new HttpError(409, "Restore this guest before creating or confirming a reservation.");
  }
}

function findRawReservation(client: PmsDatabase["$client"], id: number) {
  return client.prepare("SELECT * FROM reservations WHERE id = ?").get(id);
}

export function toReservation(row: Record<string, unknown>): ReservationRecord {
  return {
    id: integerValue(row.id),
    reservationReference: textValue(row.reservation_reference),
    propertyId: integerValue(row.property_id),
    propertyName: textValue(row.property_name),
    guestId: integerValue(row.guest_id),
    guestName: `${textValue(row.first_name)} ${textValue(row.last_name)}`,
    unitId: nullableIntegerValue(row.unit_id),
    unitName: nullableTextValue(row.unit_name),
    unitStatus: nullableTextValue(row.unit_status),
    checkIn: textValue(row.check_in),
    checkOut: textValue(row.check_out),
    numberOfGuests: integerValue(row.number_of_guests),
    nightlyRateCents: integerValue(row.nightly_rate_cents),
    totalAmountCents: integerValue(row.total_amount_cents),
    currency: textValue(row.currency),
    status: textValue(row.lifecycle_status) as ReservationStatus,
    stayStatus: textValue(row.stay_status) as ReservationRecord["stayStatus"],
    actualCheckInAt: nullableTextValue(row.actual_check_in_at),
    actualCheckOutAt: nullableTextValue(row.actual_check_out_at),
    notes: nullableTextValue(row.notes),
    createdAt: textValue(row.created_at),
    updatedAt: textValue(row.updated_at),
  };
}

function calculateTotal(nightlyRateCents: number, nights: number): number {
  const total = nightlyRateCents * nights;
  if (!Number.isSafeInteger(total)) {
    throw new HttpError(400, "The reservation total exceeds the supported amount.");
  }
  return total;
}

function integerValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error("Database returned an invalid integer reservation value.");
  }
  return value;
}

function nullableIntegerValue(value: unknown): number | null {
  return value === null ? null : integerValue(value);
}

function textValue(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Database returned an invalid text reservation value.");
  }
  return value;
}

function nullableTextValue(value: unknown): string | null {
  return value === null ? null : textValue(value);
}
