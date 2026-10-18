import type { PmsDatabase } from "../db/connection.js";

export interface ReportFilters {
  from: string;
  to: string;
  propertyId: number | null;
}

const reservationStatuses = ["pending", "confirmed", "cancelled", "completed"] as const;

export function getReportSummary(database: PmsDatabase, filters: ReportFilters) {
  const propertyCondition = filters.propertyId === null ? "" : " AND id = ?";
  const propertyParameters = filters.propertyId === null ? [] : [filters.propertyId];
  const properties = database.$client.prepare(`
    SELECT id, name, status FROM properties ORDER BY name COLLATE NOCASE, id
  `).all();
  const counts = database.$client.prepare(`
    SELECT
      (SELECT COUNT(*) FROM properties WHERE status = 'active'
        ${propertyCondition}) AS active_properties,
      (SELECT COUNT(*) FROM units u JOIN properties p ON p.id = u.property_id
        WHERE u.status = 'active' AND u.archived_at IS NULL AND p.status = 'active'
        ${filters.propertyId === null ? "" : "AND p.id = ?"}) AS active_units,
      (SELECT COUNT(*) FROM reservations r
        WHERE r.check_in BETWEEN ? AND ?
          AND r.lifecycle_status <> 'cancelled'
          ${filters.propertyId === null ? "" : "AND r.property_id = ?"}) AS arrivals,
      (SELECT COUNT(*) FROM reservations r
        WHERE r.check_out BETWEEN ? AND ?
          AND r.lifecycle_status <> 'cancelled'
          ${filters.propertyId === null ? "" : "AND r.property_id = ?"}) AS departures,
      (SELECT COUNT(*) FROM reservations r
        WHERE r.lifecycle_status = 'confirmed'
          AND r.stay_status = 'checked_in'
          AND r.actual_check_out_at IS NULL
          ${filters.propertyId === null ? "" : "AND r.property_id = ?"}) AS checked_in
  `).get(
    ...propertyParameters,
    ...propertyParameters,
    filters.from,
    filters.to,
    ...(filters.propertyId === null ? [] : [filters.propertyId]),
    filters.from,
    filters.to,
    ...(filters.propertyId === null ? [] : [filters.propertyId]),
    ...propertyParameters,
  );
  const housekeeping = currentHousekeepingCounts(database, filters.propertyId);
  const billingTotals = issuedTotals(database, filters, "currency");
  const outstanding = outstandingTotals(database, filters.propertyId);

  return {
    filters,
    properties: properties.map((row) => ({
      id: numberValue(row.id),
      name: stringValue(row.name),
      status: stringValue(row.status),
    })),
    metrics: {
      activeProperties: numberValue(counts?.active_properties),
      activeUnits: numberValue(counts?.active_units),
      arrivals: numberValue(counts?.arrivals),
      departures: numberValue(counts?.departures),
      checkedInStays: numberValue(counts?.checked_in),
      dirtyUnits: housekeeping.dirty,
      cleaningUnits: housekeeping.cleaning,
      cleanUnits: housekeeping.clean,
      maintenanceUnits: housekeeping.maintenance,
      issuedInvoiceTotals: billingTotals.map(({ currency, totalCents }) => ({
        currency,
        totalCents,
      })),
      outstandingBalances: outstanding,
    },
    metricDefinitions: {
      arrivals: "Non-cancelled reservations by planned check-in date.",
      departures: "Non-cancelled reservations by planned check-out date.",
      checkedInStays: "Current confirmed stays with checked-in status and no actual check-out.",
      housekeeping: "Current unit status; not limited by the selected date range.",
      issuedInvoiceTotals: "Non-void invoice totals by invoice issue date; not money collected.",
      outstandingBalances: "Current balances on issued invoices, excluding void invoices.",
    },
  };
}

