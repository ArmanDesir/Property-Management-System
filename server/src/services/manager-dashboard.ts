import type { PmsDatabase } from "../db/connection.js";
import { HttpError } from "../middleware/http-errors.js";
import type { AuthenticatedStaff } from "./auth.js";
import { getReportSummary } from "./reports.js";
import { getRoomAvailability } from "./room-availability.js";
import { listTaskProperties, managerTaskSummary } from "./team-tasks.js";

export function getPropertyManagerDashboard(
  database: PmsDatabase,
  actor: AuthenticatedStaff,
  date: string,
) {
  if (actor.role !== "administrator" && actor.role !== "property_manager") {
    throw new HttpError(403, "Your staff role cannot view the property operations dashboard.");
  }
  const properties = actor.role === "administrator"
    ? database.$client.prepare(`
      SELECT id, name, property_type AS propertyType FROM properties
      WHERE status = 'active' ORDER BY name COLLATE NOCASE, id
    `).all()
    : listTaskProperties(database, actor);
  const ids = properties.map((property) => numberValue(property.id));
  const tasks = managerTaskSummary(database, actor, date);
  if (ids.length === 0) {
    return {
      date, properties,
      operations: emptyOperations(),
      billing: [],
      tasks,
    };
  }
  const marks = ids.map(() => "?").join(", ");
  const reservations = database.$client.prepare(`
    SELECT
      SUM(CASE WHEN lifecycle_status IN ('pending', 'confirmed')
        AND stay_status = 'not_checked_in' AND check_in = ? THEN 1 ELSE 0 END) AS arrivals,
      SUM(CASE WHEN lifecycle_status = 'confirmed'
        AND stay_status = 'checked_in' AND actual_check_out_at IS NULL
        AND check_out = ? THEN 1 ELSE 0 END) AS departures,
      SUM(CASE WHEN lifecycle_status = 'confirmed'
        AND stay_status = 'checked_in' AND actual_check_out_at IS NULL
        THEN 1 ELSE 0 END) AS occupied
    FROM reservations WHERE property_id IN (${marks})
  `).get(date, date, ...ids);
  const units = database.$client.prepare(`
    SELECT
      COUNT(CASE WHEN u.status = 'active' AND u.archived_at IS NULL THEN 1 END) AS active,
      COUNT(CASE WHEN u.housekeeping_status = 'dirty' THEN 1 END) AS dirty,
      COUNT(CASE WHEN u.housekeeping_status = 'cleaning' THEN 1 END) AS cleaning,
      COUNT(CASE WHEN u.status IN ('inactive', 'maintenance') THEN 1 END) AS unavailable
    FROM units u JOIN properties p ON p.id = u.property_id
    WHERE u.property_id IN (${marks}) AND u.archived_at IS NULL AND p.status = 'active'
  `).get(...ids);
  const maintenance = database.$client.prepare(`
    SELECT
      SUM(CASE WHEN status IN ('open', 'in_progress', 'awaiting_parts') THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN status IN ('open', 'in_progress', 'awaiting_parts')
        AND target_completion_date < ? THEN 1 ELSE 0 END) AS overdue
    FROM maintenance_requests WHERE property_id IN (${marks})
  `).get(date, ...ids);
  const billingByCurrency = new Map<string, { issued: bigint; outstanding: bigint }>();
  for (const propertyId of ids) {
    const report = getReportSummary(database, { from: date, to: date, propertyId });
    for (const invoice of report.metrics.issuedInvoiceTotals) {
      const totals = billingByCurrency.get(invoice.currency) ?? { issued: 0n, outstanding: 0n };
      totals.issued += BigInt(invoice.totalCents);
      billingByCurrency.set(invoice.currency, totals);
    }
    for (const balance of report.metrics.outstandingBalances) {
      const totals = billingByCurrency.get(balance.currency) ?? { issued: 0n, outstanding: 0n };
      totals.outstanding += BigInt(balance.balanceCents);
      billingByCurrency.set(balance.currency, totals);
    }
  }
  let availableRooms = 0;
  for (const property of properties) {
    if (property.propertyType !== "hotel") continue;
    const result = getRoomAvailability(database, actor, {
      propertyId: numberValue(property.id),
      from: date,
      to: nextDate(date),
      checkIn: null,
      checkOut: null,
    });
    availableRooms += result.summary.availableRooms;
  }
  return {
    date,
    properties,
    operations: {
      arrivals: numberValue(reservations?.arrivals ?? 0),
      departures: numberValue(reservations?.departures ?? 0),
      occupiedRooms: numberValue(reservations?.occupied ?? 0),
      activeRooms: numberValue(units?.active ?? 0),
      availableRooms,
      unavailableRooms: numberValue(units?.unavailable ?? 0),
      dirtyRooms: numberValue(units?.dirty ?? 0),
      cleaningRooms: numberValue(units?.cleaning ?? 0),
      openMaintenance: numberValue(maintenance?.open ?? 0),
      overdueMaintenance: numberValue(maintenance?.overdue ?? 0),
    },
    billing: [...billingByCurrency.entries()].map(([currency, totals]) => ({
      currency,
      issuedTodayCents: totals.issued.toString(),
      outstandingCents: totals.outstanding.toString(),
    })).sort((left, right) => left.currency.localeCompare(right.currency)),
    tasks,
  };
}

function emptyOperations() {
  return {
    arrivals: 0, departures: 0, occupiedRooms: 0, activeRooms: 0,
    availableRooms: 0, unavailableRooms: 0, dirtyRooms: 0, cleaningRooms: 0,
    openMaintenance: 0, overdueMaintenance: 0,
  };
}

function nextDate(value: string): string {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new Error("Database returned an invalid manager dashboard number.");
}
