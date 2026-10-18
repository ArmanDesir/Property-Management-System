import type { PmsDatabase } from "../db/connection.js";
import { HttpError } from "../middleware/http-errors.js";
import { withImmediateTransaction } from "./reservations.js";

export type HousekeepingStatus = "dirty" | "cleaning" | "clean";

export interface HousekeepingStay {
  reservationId: number;
  reservationReference: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  actualCheckInAt: string;
}

export interface HousekeepingUnit {
  id: number;
  propertyId: number;
  propertyName: string;
  name: string;
  unitType: string;
  housekeepingStatus: HousekeepingStatus;
  operationalStatus: string;
  lastCleanedAt: string | null;
  activeStay: HousekeepingStay | null;
}

export interface HousekeepingOverview {
  filters: {
    propertyId: number | null;
    status: HousekeepingStatus | "all";
  };
  summary: {
    needsCleaning: number;
    cleaningInProgress: number;
    clean: number;
    maintenance: number;
  };
  units: HousekeepingUnit[];
}

const unitSelect = `
  SELECT u.id, u.property_id, p.name AS property_name, u.name,
    u.unit_type, u.housekeeping_status, u.status AS operational_status,
    u.last_cleaned_at, r.id AS reservation_id,
    r.reservation_reference, g.first_name, g.last_name,
    r.check_in, r.check_out, r.actual_check_in_at
  FROM units u
  JOIN properties p ON p.id = u.property_id
  LEFT JOIN reservations r
    ON r.unit_id = u.id
    AND r.lifecycle_status = 'confirmed'
    AND r.stay_status = 'checked_in'
    AND r.actual_check_out_at IS NULL
  LEFT JOIN guests g ON g.id = r.guest_id`;

export function listHousekeeping(
  database: PmsDatabase,
  propertyId: number | null,
  status: HousekeepingStatus | "all",
): HousekeepingOverview {
  if (propertyId !== null) {
    const property = database.$client
      .prepare("SELECT id FROM properties WHERE id = ? AND status = 'active'")
      .get(propertyId);
    if (!property) throw new HttpError(404, "Active property not found.");
  }

  const where = [
    "u.archived_at IS NULL",
    "p.status = 'active'",
    ...(propertyId === null ? [] : ["u.property_id = ?"]),
  ];
  const parameters = propertyId === null ? [] : [propertyId];
  const condition = where.join(" AND ");
  const summaryRow = database.$client.prepare(`
    SELECT
      SUM(CASE WHEN u.housekeeping_status = 'dirty' THEN 1 ELSE 0 END) AS needs_cleaning,
      SUM(CASE WHEN u.housekeeping_status = 'cleaning' THEN 1 ELSE 0 END) AS cleaning_in_progress,
      SUM(CASE WHEN u.housekeeping_status = 'clean' THEN 1 ELSE 0 END) AS clean,
      SUM(CASE WHEN u.status = 'maintenance' THEN 1 ELSE 0 END) AS maintenance
    FROM units u
    JOIN properties p ON p.id = u.property_id
    WHERE ${condition}
  `).get(...parameters);
  const statusCondition = status === "all" ? "" : " AND u.housekeeping_status = ?";
  const rows = database.$client.prepare(`
    ${unitSelect}
    WHERE ${condition}${statusCondition}
    ORDER BY p.name COLLATE NOCASE, u.name COLLATE NOCASE, u.id
  `).all(...parameters, ...(status === "all" ? [] : [status]));
  return {
    filters: { propertyId, status },
    summary: {
      needsCleaning: integerValue(summaryRow?.needs_cleaning),
      cleaningInProgress: integerValue(summaryRow?.cleaning_in_progress),
      clean: integerValue(summaryRow?.clean),
      maintenance: integerValue(summaryRow?.maintenance),
    },
    units: rows.map(toHousekeepingUnit),
  };
}

