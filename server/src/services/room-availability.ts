import type { PmsDatabase } from "../db/connection.js";
import { HttpError } from "../middleware/http-errors.js";
import type { AuthenticatedStaff } from "./auth.js";
import { listTaskProperties } from "./team-tasks.js";

export type RoomNightStatus = "available" | "reserved" | "occupied" | "unavailable";

export function listCalendarProperties(database: PmsDatabase, actor: AuthenticatedStaff) {
  if (actor.role === "administrator" || actor.role === "front_desk") {
    return database.$client.prepare(`
      SELECT id, name, property_type AS propertyType FROM properties
      WHERE status = 'active' AND property_type = 'hotel'
      ORDER BY name COLLATE NOCASE, id
    `).all();
  }
  if (actor.role === "property_manager") {
    const assigned = listTaskProperties(database, actor)
      .filter((property) => property.propertyType === "hotel");
    return assigned;
  }
  throw new HttpError(403, "Your staff role cannot view room availability.");
}

export function getRoomAvailability(
  database: PmsDatabase,
  actor: AuthenticatedStaff,
  input: {
    propertyId: number;
    from: string;
    to: string;
    checkIn: string | null;
    checkOut: string | null;
  },
) {
  const property = listCalendarProperties(database, actor)
    .find((row) => numberValue(row.id) === input.propertyId);
  if (!property) throw new HttpError(404, "Hotel property not found.");
  const days = calendarDays(input.from, input.to);
  if (input.checkIn !== null && input.checkOut !== null) {
    calendarDays(input.checkIn, input.checkOut);
  }
  const queryFrom = input.checkIn !== null && input.checkIn < input.from
    ? input.checkIn
    : input.from;
  const queryTo = input.checkOut !== null && input.checkOut > input.to
    ? input.checkOut
    : input.to;
  const rows = database.$client.prepare(`
    SELECT u.id AS unit_id, u.name AS unit_name, u.unit_type,
      u.status AS unit_status, u.housekeeping_status, u.archived_at,
      r.id AS reservation_id, r.lifecycle_status, r.stay_status,
      r.check_in, r.check_out, r.actual_check_in_at, r.actual_check_out_at
    FROM units u
    LEFT JOIN reservations r ON r.unit_id = u.id AND (
      (r.lifecycle_status IN ('pending', 'confirmed')
        AND r.check_in < ? AND r.check_out > ?)
      OR (r.stay_status IN ('checked_in', 'checked_out')
        AND r.actual_check_in_at IS NOT NULL
        AND substr(r.actual_check_in_at, 1, 10) < ?
        AND (r.actual_check_out_at IS NULL
          OR substr(r.actual_check_out_at, 1, 10) > ?))
    )
    WHERE u.property_id = ? AND u.archived_at IS NULL
    ORDER BY u.name COLLATE NOCASE, u.id, r.id
  `).all(queryTo, queryFrom, queryTo, queryFrom, input.propertyId);

  const roomMap = new Map<number, {
    id: number;
    name: string;
    unitType: string;
    operationalStatus: string;
    housekeepingStatus: string;
    stays: Array<Record<string, unknown>>;
  }>();
  for (const row of rows) {
    const id = numberValue(row.unit_id);
    const room = roomMap.get(id) ?? {
      id,
      name: textValue(row.unit_name),
      unitType: textValue(row.unit_type),
      operationalStatus: textValue(row.unit_status),
      housekeepingStatus: textValue(row.housekeeping_status),
      stays: [],
    };
    if (row.reservation_id !== null) room.stays.push(row);
    roomMap.set(id, room);
  }
  const rooms = [...roomMap.values()].map((room) => ({
    id: room.id,
    name: room.name,
    unitType: room.unitType,
    operationalStatus: room.operationalStatus,
    housekeepingStatus: room.housekeepingStatus,
    nights: days.map((date) => ({ date, ...nightStatus(room, date) })),
    availableForStay: input.checkIn === null || input.checkOut === null
      ? null
      : calendarDays(input.checkIn, input.checkOut).every((date) =>
        nightStatus(room, date).status === "available"
      ),
  }));
  const selectedStatuses = rooms.map((room) => room.nights[0]?.status ?? "available");
  return {
    property: {
      id: numberValue(property.id),
      name: textValue(property.name),
      propertyType: textValue(property.propertyType),
    },
    range: { from: input.from, to: input.to, toExclusive: true },
    searchStay: input.checkIn === null ? null : {
      checkIn: input.checkIn,
      checkOut: input.checkOut,
    },
    summary: {
      totalRooms: rooms.length,
      availableRooms: selectedStatuses.filter((status) => status === "available").length,
      reservedRooms: selectedStatuses.filter((status) => status === "reserved").length,
      occupiedRooms: selectedStatuses.filter((status) => status === "occupied").length,
      unavailableRooms: selectedStatuses.filter((status) => status === "unavailable").length,
    },
    rooms,
    definitions: {
      available: "Active room with no blocking reservation or active stay on that night.",
      reserved: "A pending or confirmed reservation blocks this room night.",
      occupied: "Actual check-in/check-out timestamps indicate an in-house stay; an unclosed active stay blocks subsequent nights.",
      unavailable: "The unit is inactive or in maintenance. Dirty/cleaning status is separate and does not itself block booking.",
      pendingReservations: "Pending and confirmed reservations block the half-open stay interval [check-in, check-out).",
    },
  };
}

