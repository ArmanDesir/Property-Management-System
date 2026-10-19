import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { PmsDatabase } from "../db/connection.js";
import { HttpError } from "../middleware/http-errors.js";
import { withImmediateTransaction } from "./reservations.js";

export const maintenanceCategories = [
  "plumbing",
  "electrical",
  "hvac",
  "appliance",
  "furniture",
  "structural",
  "cleaning_related",
  "other",
] as const;
export type MaintenanceCategory = (typeof maintenanceCategories)[number];

export const maintenancePriorities = ["low", "normal", "high", "urgent"] as const;
export type MaintenancePriority = (typeof maintenancePriorities)[number];

export const maintenanceStatuses = [
  "open",
  "in_progress",
  "awaiting_parts",
  "completed",
  "cancelled",
] as const;
export type MaintenanceStatus = (typeof maintenanceStatuses)[number];

export interface MaintenanceDraft {
  propertyId: number;
  unitId: number | null;
  title: string;
  description: string;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  reportedAt: string | null;
  targetCompletionDate: string | null;
  assignedStaffId: number | null;
}

export interface MaintenanceFilters {
  search: string;
  propertyId: number | null;
  allowedPropertyIds?: number[];
  unitId: number | null;
  assignedStaffId: number | null;
  status: MaintenanceStatus | "all";
  priority: MaintenancePriority | "all";
  category: MaintenanceCategory | "all";
  overdue: boolean;
  sort: "updated" | "reported" | "target" | "priority";
  order: "asc" | "desc";
  limit: number;
  offset: number;
}