export function updateHousekeepingStatus(
  database: PmsDatabase,
  unitId: number,
  status: HousekeepingStatus,
  now = new Date(),
): HousekeepingUnit {
  return withImmediateTransaction(database, (client) => {
    const existing = client.prepare(`
      SELECT id, housekeeping_status, archived_at
      FROM units
      WHERE id = ?
    `).get(unitId);
    if (!existing || existing.archived_at !== null) {
      throw new HttpError(404, "Active unit not found.");
    }

    const currentStatus = housekeepingStatusValue(existing.housekeeping_status);
    if (status === currentStatus) return getHousekeepingUnit(database, unitId);

    const allowedTransitions: Record<HousekeepingStatus, readonly HousekeepingStatus[]> = {
      dirty: ["cleaning"],
      cleaning: ["dirty", "clean"],
      clean: ["dirty"],
    };
    if (!allowedTransitions[currentStatus].includes(status)) {
      throw new HttpError(
        409,
        `Cannot change housekeeping status from ${currentStatus} to ${status}.`,
      );
    }

    if (status === "cleaning" || status === "clean") {
      const occupied = client.prepare(`
        SELECT 1 AS occupied
        FROM reservations
        WHERE unit_id = ?
          AND lifecycle_status = 'confirmed'
          AND stay_status = 'checked_in'
          AND actual_check_out_at IS NULL
        LIMIT 1
      `).get(unitId);
      if (occupied) {
        throw new HttpError(409, "An occupied unit cannot be started or marked clean.");
      }
    }

    const timestamp = now.toISOString();
    if (status === "clean") {
      client.prepare(`
        UPDATE units
        SET housekeeping_status = ?, last_cleaned_at = ?, updated_at = ?
        WHERE id = ? AND housekeeping_status = ?
      `).run(status, timestamp, timestamp, unitId, currentStatus);
    } else {
      client.prepare(`
        UPDATE units
        SET housekeeping_status = ?, updated_at = ?
        WHERE id = ? AND housekeeping_status = ?
      `).run(status, timestamp, unitId, currentStatus);
    }
    return getHousekeepingUnit(database, unitId);
  });
}

function getHousekeepingUnit(database: PmsDatabase, unitId: number): HousekeepingUnit {
  const row = database.$client.prepare(`
    ${unitSelect}
    WHERE u.id = ? AND u.archived_at IS NULL AND p.status = 'active'
  `).get(unitId);
  if (!row) throw new HttpError(404, "Active unit not found.");
  return toHousekeepingUnit(row);
}

function toHousekeepingUnit(row: Record<string, unknown>): HousekeepingUnit {
  const reservationId = row.reservation_id === null
    ? null
    : integerValue(row.reservation_id);
  const activeStay = reservationId === null
    ? null
    : {
      reservationId,
      reservationReference: textValue(row.reservation_reference),
      guestName: `${textValue(row.first_name)} ${textValue(row.last_name)}`,
      checkIn: textValue(row.check_in),
      checkOut: textValue(row.check_out),
      actualCheckInAt: textValue(row.actual_check_in_at),
    };
  return {
    id: integerValue(row.id),
    propertyId: integerValue(row.property_id),
    propertyName: textValue(row.property_name),
    name: textValue(row.name),
    unitType: textValue(row.unit_type),
    housekeepingStatus: housekeepingStatusValue(row.housekeeping_status),
    operationalStatus: textValue(row.operational_status),
    lastCleanedAt: nullableTextValue(row.last_cleaned_at),
    activeStay,
  };
}

function housekeepingStatusValue(value: unknown): HousekeepingStatus {
  if (value === "dirty" || value === "cleaning" || value === "clean") return value;
  throw new Error("Database returned an invalid housekeeping status.");
}

function integerValue(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new Error("Database returned an invalid housekeeping number.");
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  throw new Error("Database returned an invalid housekeeping text value.");
}

function nullableTextValue(value: unknown): string | null {
  if (value === null) return null;
  return textValue(value);
}