export function getReservationReport(database: PmsDatabase, filters: ReportFilters) {
  const statusRows = database.$client.prepare(`
    SELECT lifecycle_status AS status, COUNT(*) AS count
    FROM reservations
    WHERE check_in BETWEEN ? AND ?
      ${filters.propertyId === null ? "" : "AND property_id = ?"}
    GROUP BY lifecycle_status
  `).all(filters.from, filters.to, ...(filters.propertyId === null ? [] : [filters.propertyId]));
  const statusCounts = Object.fromEntries(
    reservationStatuses.map((status) => [status, 0]),
  ) as Record<(typeof reservationStatuses)[number], number>;
  for (const row of statusRows) {
    const status = stringValue(row.status);
    if (status in statusCounts) statusCounts[status as keyof typeof statusCounts] = numberValue(row.count);
  }

  const arrivalsByDate = groupCounts(database, `
    SELECT check_in AS date, COUNT(*) AS count
    FROM reservations
    WHERE check_in BETWEEN ? AND ? AND lifecycle_status <> 'cancelled'
      ${filters.propertyId === null ? "" : "AND property_id = ?"}
    GROUP BY check_in ORDER BY check_in
  `, filters);
  const departuresByDate = groupCounts(database, `
    SELECT check_out AS date, COUNT(*) AS count
    FROM reservations
    WHERE check_out BETWEEN ? AND ? AND lifecycle_status <> 'cancelled'
      ${filters.propertyId === null ? "" : "AND property_id = ?"}
    GROUP BY check_out ORDER BY check_out
  `, filters);
  const byProperty = database.$client.prepare(`
    SELECT p.id AS property_id, p.name AS property_name, COUNT(*) AS count
    FROM reservations r JOIN properties p ON p.id = r.property_id
    WHERE r.check_in BETWEEN ? AND ? AND r.lifecycle_status <> 'cancelled'
      ${filters.propertyId === null ? "" : "AND r.property_id = ?"}
    GROUP BY p.id, p.name ORDER BY p.name COLLATE NOCASE, p.id
  `).all(filters.from, filters.to, ...(filters.propertyId === null ? [] : [filters.propertyId]))
    .map((row) => ({
      propertyId: numberValue(row.property_id),
      propertyName: stringValue(row.property_name),
      count: numberValue(row.count),
    }));
  const byUnit = database.$client.prepare(`
    SELECT r.unit_id AS unit_id, p.name AS property_name, u.name AS unit_name,
      COUNT(*) AS count
    FROM reservations r
    JOIN properties p ON p.id = r.property_id
    JOIN units u ON u.id = r.unit_id
    WHERE r.check_in BETWEEN ? AND ? AND r.lifecycle_status <> 'cancelled'
      ${filters.propertyId === null ? "" : "AND r.property_id = ?"}
    GROUP BY r.unit_id, p.name, u.name
    ORDER BY p.name COLLATE NOCASE, u.name COLLATE NOCASE, r.unit_id
  `).all(filters.from, filters.to, ...(filters.propertyId === null ? [] : [filters.propertyId]))
    .map((row) => ({
      unitId: numberValue(row.unit_id),
      propertyName: stringValue(row.property_name),
      unitName: stringValue(row.unit_name),
      count: numberValue(row.count),
    }));

  return {
    filters,
    dateBasis: {
      statusCounts: "Planned check-in date; includes cancelled reservations.",
      arrivalsByDate: "Planned check-in date; excludes cancelled reservations.",
      departuresByDate: "Planned check-out date; excludes cancelled reservations.",
      byProperty: "Non-cancelled reservations grouped by planned check-in date.",
      byUnit: "Non-cancelled reservations with an assigned unit, grouped by planned check-in date.",
    },
    statusCounts,
    arrivalsByDate,
    departuresByDate,
    byProperty,
    byUnit,
  };
}

