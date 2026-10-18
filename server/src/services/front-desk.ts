import type { PmsDatabase } from "../db/connection.js";
import { HttpError } from "../middleware/http-errors.js";
import {
  getReservation,
  toReservation,
  withImmediateTransaction,
  type ReservationRecord,
} from "./reservations.js";

export type FrontDeskReservation = ReservationRecord;

export interface FrontDeskDashboard {
  date: string;
  summary: {
    arrivalsToday: number;
    departuresToday: number;
    checkedIn: number;
    overdueArrivals: number;
  };
  arrivals: FrontDeskReservation[];
  departures: FrontDeskReservation[];
  inHouse: FrontDeskReservation[];
  overdueArrivals: FrontDeskReservation[];
}

const frontDeskSelect = `
  SELECT r.id, r.reservation_reference, r.property_id, p.name AS property_name,
    r.guest_id, g.first_name, g.last_name, r.unit_id, u.name AS unit_name,
    u.status AS unit_status, r.check_in, r.check_out, r.number_of_guests,
    r.nightly_rate_cents, r.total_amount_cents, r.currency, r.lifecycle_status,
    r.stay_status, r.actual_check_in_at, r.actual_check_out_at, r.notes,
    r.created_at, r.updated_at
  FROM reservations r
  JOIN properties p ON p.id = r.property_id
  JOIN guests g ON g.id = r.guest_id
  LEFT JOIN units u ON u.id = r.unit_id`;

export function listFrontDesk(
  database: PmsDatabase,
  date: string,
): FrontDeskDashboard {
  const arrivals = queryReservations(database, `
    r.lifecycle_status = 'confirmed'
    AND r.stay_status = 'not_checked_in'
    AND r.check_in = ?
    AND r.check_out > ?
  `, date, date);
  const departures = queryReservations(database, `
    r.lifecycle_status = 'confirmed'
    AND r.stay_status = 'checked_in'
    AND r.check_out = ?
  `, date);
  const inHouse = queryReservations(database, `
    r.lifecycle_status = 'confirmed'
    AND r.stay_status = 'checked_in'
  `);
  const overdueArrivals = queryReservations(database, `
    r.lifecycle_status = 'confirmed'
    AND r.stay_status = 'not_checked_in'
    AND r.check_in < ?
    AND r.check_out > ?
  `, date, date);
  return {
    date,
    summary: {
      arrivalsToday: arrivals.length,
      departuresToday: departures.length,
      checkedIn: inHouse.length,
      overdueArrivals: overdueArrivals.length,
    },
    arrivals,
    departures,
    inHouse,
    overdueArrivals,
  };
}

