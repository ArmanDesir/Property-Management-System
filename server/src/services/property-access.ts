import type { Request } from "express";
import type { PmsDatabase } from "../db/connection.js";
import { HttpError } from "../middleware/http-errors.js";
import type { AuthenticatedStaff } from "./auth.js";
import { parseRecordId } from "./validation.js";

export function allowedPropertyIds(actor: AuthenticatedStaff): number[] | undefined {
  return actor.role === "administrator" ? undefined : actor.propertyIds;
}

export function selectedPropertyId(
  request: Request,
  actor: AuthenticatedStaff,
): number | undefined {
  const value = request.query.propertyId;
  if (value === undefined) return undefined;
  const propertyId = parseRecordId(value);
  assertPropertyAccess(actor, propertyId);
  return propertyId;
}

export function assertPropertyAccess(
  actor: AuthenticatedStaff,
  propertyId: number,
): void {
  if (
    actor.role !== "administrator" &&
    !actor.propertyIds.includes(propertyId)
  ) {
    throw new HttpError(404, "Property not found.");
  }
}

export function assertGuestPropertyAccess(
  database: PmsDatabase,
  actor: AuthenticatedStaff,
  guestId: number,
  propertyId?: number,
): void {
  if (actor.role === "administrator") return;
  const selectedIds = propertyId === undefined
    ? actor.propertyIds
    : [propertyId];
  if (selectedIds.length === 0) throw new HttpError(404, "Guest not found.");
  const placeholders = selectedIds.map(() => "?").join(", ");
  const linked = database.$client.prepare(`
    SELECT 1 FROM guest_property_access
    WHERE guest_id = ? AND property_id IN (${placeholders})
    LIMIT 1
  `).get(guestId, ...selectedIds);
  if (!linked) throw new HttpError(404, "Guest not found.");
}

export function assertReservationPropertyAccess(
  database: PmsDatabase,
  actor: AuthenticatedStaff,
  reservationId: number,
): number {
  const reservation = database.$client.prepare(`
    SELECT property_id FROM reservations WHERE id = ?
  `).get(reservationId);
  if (!reservation) throw new HttpError(404, "Reservation not found.");
  const propertyId = Number(reservation.property_id);
  assertPropertyAccess(actor, propertyId);
  return propertyId;
}

export function unitPropertyId(database: PmsDatabase, unitId: number): number {
  const unit = database.$client.prepare(`
    SELECT property_id FROM units WHERE id = ? AND archived_at IS NULL
  `).get(unitId);
  if (!unit) throw new HttpError(404, "Unit not found.");
  return Number(unit.property_id);
}

export function linkGuestToProperty(
  database: PmsDatabase,
  guestId: number,
  propertyId: number,
): void {
  database.$client.prepare(`
    INSERT INTO guest_property_access (guest_id, property_id)
    VALUES (?, ?)
    ON CONFLICT(guest_id, property_id) DO NOTHING
  `).run(guestId, propertyId);
}