export function getOccupancyReport(database: PmsDatabase, filters: ReportFilters) {
  const propertySql = filters.propertyId === null ? "" : "AND p.id = ?";
  const propertyParameters = filters.propertyId === null ? [] : [filters.propertyId];
  const endExclusive = addCalendarDays(filters.to, 1);
  const eligibleUnits = database.$client.prepare(`
    SELECT COUNT(*) AS count
    FROM units u JOIN properties p ON p.id = u.property_id
    WHERE u.status = 'active' AND u.archived_at IS NULL AND p.status = 'active'
      ${propertySql}
  `).get(...propertyParameters);
  const totalEligibleUnits = numberValue(eligibleUnits?.count);
  const days = calendarDays(filters.from, filters.to);
  const occupancyByDate = new Map(days.map((date) => [date, new Set<number>()]));
  const reservations = database.$client.prepare(`
    WITH reservation_nights AS (
      SELECT r.unit_id, r.lifecycle_status,
        CASE
          WHEN r.actual_check_in_at IS NOT NULL
            AND r.stay_status IN ('checked_in', 'checked_out')
          THEN substr(r.actual_check_in_at, 1, 10)
          ELSE r.check_in
        END AS occupied_from,
        CASE
          WHEN r.actual_check_out_at IS NOT NULL AND r.stay_status = 'checked_out'
          THEN substr(r.actual_check_out_at, 1, 10)
          ELSE r.check_out
        END AS occupied_to
      FROM reservations r
    )
    SELECT r.unit_id, r.occupied_from, r.occupied_to
    FROM reservation_nights r
    JOIN units u ON u.id = r.unit_id
    JOIN properties p ON p.id = u.property_id
    WHERE r.unit_id IS NOT NULL AND r.occupied_from < ? AND r.occupied_to > ?
      AND r.lifecycle_status IN ('pending', 'confirmed', 'completed')
      AND u.status = 'active' AND u.archived_at IS NULL AND p.status = 'active'
      ${propertySql}
  `).all(endExclusive, filters.from, ...propertyParameters);

  for (const reservation of reservations) {
    const unitId = numberValue(reservation.unit_id);
    const start = stringValue(reservation.occupied_from);
    const end = stringValue(reservation.occupied_to);
    for (const date of days) {
      if (date >= start && date < end) occupancyByDate.get(date)?.add(unitId);
    }
  }

  const breakdown = days.map((date) => {
    const occupiedUnits = occupancyByDate.get(date)?.size ?? 0;
    return {
      date,
      eligibleUnits: totalEligibleUnits,
      occupiedUnits,
      availableUnits: totalEligibleUnits - occupiedUnits,
    };
  });
  const totalEligibleUnitNights = totalEligibleUnits * days.length;
  const occupiedUnitNights = breakdown.reduce((sum, day) => sum + day.occupiedUnits, 0);
  const occupancyPercentage = totalEligibleUnitNights === 0
    ? null
    : Math.round(occupiedUnitNights * 10_000 / totalEligibleUnitNights) / 100;

  return {
    filters,
    totalEligibleUnits,
    totalEligibleUnitNights,
    occupiedUnitNights,
    availableUnitNights: totalEligibleUnitNights - occupiedUnitNights,
    occupancyPercentage,
    breakdown,
    definition: "Eligible units are currently active, unarchived units at active properties. Nights are half-open [check-in, check-out); pending and confirmed reservations hold inventory under the existing availability rules, and completed reservations represent historical stays. Actual stay timestamps are used when present and planned dates otherwise; planned nights do not prove a guest arrived. Overlapping reservations count each unit-night once. Historical unit eligibility cannot be reconstructed, so current eligibility is applied to every selected date.",
  };
}