export function checkInReservation(
  database: PmsDatabase,
  id: number,
  now = new Date(),
): FrontDeskReservation {
  return withImmediateTransaction(database, (client) => {
    const existing = client.prepare("SELECT * FROM reservations WHERE id = ?").get(id);
    if (!existing) throw new HttpError(404, "Reservation not found.");
    if (existing.lifecycle_status !== "confirmed") {
      throw new HttpError(409, "Only confirmed reservations can be checked in.");
    }
    if (existing.stay_status === "checked_in") {
      throw new HttpError(409, "This guest is already checked in.");
    }
    if (existing.stay_status === "checked_out") {
      throw new HttpError(409, "This stay has already been checked out.");
    }
    if (existing.unit_id === null) {
      throw new HttpError(409, "Assign an active unit to this legacy reservation before check-in.");
    }

    const unit = client.prepare(`
      SELECT u.id, u.property_id, u.status AS unit_status, u.archived_at,
        p.status AS property_status, g.status AS guest_status
      FROM units u
      JOIN properties p ON p.id = u.property_id
      JOIN guests g ON g.id = ?
      WHERE u.id = ?
    `).get(existing.guest_id, existing.unit_id);
    if (!unit) {
      throw new HttpError(409, "The reservation's assigned unit or related record is unavailable.");
    }
    if (unit.property_id !== existing.property_id) {
      throw new HttpError(409, "The assigned unit does not belong to this reservation's property.");
    }
    if (unit.property_status !== "active") {
      throw new HttpError(409, "Reservations at archived properties cannot be checked in.");
    }
    if (unit.guest_status !== "active") {
      throw new HttpError(409, "Restore the guest before checking in this reservation.");
    }
    if (unit.unit_status !== "active" || unit.archived_at !== null) {
      throw new HttpError(409, "The assigned unit is inactive, archived, or unavailable.");
    }

    const today = localDate(now);
    if (textValue(existing.check_in) > today || textValue(existing.check_out) <= today) {
      throw new HttpError(
        409,
        "Check-in is allowed on or after the scheduled arrival date and before the departure date.",
      );
    }
    const occupied = client.prepare(`
      SELECT 1 AS occupied
      FROM reservations
      WHERE unit_id = ?
        AND id <> ?
        AND stay_status = 'checked_in'
        AND actual_check_out_at IS NULL
      LIMIT 1
    `).get(existing.unit_id, id);
    if (occupied) throw new HttpError(409, "The assigned unit is already occupied by another stay.");

    client.prepare(`
      UPDATE reservations
      SET stay_status = 'checked_in', actual_check_in_at = ?, updated_at = ?
      WHERE id = ? AND stay_status = 'not_checked_in'
    `).run(now.toISOString(), now.toISOString(), id);
    return reservationWithUnitStatus(database, id);
  });
}

export function checkOutReservation(
  database: PmsDatabase,
  id: number,
  now = new Date(),
): FrontDeskReservation {
  return withImmediateTransaction(database, (client) => {
    const existing = client.prepare("SELECT * FROM reservations WHERE id = ?").get(id);
    if (!existing) throw new HttpError(404, "Reservation not found.");
    if (existing.stay_status === "checked_out") {
      throw new HttpError(409, "This stay has already been checked out.");
    }
    if (existing.stay_status !== "checked_in") {
      throw new HttpError(409, "Only a currently checked-in guest can be checked out.");
    }
    if (existing.unit_id === null || existing.actual_check_in_at === null) {
      throw new HttpError(409, "The checked-in stay is missing its assigned unit or check-in time.");
    }
    const unit = client.prepare(`
      SELECT u.id
      FROM units u
      JOIN properties p ON p.id = u.property_id
      JOIN guests g ON g.id = ?
      WHERE u.id = ? AND u.property_id = ?
        AND p.id = ? AND g.id = ?
    `).get(
      existing.guest_id,
      existing.unit_id,
      existing.property_id,
      existing.property_id,
      existing.guest_id,
    );
    if (!unit) {
      throw new HttpError(409, "The assigned unit or related records are no longer valid.");
    }
    const checkInAt = textValue(existing.actual_check_in_at);
    if (now.getTime() < Date.parse(checkInAt)) {
      throw new HttpError(400, "Check-out time cannot be earlier than the recorded check-in time.");
    }

    client.prepare(`
      UPDATE reservations
      SET stay_status = 'checked_out', actual_check_out_at = ?, updated_at = ?
      WHERE id = ? AND stay_status = 'checked_in'
    `).run(now.toISOString(), now.toISOString(), id);
    return reservationWithUnitStatus(database, id);
  });
}

function queryReservations(
  database: PmsDatabase,
  condition: string,
  ...parameters: string[]
): FrontDeskReservation[] {
  return database.$client.prepare(`
    ${frontDeskSelect}
    WHERE ${condition}
    ORDER BY r.check_in, r.id
  `).all(...parameters).map(toReservation);
}

function reservationWithUnitStatus(
  database: PmsDatabase,
  id: number,
): FrontDeskReservation {
  return getReservation(database, id);
}

function localDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function textValue(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Database returned an invalid text front desk value.");
  }
  return value;
}