export function validateCalendarDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !isIsoDate(value)) {
    throw new HttpError(400, `${field} must be a valid date in YYYY-MM-DD format.`);
  }
  return value;
}

function nightStatus(
  room: {
    operationalStatus: string;
    stays: Array<Record<string, unknown>>;
  },
  date: string,
): { status: RoomNightStatus; reason: string | null } {
  for (const stay of room.stays) {
    if (
      stay.stay_status === "checked_in" &&
      typeof stay.actual_check_in_at === "string" &&
      stay.actual_check_in_at.slice(0, 10) <= date &&
      (stay.actual_check_out_at === null ||
        (typeof stay.actual_check_out_at === "string" &&
          date < stay.actual_check_out_at.slice(0, 10)))
    ) return { status: "occupied", reason: "An actual stay is in progress." };
    if (
      stay.stay_status === "checked_out" &&
      typeof stay.actual_check_in_at === "string" &&
      typeof stay.actual_check_out_at === "string" &&
      stay.actual_check_in_at.slice(0, 10) <= date &&
      date < stay.actual_check_out_at.slice(0, 10)
    ) return { status: "occupied", reason: "An actual stay occupied this night." };
  }
  if (room.operationalStatus !== "active") {
    return {
      status: "unavailable",
      reason: room.operationalStatus === "maintenance"
        ? "The room is marked out of service for maintenance."
        : "The room is inactive.",
    };
  }
  for (const stay of room.stays) {
    if (
      (stay.lifecycle_status === "pending" || stay.lifecycle_status === "confirmed") &&
      typeof stay.check_in === "string" &&
      typeof stay.check_out === "string" &&
      stay.check_in <= date &&
      date < stay.check_out
    ) return { status: "reserved", reason: "A pending or confirmed reservation holds this night." };
  }
  return { status: "available", reason: null };
}

function calendarDays(from: string, to: string): string[] {
  if (!isIsoDate(from) || !isIsoDate(to) || to <= from) {
    throw new HttpError(400, "Calendar dates must be valid and the end date must be after the start date.");
  }
  const days = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000;
  if (!Number.isInteger(days) || days > 62) {
    throw new HttpError(400, "Calendar range must not exceed 62 nights.");
  }
  return Array.from({ length: days }, (_, index) =>
    new Date(Date.parse(`${from}T00:00:00.000Z`) + index * 86_400_000)
      .toISOString().slice(0, 10)
  );
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new Error("Database returned an invalid room availability number.");
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  throw new Error("Database returned invalid room availability text.");
}