export function getHousekeepingReport(database: PmsDatabase, filters: ReportFilters) {
  const propertySql = filters.propertyId === null ? "" : "AND p.id = ?";
  const propertyParameters = filters.propertyId === null ? [] : [filters.propertyId];
  const rows = database.$client.prepare(`
    SELECT p.id AS property_id, p.name AS property_name,
      u.housekeeping_status, u.status AS operational_status,
      COUNT(*) AS count
    FROM units u JOIN properties p ON p.id = u.property_id
    WHERE u.archived_at IS NULL AND p.status = 'active' ${propertySql}
    GROUP BY p.id, p.name, u.housekeeping_status, u.status
    ORDER BY p.name COLLATE NOCASE, u.housekeeping_status, u.status
  `).all(...propertyParameters);
  const byProperty = new Map<number, {
    propertyId: number;
    propertyName: string;
    dirty: number;
    cleaning: number;
    clean: number;
    maintenance: number;
    inactive: number;
  }>();
  for (const row of rows) {
    const propertyId = numberValue(row.property_id);
    const property = byProperty.get(propertyId) ?? {
      propertyId,
      propertyName: stringValue(row.property_name),
      dirty: 0,
      cleaning: 0,
      clean: 0,
      maintenance: 0,
      inactive: 0,
    };
    const count = numberValue(row.count);
    const housekeepingStatus = stringValue(row.housekeeping_status);
    if (housekeepingStatus in property) {
      property[housekeepingStatus as "dirty" | "cleaning" | "clean"] += count;
    }
    const operationalStatus = stringValue(row.operational_status);
    if (operationalStatus === "maintenance") property.maintenance += count;
    if (operationalStatus === "inactive") property.inactive += count;
    byProperty.set(propertyId, property);
  }

  const completionRows = database.$client.prepare(`
    SELECT substr(u.last_cleaned_at, 1, 10) AS date, COUNT(*) AS count
    FROM units u JOIN properties p ON p.id = u.property_id
    WHERE u.last_cleaned_at IS NOT NULL
      AND substr(u.last_cleaned_at, 1, 10) BETWEEN ? AND ?
      AND u.archived_at IS NULL AND p.status = 'active'
      ${propertySql}
    GROUP BY substr(u.last_cleaned_at, 1, 10) ORDER BY date
  `).all(filters.from, filters.to, ...propertyParameters).map((row) => ({
    date: stringValue(row.date),
    count: numberValue(row.count),
  }));

  const totals = [...byProperty.values()].reduce((result, property) => ({
    dirty: result.dirty + property.dirty,
    cleaning: result.cleaning + property.cleaning,
    clean: result.clean + property.clean,
    maintenance: result.maintenance + property.maintenance,
    inactive: result.inactive + property.inactive,
  }), { dirty: 0, cleaning: 0, clean: 0, maintenance: 0, inactive: 0 });

  return {
    filters,
    current: totals,
    byProperty: [...byProperty.values()],
    lastRecordedCleaningsByDate: completionRows,
    dateBasis: "Housekeeping and operational status are current and independent of the selected period. Cleaning dates count units whose most recent last_cleaned_at timestamp falls in the selected period; earlier cleaning events are not stored, so this is not a complete cleaning history.",
  };
}