const statusTransitions: Record<MaintenanceStatus, readonly MaintenanceStatus[]> = {
  open: ["in_progress", "cancelled"],
  in_progress: ["awaiting_parts", "completed", "cancelled"],
  awaiting_parts: ["in_progress", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function createMaintenanceRequest(
  database: PmsDatabase,
  draft: MaintenanceDraft,
  staffId: number,
  allowedPropertyIds?: number[],
  now = new Date(),
) {
  return withImmediateTransaction(database, (client) => {
    assertAllowedProperty(draft.propertyId, allowedPropertyIds);
    validateReferences(client, draft);
    const reportedAt = draft.reportedAt ?? now.toISOString();
    const requestCode = `MNT-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const result = client.prepare(`
      INSERT INTO maintenance_requests (
        request_code, property_id, unit_id, title, description, category,
        priority, status, reported_at, target_completion_date, assigned_staff_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
    `).run(
      requestCode,
      draft.propertyId,
      draft.unitId,
      draft.title,
      draft.description,
      draft.category,
      draft.priority,
      reportedAt,
      draft.targetCompletionDate,
      draft.assignedStaffId,
      now.toISOString(),
      now.toISOString(),
    );
    const id = numberValue(result.lastInsertRowid);
    client.prepare(`
      INSERT INTO maintenance_history
        (request_id, from_status, to_status, changed_by_staff_id, note, changed_at)
      VALUES (?, NULL, 'open', ?, 'Request created', ?)
    `).run(id, staffId, now.toISOString());
    return getMaintenanceRequest(database, id);
  });
}

export function updateMaintenanceRequest(
  database: PmsDatabase,
  id: number,
  draft: Omit<MaintenanceDraft, "reportedAt">,
  allowedPropertyIds?: number[],
  now = new Date(),
) {
  return withImmediateTransaction(database, (client) => {
    const existing = client.prepare(`
      SELECT id, status, property_id FROM maintenance_requests WHERE id = ?
    `).get(id);
    if (!existing) throw new HttpError(404, "Maintenance request not found.");
    assertAllowedProperty(numberValue(existing.property_id), allowedPropertyIds);
    assertAllowedProperty(draft.propertyId, allowedPropertyIds);
    const status = statusValue(existing.status);
    if (status === "completed" || status === "cancelled") {
      throw new HttpError(409, "Completed or cancelled maintenance requests cannot be edited.");
    }
    validateReferences(client, { ...draft, reportedAt: null });
    client.prepare(`
      UPDATE maintenance_requests
      SET property_id = ?, unit_id = ?, title = ?, description = ?, category = ?,
        priority = ?, target_completion_date = ?, assigned_staff_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      draft.propertyId,
      draft.unitId,
      draft.title,
      draft.description,
      draft.category,
      draft.priority,
      draft.targetCompletionDate,
      draft.assignedStaffId,
      now.toISOString(),
      id,
    );
    return getMaintenanceRequest(database, id);
  });
}

export function transitionMaintenanceRequest(
  database: PmsDatabase,
  id: number,
  nextStatus: MaintenanceStatus,
  staffId: number,
  note: string | null,
  allowedPropertyIds?: number[],
  now = new Date(),
) {
  return withImmediateTransaction(database, (client) => {
    const existing = client.prepare(`
      SELECT id, status, property_id FROM maintenance_requests WHERE id = ?
    `).get(id);
    if (!existing) throw new HttpError(404, "Maintenance request not found.");
    assertAllowedProperty(numberValue(existing.property_id), allowedPropertyIds);
    const currentStatus = statusValue(existing.status);
    if (!statusTransitions[currentStatus].includes(nextStatus)) {
      throw new HttpError(
        409,
        `Maintenance request cannot move from ${currentStatus} to ${nextStatus}.`,
      );
    }
    const completedAt = nextStatus === "completed" ? now.toISOString() : null;
    client.prepare(`
      UPDATE maintenance_requests
      SET status = ?, completed_at = ?, resolution_notes = COALESCE(?, resolution_notes),
        updated_at = ?
      WHERE id = ?
    `).run(nextStatus, completedAt, note, now.toISOString(), id);
    client.prepare(`
      INSERT INTO maintenance_history
        (request_id, from_status, to_status, changed_by_staff_id, note, changed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, currentStatus, nextStatus, staffId, note, now.toISOString());
    return getMaintenanceRequest(database, id);
  });
}

export function listMaintenanceRequests(
  database: PmsDatabase,
  filters: MaintenanceFilters,
  today = new Date().toISOString().slice(0, 10),
) {
  const conditions: string[] = [];
  const params: SQLInputValue[] = [];
  if (filters.search) {
    const search = `%${filters.search}%`;
    conditions.push(`(
      r.request_code LIKE ? OR r.title LIKE ? OR r.description LIKE ? OR
      p.name LIKE ? OR COALESCE(u.name, '') LIKE ?
    )`);
    params.push(search, search, search, search, search);
  }
  if (filters.propertyId !== null) {
    conditions.push("r.property_id = ?");
    params.push(filters.propertyId);
  }
  if (filters.allowedPropertyIds !== undefined) {
    if (filters.allowedPropertyIds.length === 0) {
      conditions.push("0 = 1");
    } else {
      conditions.push(
        `r.property_id IN (${filters.allowedPropertyIds.map(() => "?").join(", ")})`,
      );
      params.push(...filters.allowedPropertyIds);
    }
  }
  if (filters.unitId !== null) {
    conditions.push("r.unit_id = ?");
    params.push(filters.unitId);
  }
  if (filters.assignedStaffId !== null) {
    conditions.push("r.assigned_staff_id = ?");
    params.push(filters.assignedStaffId);
  }
  if (filters.status !== "all") {
    conditions.push("r.status = ?");
    params.push(filters.status);
  }
  if (filters.priority !== "all") {
    conditions.push("r.priority = ?");
    params.push(filters.priority);
  }
  if (filters.category !== "all") {
    conditions.push("r.category = ?");
    params.push(filters.category);
  }
  if (filters.overdue) {
    conditions.push("r.status IN ('open', 'in_progress', 'awaiting_parts') AND r.target_completion_date < ?");
    params.push(today);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const count = database.$client.prepare(`
    SELECT COUNT(*) AS count
    FROM maintenance_requests r
    JOIN properties p ON p.id = r.property_id
    LEFT JOIN units u ON u.id = r.unit_id${where}
  `).get(...params);
  const sortColumns = {
    updated: "r.updated_at",
    reported: "r.reported_at",
    target: "r.target_completion_date",
    priority: "CASE r.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END",
  } as const;
  const records = database.$client.prepare(`
    ${requestSelect}${where}
    ORDER BY ${sortColumns[filters.sort]} ${filters.order.toUpperCase()}, r.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, filters.limit, filters.offset);
  return {
    requests: records.map(toRequest),
    total: numberValue(count?.count),
    limit: filters.limit,
    offset: filters.offset,
  };
}

export function getMaintenanceRequest(
  database: PmsDatabase,
  id: number,
  allowedPropertyIds?: number[],
) {
  const scope = allowedPropertyIds === undefined
    ? ""
    : allowedPropertyIds.length
      ? ` AND r.property_id IN (${allowedPropertyIds.map(() => "?").join(", ")})`
      : " AND 0 = 1";
  const row = database.$client.prepare(`${requestSelect} WHERE r.id = ?${scope}`)
    .get(id, ...(allowedPropertyIds ?? []));
  if (!row) throw new HttpError(404, "Maintenance request not found.");
  const history = database.$client.prepare(`
    SELECT h.id, h.from_status, h.to_status, h.note, h.changed_at,
      s.id AS staff_id, s.display_name AS staff_name
    FROM maintenance_history h
    LEFT JOIN staff_accounts s ON s.id = h.changed_by_staff_id
    WHERE h.request_id = ?
    ORDER BY h.changed_at, h.id
  `).all(id).map((entry) => ({
    id: numberValue(entry.id),
    fromStatus: nullableStatusValue(entry.from_status),
    toStatus: statusValue(entry.to_status),
    note: nullableString(entry.note),
    changedAt: stringValue(entry.changed_at),
    staff: entry.staff_id === null
      ? null
      : { id: numberValue(entry.staff_id), displayName: stringValue(entry.staff_name) },
  }));
  return { ...toRequest(row), history };
}

export function getMaintenanceDashboard(
  database: PmsDatabase,
  today = new Date().toISOString().slice(0, 10),
  allowedPropertyIds?: number[],
) {
  const scope = allowedPropertyIds === undefined
    ? { where: "", params: [] as number[] }
    : allowedPropertyIds.length
      ? {
        where: ` WHERE property_id IN (${allowedPropertyIds.map(() => "?").join(", ")})`,
        params: allowedPropertyIds,
      }
      : { where: " WHERE 0 = 1", params: [] as number[] };
  const totals = database.$client.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status IN ('open', 'in_progress', 'awaiting_parts') THEN 1 ELSE 0 END), 0) AS open_count,
      COALESCE(SUM(CASE WHEN status IN ('open', 'in_progress', 'awaiting_parts') AND priority IN ('urgent', 'high') THEN 1 ELSE 0 END), 0) AS high_priority_count,
      COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) AS in_progress_count,
      COALESCE(SUM(CASE WHEN status = 'awaiting_parts' THEN 1 ELSE 0 END), 0) AS awaiting_parts_count,
      COALESCE(SUM(CASE WHEN status IN ('open', 'in_progress', 'awaiting_parts') AND target_completion_date < ? THEN 1 ELSE 0 END), 0) AS overdue_count
    FROM maintenance_requests${scope.where}
  `).get(today, ...scope.params);
  const byStatus = groupCounts(database, "status", allowedPropertyIds);
  const byPriority = groupCounts(database, "priority", allowedPropertyIds);
  const byProperty = database.$client.prepare(`
    SELECT p.id AS property_id, p.name AS property_name, r.status, COUNT(*) AS count
    FROM maintenance_requests r JOIN properties p ON p.id = r.property_id
    ${allowedPropertyIds === undefined ? "" : allowedPropertyIds.length
      ? `WHERE r.property_id IN (${allowedPropertyIds.map(() => "?").join(", ")})`
      : "WHERE 0 = 1"}
    GROUP BY p.id, p.name, r.status ORDER BY p.name COLLATE NOCASE, r.status
  `).all(...(allowedPropertyIds ?? [])).map((row) => ({
    propertyId: numberValue(row.property_id),
    propertyName: stringValue(row.property_name),
    status: statusValue(row.status),
    count: numberValue(row.count),
  }));
  const recentlyCompleted = database.$client.prepare(`
    ${requestSelect}
    WHERE r.status = 'completed'${allowedPropertyIds === undefined ? "" : allowedPropertyIds.length
      ? ` AND r.property_id IN (${allowedPropertyIds.map(() => "?").join(", ")})`
      : " AND 0 = 1"}
    ORDER BY r.completed_at DESC, r.id DESC LIMIT 10
  `).all(...(allowedPropertyIds ?? [])).map(toRequest);
  return {
    asOfDate: today,
    current: {
      open: numberValue(totals?.open_count),
      highPriority: numberValue(totals?.high_priority_count),
      inProgress: numberValue(totals?.in_progress_count),
      awaitingParts: numberValue(totals?.awaiting_parts_count),
      overdue: numberValue(totals?.overdue_count),
    },
    byStatus,
    byPriority,
    byProperty,
    recentlyCompleted,
  };
}

const requestSelect = `
  SELECT r.id, r.request_code, r.property_id, p.name AS property_name,
    r.unit_id, u.name AS unit_name, r.title, r.description, r.category,
    r.priority, r.status, r.reported_at, r.target_completion_date,
    r.assigned_staff_id, s.display_name AS assigned_staff_name,
    r.completed_at, r.resolution_notes, r.created_at, r.updated_at
  FROM maintenance_requests r
  JOIN properties p ON p.id = r.property_id
  LEFT JOIN units u ON u.id = r.unit_id
  LEFT JOIN staff_accounts s ON s.id = r.assigned_staff_id`;

function groupCounts(
  database: PmsDatabase,
  field: "status" | "priority",
  allowedPropertyIds?: number[],
) {
  const scope = allowedPropertyIds === undefined
    ? { where: "", params: [] as number[] }
    : allowedPropertyIds.length
      ? {
        where: ` WHERE property_id IN (${allowedPropertyIds.map(() => "?").join(", ")})`,
        params: allowedPropertyIds,
      }
      : { where: " WHERE 0 = 1", params: [] as number[] };
  return database.$client.prepare(`
    SELECT ${field} AS value, COUNT(*) AS count
    FROM maintenance_requests${scope.where} GROUP BY ${field} ORDER BY ${field}
  `).all(...scope.params).map((row) => ({ value: stringValue(row.value), count: numberValue(row.count) }));
}

function assertAllowedProperty(propertyId: number, allowedPropertyIds?: number[]): void {
  if (allowedPropertyIds !== undefined && !allowedPropertyIds.includes(propertyId)) {
    throw new HttpError(404, "Maintenance request not found.");
  }
}

function validateReferences(client: DatabaseSync, draft: MaintenanceDraft): void {
  const property = client.prepare(
    "SELECT id, status FROM properties WHERE id = ?",
  ).get(draft.propertyId);
  if (!property) throw new HttpError(404, "Property not found.");
  if (property.status !== "active") {
    throw new HttpError(409, "Maintenance requests require an active property.");
  }
  if (draft.unitId !== null) {
    const unit = client.prepare(`
      SELECT id FROM units
      WHERE id = ? AND property_id = ? AND archived_at IS NULL
    `).get(draft.unitId, draft.propertyId);
    if (!unit) {
      throw new HttpError(400, "Unit must be an unarchived unit belonging to the selected property.");
    }
  }
  if (draft.assignedStaffId !== null) {
    const staff = client.prepare(
      "SELECT id FROM staff_accounts WHERE id = ? AND is_active = 1",
    ).get(draft.assignedStaffId);
    if (!staff) throw new HttpError(400, "Assigned staff member must be active.");
  }
}

function toRequest(row: Record<string, unknown>) {
  return {
    id: numberValue(row.id),
    requestCode: stringValue(row.request_code),
    propertyId: numberValue(row.property_id),
    propertyName: stringValue(row.property_name),
    unitId: row.unit_id === null ? null : numberValue(row.unit_id),
    unitName: nullableString(row.unit_name),
    title: stringValue(row.title),
    description: stringValue(row.description),
    category: categoryValue(row.category),
    priority: priorityValue(row.priority),
    status: statusValue(row.status),
    reportedAt: stringValue(row.reported_at),
    targetCompletionDate: nullableString(row.target_completion_date),
    assignedStaffId: row.assigned_staff_id === null ? null : numberValue(row.assigned_staff_id),
    assignedStaffName: nullableString(row.assigned_staff_name),
    completedAt: nullableString(row.completed_at),
    resolutionNotes: nullableString(row.resolution_notes),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
  };
}

function categoryValue(value: unknown): MaintenanceCategory {
  if (typeof value === "string" && maintenanceCategories.includes(value as MaintenanceCategory)) {
    return value as MaintenanceCategory;
  }
  throw new Error("Database returned an invalid maintenance category.");
}

function priorityValue(value: unknown): MaintenancePriority {
  if (typeof value === "string" && maintenancePriorities.includes(value as MaintenancePriority)) {
    return value as MaintenancePriority;
  }
  throw new Error("Database returned an invalid maintenance priority.");
}

function statusValue(value: unknown): MaintenanceStatus {
  if (typeof value === "string" && maintenanceStatuses.includes(value as MaintenanceStatus)) {
    return value as MaintenanceStatus;
  }
  throw new Error("Database returned an invalid maintenance status.");
}

function nullableStatusValue(value: unknown): MaintenanceStatus | null {
  return value === null ? null : statusValue(value);
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  throw new Error("Database returned an invalid maintenance numeric value.");
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  throw new Error("Database returned an invalid maintenance text value.");
}

function nullableString(value: unknown): string | null {
  return value === null ? null : stringValue(value);
}