export function getBillingReport(database: PmsDatabase, filters: ReportFilters) {
  const issuedTotalsByCurrency = issuedTotals(database, filters, "currency");
  const issuedTotalsByProperty = issuedTotals(database, filters, "property");
  const paymentsByDate = database.$client.prepare(`
    SELECT i.currency, p.payment_date AS date, p.method,
      SUM(p.amount_cents) AS amount_cents, COUNT(*) AS payment_count
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    JOIN reservations r ON r.id = i.reservation_id
    WHERE p.payment_date BETWEEN ? AND ? AND i.status = 'issued'
      ${filters.propertyId === null ? "" : "AND r.property_id = ?"}
    GROUP BY i.currency, p.payment_date, p.method
    ORDER BY p.payment_date, i.currency, p.method
  `);
  paymentsByDate.setReadBigInts(true);
  const paymentsByDateRows = paymentsByDate.all(
    filters.from,
    filters.to,
    ...(filters.propertyId === null ? [] : [filters.propertyId]),
  ).map((row) => ({
    date: stringValue(row.date),
    currency: stringValue(row.currency),
    method: stringValue(row.method),
    paymentCount: numberValue(row.payment_count),
    amountCents: bigintString(row.amount_cents),
  }));

  const statusCountsStatement = database.$client.prepare(`
    WITH paid_by_invoice AS (
      SELECT invoice_id, SUM(amount_cents) AS paid_cents
      FROM payments GROUP BY invoice_id
    )
    SELECT i.status AS invoice_status,
      CASE
        WHEN i.status <> 'issued' THEN i.status
        WHEN COALESCE(p.paid_cents, 0) = 0 THEN 'issued'
        WHEN p.paid_cents < i.total_cents THEN 'partially_paid'
        ELSE 'paid'
      END AS report_status,
      COUNT(*) AS count
    FROM invoices i
    JOIN reservations r ON r.id = i.reservation_id
    LEFT JOIN paid_by_invoice p ON p.invoice_id = i.id
    WHERE 1 = 1 ${filters.propertyId === null ? "" : "AND r.property_id = ?"}
    GROUP BY i.status, report_status
  `);
  const statusCountsRows = statusCountsStatement.all(
    ...(filters.propertyId === null ? [] : [filters.propertyId]),
  );
  const invoiceStatusCounts: Record<string, number> = {
    draft: 0,
    issued: 0,
    partially_paid: 0,
    paid: 0,
    void: 0,
  };
  for (const row of statusCountsRows) {
    invoiceStatusCounts[stringValue(row.report_status)] = numberValue(row.count);
  }

  const outstandingStatement = database.$client.prepare(`
    WITH paid_by_invoice AS (
      SELECT invoice_id, SUM(amount_cents) AS paid_cents
      FROM payments GROUP BY invoice_id
    )
    SELECT i.id, i.invoice_number, i.issue_date, i.currency, i.total_cents,
      COALESCE(p.paid_cents, 0) AS paid_cents, i.total_cents - COALESCE(p.paid_cents, 0) AS balance_cents,
      r.id AS reservation_id, r.reservation_reference,
      property.name AS property_name, u.name AS unit_name,
      CASE
        WHEN COALESCE(p.paid_cents, 0) = 0 THEN 'issued'
        ELSE 'partially_paid'
      END AS report_status
    FROM invoices i
    JOIN reservations r ON r.id = i.reservation_id
    JOIN properties property ON property.id = r.property_id
    LEFT JOIN units u ON u.id = r.unit_id
    LEFT JOIN paid_by_invoice p ON p.invoice_id = i.id
    WHERE i.status = 'issued' AND i.total_cents > COALESCE(p.paid_cents, 0)
      ${filters.propertyId === null ? "" : "AND r.property_id = ?"}
    ORDER BY i.issue_date, i.id LIMIT 251
  `);
  outstandingStatement.setReadBigInts(true);
  const outstandingRows = outstandingStatement.all(
    ...(filters.propertyId === null ? [] : [filters.propertyId]),
  );
  const outstandingInvoices = outstandingRows.slice(0, 250).map((row) => ({
    id: numberValue(row.id),
    invoiceNumber: stringValue(row.invoice_number),
    reservationId: numberValue(row.reservation_id),
    reservationReference: stringValue(row.reservation_reference),
    propertyName: stringValue(row.property_name),
    unitName: nullableStringValue(row.unit_name),
    issueDate: stringValue(row.issue_date),
    currency: stringValue(row.currency),
    status: stringValue(row.report_status),
    totalCents: bigintString(row.total_cents),
    paidCents: bigintString(row.paid_cents),
    balanceCents: bigintString(row.balance_cents),
  }));

  const outstandingTotalsByCurrency = outstandingTotals(database, filters.propertyId);

  return {
    filters,
    dateBasis: {
      issuedInvoiceTotals: "Invoice issue_date, for non-void issued invoices; not reservation creation date and not collected money.",
      payments: "Payment payment_date, grouped by currency and method. Payment records are bookkeeping entries.",
      invoiceStatusCounts: "Current invoice/payment-derived status for all invoices, independent of the selected date range.",
      outstandingBalances: "Current issued invoice totals less recorded payments, excluding void and draft invoices; independent of the selected date range.",
    },
    issuedTotalsByCurrency,
    issuedTotalsByProperty,
    paymentsByDate: paymentsByDateRows,
    invoiceStatusCounts,
    outstandingTotalsByCurrency,
    outstandingInvoices,
    outstandingInvoicesTruncated: outstandingRows.length > 250,
  };
}

function currentHousekeepingCounts(
  database: PmsDatabase,
  propertyId: number | null,
) {
  const propertySql = propertyId === null ? "" : "AND p.id = ?";
  const row = database.$client.prepare(`
    SELECT
      SUM(CASE WHEN u.housekeeping_status = 'dirty' THEN 1 ELSE 0 END) AS dirty,
      SUM(CASE WHEN u.housekeeping_status = 'cleaning' THEN 1 ELSE 0 END) AS cleaning,
      SUM(CASE WHEN u.housekeeping_status = 'clean' THEN 1 ELSE 0 END) AS clean,
      SUM(CASE WHEN u.status = 'maintenance' THEN 1 ELSE 0 END) AS maintenance
    FROM units u JOIN properties p ON p.id = u.property_id
    WHERE u.archived_at IS NULL AND p.status = 'active' ${propertySql}
  `).get(...(propertyId === null ? [] : [propertyId]));
  return {
    dirty: numberValue(row?.dirty ?? 0),
    cleaning: numberValue(row?.cleaning ?? 0),
    clean: numberValue(row?.clean ?? 0),
    maintenance: numberValue(row?.maintenance ?? 0),
  };
}

function issuedTotals(
  database: PmsDatabase,
  filters: ReportFilters,
  group: "currency" | "property",
) {
  const grouping = group === "currency"
    ? "i.currency"
    : "r.property_id, property.name, i.currency";
  const selected = group === "currency"
    ? "i.currency AS currency"
    : "r.property_id AS property_id, property.name AS property_name, i.currency AS currency";
  const statement = database.$client.prepare(`
    SELECT ${selected}, SUM(i.total_cents) AS total_cents, COUNT(*) AS invoice_count
    FROM invoices i
    JOIN reservations r ON r.id = i.reservation_id
    JOIN properties property ON property.id = r.property_id
    WHERE i.status = 'issued' AND i.issue_date BETWEEN ? AND ?
      ${filters.propertyId === null ? "" : "AND r.property_id = ?"}
    GROUP BY ${grouping}
    ORDER BY ${group === "property" ? "property.name COLLATE NOCASE, " : ""}i.currency
  `);
  statement.setReadBigInts(true);
  return statement.all(
    filters.from,
    filters.to,
    ...(filters.propertyId === null ? [] : [filters.propertyId]),
  ).map((row) => ({
    ...(group === "property"
      ? {
        propertyId: numberValue(row.property_id),
        propertyName: stringValue(row.property_name),
      }
      : {}),
    currency: stringValue(row.currency),
    totalCents: bigintString(row.total_cents),
    invoiceCount: numberValue(row.invoice_count),
  }));
}

function outstandingTotals(database: PmsDatabase, propertyId: number | null) {
  const propertySql = propertyId === null ? "" : "AND r.property_id = ?";
  const statement = database.$client.prepare(`
    WITH paid_by_invoice AS (
      SELECT invoice_id, SUM(amount_cents) AS paid_cents
      FROM payments GROUP BY invoice_id
    )
    SELECT i.currency, SUM(i.total_cents - COALESCE(p.paid_cents, 0)) AS balance_cents
    FROM invoices i
    JOIN reservations r ON r.id = i.reservation_id
    LEFT JOIN paid_by_invoice p ON p.invoice_id = i.id
    WHERE i.status = 'issued' AND i.total_cents > COALESCE(p.paid_cents, 0)
      ${propertySql}
    GROUP BY i.currency ORDER BY i.currency
  `);
  statement.setReadBigInts(true);
  return statement.all(...(propertyId === null ? [] : [propertyId])).map((row) => ({
    currency: stringValue(row.currency),
    balanceCents: bigintString(row.balance_cents),
  }));
}

function groupCounts(database: PmsDatabase, query: string, filters: ReportFilters) {
  return database.$client.prepare(query)
    .all(filters.from, filters.to, ...(filters.propertyId === null ? [] : [filters.propertyId]))
    .map((row) => ({
      date: stringValue(row.date),
      count: numberValue(row.count),
    }));
}

function calendarDays(from: string, to: string): string[] {
  const days: string[] = [];
  const current = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (current <= end) {
    days.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return days;
}

function addCalendarDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  throw new Error("Database returned an invalid report count.");
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  throw new Error("Database returned invalid report text.");
}

function nullableStringValue(value: unknown): string | null {
  if (value === null) return null;
  return stringValue(value);
}

function bigintString(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value).toString();
  throw new Error("Database returned an invalid monetary report value.");
}
