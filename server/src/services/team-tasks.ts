import type { PmsDatabase } from "../db/connection.js";
import { HttpError } from "../middleware/http-errors.js";
import type { AuthenticatedStaff, StaffRole } from "./auth.js";
import { withImmediateTransaction } from "./reservations.js";

export const taskStatuses = [
  "pending",
  "in_progress",
  "submitted",
  "completed",
  "rejected",
  "cancelled",
] as const;
export type TeamTaskStatus = (typeof taskStatuses)[number];
export const taskPriorities = ["low", "normal", "high", "urgent"] as const;
export type TeamTaskPriority = (typeof taskPriorities)[number];
export const taskDepartments = ["front_desk", "housekeeping", "accounting"] as const;
export type TaskDepartment = (typeof taskDepartments)[number];

export interface TeamTaskDraft {
  propertyId: number;
  unitId: number | null;
  reservationId: number | null;
  title: string;
  description: string;
  department: TaskDepartment;
  assignedStaffId: number;
  priority: TeamTaskPriority;
  dueDate: string | null;
  dueTime: string | null;
}

export interface TeamTaskFilters {
  status: TeamTaskStatus | "all";
  priority: TeamTaskPriority | "all";
  department: TaskDepartment | "all";
  propertyId: number | null;
  assignedStaffId: number | null;
  dueFrom: string | null;
  dueTo: string | null;
  limit: number;
  offset: number;
}

const taskSelect = `
  SELECT t.id, t.property_id, p.name AS property_name, t.unit_id, u.name AS unit_name,
    t.reservation_id, r.reservation_reference, t.title, t.description, t.department,
    t.assigned_staff_id, assigned.display_name AS assigned_name,
    t.created_by_staff_id, creator.display_name AS creator_name,
    t.priority, t.status, t.due_date, t.due_time, t.completion_note,
    t.created_at, t.updated_at
  FROM team_tasks t
  JOIN properties p ON p.id = t.property_id
  LEFT JOIN units u ON u.id = t.unit_id
  LEFT JOIN reservations r ON r.id = t.reservation_id
  JOIN staff_accounts assigned ON assigned.id = t.assigned_staff_id
  JOIN staff_accounts creator ON creator.id = t.created_by_staff_id`;

export function listTaskProperties(database: PmsDatabase, actor: AuthenticatedStaff) {
  if (actor.role === "administrator") {
    return database.$client.prepare(`
      SELECT id, name, property_type AS propertyType FROM properties WHERE status = 'active'
      ORDER BY name COLLATE NOCASE, id
    `).all();
  }
  if (actor.role !== "property_manager") return [];
  return database.$client.prepare(`
    SELECT p.id, p.name, p.property_type AS propertyType
    FROM property_manager_properties a
    JOIN properties p ON p.id = a.property_id
    WHERE a.staff_id = ? AND p.status = 'active'
    ORDER BY p.name COLLATE NOCASE, p.id
  `).all(actor.id);
}

export function getTaskOptions(
  database: PmsDatabase,
  actor: AuthenticatedStaff,
  propertyId: number | null,
) {
  if (actor.role !== "administrator" && actor.role !== "property_manager") {
    throw new HttpError(403, "Only managers can assign team tasks.");
  }
  const properties = listTaskProperties(database, actor);
  const authorizedIds = properties.map((property) => numberValue(property.id));
  const selected = propertyId === null ? authorizedIds : [propertyId];
  if (selected.some((id) => !authorizedIds.includes(id))) {
    throw new HttpError(404, "Property not found.");
  }
  if (selected.length === 0) return { properties, staff: [], units: [], reservations: [] };
  const marks = selected.map(() => "?").join(", ");
  const staff = database.$client.prepare(`
    SELECT id, display_name, role FROM staff_accounts
    WHERE is_active = 1 AND role IN ('front_desk', 'housekeeping', 'accounting')
    ORDER BY display_name COLLATE NOCASE, id
  `).all().map((row) => ({
    id: numberValue(row.id),
    displayName: textValue(row.display_name),
    department: textValue(row.role),
  }));
  const units = database.$client.prepare(`
    SELECT id, property_id, name, unit_type FROM units
    WHERE property_id IN (${marks}) AND status = 'active' AND archived_at IS NULL
    ORDER BY property_id, name COLLATE NOCASE, id
  `).all(...selected).map((row) => ({
    id: numberValue(row.id),
    propertyId: numberValue(row.property_id),
    name: textValue(row.name),
    unitType: textValue(row.unit_type),
  }));
  const reservations = database.$client.prepare(`
    SELECT id, property_id, unit_id, reservation_reference, check_in, check_out
    FROM reservations
    WHERE property_id IN (${marks}) AND lifecycle_status IN ('pending', 'confirmed')
    ORDER BY check_in, id
  `).all(...selected).map((row) => ({
    id: numberValue(row.id),
    propertyId: numberValue(row.property_id),
    unitId: nullableNumber(row.unit_id),
    reservationReference: textValue(row.reservation_reference),
    checkIn: textValue(row.check_in),
    checkOut: textValue(row.check_out),
  }));
  return { properties, staff, units, reservations };
}

export function createTeamTask(
  database: PmsDatabase,
  actor: AuthenticatedStaff,
  draft: TeamTaskDraft,
  now = new Date(),
) {
  return withImmediateTransaction(database, (client) => {
    assertManagerProperty(client, actor, draft.propertyId);
    validateTaskReferences(client, draft);
    const timestamp = now.toISOString();
    const result = client.prepare(`
      INSERT INTO team_tasks (
        property_id, unit_id, reservation_id, title, description, department,
        assigned_staff_id, created_by_staff_id, priority, due_date, due_time,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      draft.propertyId,
      draft.unitId,
      draft.reservationId,
      draft.title,
      draft.description,
      draft.department,
      draft.assignedStaffId,
      actor.id,
      draft.priority,
      draft.dueDate,
      draft.dueTime,
      timestamp,
      timestamp,
    );
    const taskId = numberValue(result.lastInsertRowid);
    addActivity(client, taskId, actor.id, "created", "Task created and assigned.");
    return getTaskForActor(database, actor, taskId);
  });
}

export function listTeamTasks(
  database: PmsDatabase,
  actor: AuthenticatedStaff,
  filters: TeamTaskFilters,
  today = new Date().toISOString().slice(0, 10),
) {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (actor.role === "property_manager") {
    const ids = listTaskProperties(database, actor).map((row) => numberValue(row.id));
    if (!ids.length) return { tasks: [], total: 0, limit: filters.limit, offset: filters.offset };
    clauses.push(`t.property_id IN (${ids.map(() => "?").join(", ")})`);
    values.push(...ids);
  } else if (actor.role !== "administrator") {
    clauses.push("t.assigned_staff_id = ?");
    values.push(actor.id);
  }
  if (filters.status !== "all") {
    clauses.push("t.status = ?");
    values.push(filters.status);
  }
  if (filters.priority !== "all") {
    clauses.push("t.priority = ?");
    values.push(filters.priority);
  }
  if (filters.department !== "all") {
    clauses.push("t.department = ?");
    values.push(filters.department);
  }
  if (filters.propertyId !== null) {
    assertManagerRole(actor);
    assertManagerProperty(database.$client, actor, filters.propertyId);
    clauses.push("t.property_id = ?");
    values.push(filters.propertyId);
  }
  if (filters.assignedStaffId !== null) {
    assertManagerRole(actor);
    clauses.push("t.assigned_staff_id = ?");
    values.push(filters.assignedStaffId);
  }
  if (filters.dueFrom !== null) {
    clauses.push("t.due_date >= ?");
    values.push(filters.dueFrom);
  }
  if (filters.dueTo !== null) {
    clauses.push("t.due_date <= ?");
    values.push(filters.dueTo);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const count = database.$client.prepare(`
    SELECT COUNT(*) AS count FROM team_tasks t ${where}
  `).get(...values);
  const tasks = database.$client.prepare(`
    ${taskSelect} ${where}
    ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
      t.due_date, CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3
        WHEN 'normal' THEN 2 ELSE 1 END DESC, t.id DESC
    LIMIT ? OFFSET ?
  `).all(...values, filters.limit, filters.offset)
    .map((row) => taskRecord(row, today));
  return { tasks, total: numberValue(count?.count), limit: filters.limit, offset: filters.offset };
}

export function getTaskForActor(
  database: PmsDatabase,
  actor: AuthenticatedStaff,
  taskId: number,
  today = new Date().toISOString().slice(0, 10),
) {
  const row = database.$client.prepare(`${taskSelect} WHERE t.id = ?`).get(taskId);
  if (!row || !canViewTask(database, actor, numberValue(row.property_id), numberValue(row.assigned_staff_id))) {
    throw new HttpError(404, "Task not found.");
  }
  const activity = database.$client.prepare(`
    SELECT h.id, h.event_type, h.description, h.created_at, s.display_name AS actor_name
    FROM team_task_activity h
    LEFT JOIN staff_accounts s ON s.id = h.actor_staff_id
    WHERE h.task_id = ? ORDER BY h.created_at, h.id
  `).all(taskId).map((event) => ({
    id: numberValue(event.id),
    eventType: textValue(event.event_type),
    description: textValue(event.description),
    createdAt: textValue(event.created_at),
    actorName: nullableTextValue(event.actor_name),
  }));
  return { ...taskRecord(row, today), activity };
}

export function transitionTeamTask(
  database: PmsDatabase,
  actor: AuthenticatedStaff,
  taskId: number,
  nextStatus: TeamTaskStatus,
  note: string | null,
  now = new Date(),
) {
  return withImmediateTransaction(database, (client) => {
    const task = client.prepare(`
      SELECT id, property_id, assigned_staff_id, created_by_staff_id, status, completion_note
      FROM team_tasks WHERE id = ?
    `).get(taskId);
    if (!task || !canViewTask(database, actor, numberValue(task.property_id), numberValue(task.assigned_staff_id))) {
      throw new HttpError(404, "Task not found.");
    }
    const current = textValue(task.status) as TeamTaskStatus;
    const assignee = numberValue(task.assigned_staff_id);
    const isManager = actor.role === "administrator" ||
      (actor.role === "property_manager" && isManagerProperty(database, actor.id, numberValue(task.property_id)));
    let eventType: string;
    let description: string;
    if (nextStatus === "cancelled") {
      if (!isManager) throw new HttpError(403, "Only a manager can cancel a task.");
      if (current === "completed" || current === "cancelled") {
        throw new HttpError(409, "Completed or cancelled tasks cannot be cancelled.");
      }
      eventType = "cancelled";
      description = "Task cancelled by a manager.";
    } else if (nextStatus === "in_progress") {
      if (actor.id !== assignee || !["pending", "rejected"].includes(current)) {
        throw new HttpError(409, "Only the assigned staff member can start or resume this task.");
      }
      eventType = "status_changed";
      description = current === "rejected" ? "Task returned to in progress for correction." : "Task started.";
    } else if (nextStatus === "submitted") {
      if (actor.id !== assignee || current !== "in_progress") {
        throw new HttpError(409, "Only the assigned staff member can submit an in-progress task.");
      }
      if (!note) throw new HttpError(400, "Add a completion note before submitting for review.");
      eventType = "submitted";
      description = `Submitted for review: ${note}`;
    } else if (nextStatus === "completed" || nextStatus === "rejected") {
      if (!isManager || actor.id === assignee || current !== "submitted") {
        throw new HttpError(403, "A property manager must review another staff member’s submitted task.");
      }
      if (nextStatus === "rejected" && !note) {
        throw new HttpError(400, "Add a correction note when returning a task.");
      }
      eventType = nextStatus === "completed" ? "approved" : "returned";
      description = nextStatus === "completed"
        ? (note ? `Approved: ${note}` : "Task approved and completed.")
        : `Returned for correction: ${note}`;
    } else {
      throw new HttpError(400, "Unsupported task status transition.");
    }
    const timestamp = now.toISOString();
    client.prepare(`
      UPDATE team_tasks
      SET status = ?, completion_note = COALESCE(?, completion_note), updated_at = ?
      WHERE id = ?
    `).run(nextStatus, note, timestamp, taskId);
    addActivity(client, taskId, actor.id, eventType, description, timestamp);
    return getTaskForActor(database, actor, taskId);
  });
}

export function updateTeamTask(
  database: PmsDatabase,
  actor: AuthenticatedStaff,
  taskId: number,
  draft: TeamTaskDraft,
  now = new Date(),
) {
  return withImmediateTransaction(database, (client) => {
    const existing = client.prepare(`
      SELECT property_id, status, assigned_staff_id, department, priority, due_date, due_time
      FROM team_tasks WHERE id = ?
    `).get(taskId);
    if (!existing) throw new HttpError(404, "Task not found.");
    assertManagerProperty(client, actor, numberValue(existing.property_id));
    if (["completed", "cancelled"].includes(textValue(existing.status))) {
      throw new HttpError(409, "Completed or cancelled tasks cannot be edited.");
    }
    validateTaskReferences(client, draft);
    client.prepare(`
      UPDATE team_tasks SET property_id = ?, unit_id = ?, reservation_id = ?, title = ?,
        description = ?, department = ?, assigned_staff_id = ?, priority = ?,
        due_date = ?, due_time = ?, updated_at = ?
      WHERE id = ?
    `).run(
      draft.propertyId,
      draft.unitId,
      draft.reservationId,
      draft.title,
      draft.description,
      draft.department,
      draft.assignedStaffId,
      draft.priority,
      draft.dueDate,
      draft.dueTime,
      now.toISOString(),
      taskId,
    );
    addActivity(client, taskId, actor.id, "details_changed", "Task details, assignment, priority, or due date updated.", now.toISOString());
    return getTaskForActor(database, actor, taskId);
  });
}

export function managerTaskSummary(
  database: PmsDatabase,
  actor: AuthenticatedStaff,
  today = new Date().toISOString().slice(0, 10),
) {
  assertManagerRole(actor);
  const properties = listTaskProperties(database, actor);
  const propertyIds = properties.map((property) => numberValue(property.id));
  if (!propertyIds.length) return { properties, totals: emptyTaskTotals(), byStatus: {}, byPriority: {} };
  const marks = propertyIds.map(() => "?").join(", ");
  const rows = database.$client.prepare(`
    SELECT status, priority, COUNT(*) AS count,
      SUM(CASE WHEN due_date IS NOT NULL AND due_date < ?
        AND status IN ('pending', 'in_progress', 'rejected') THEN 1 ELSE 0 END) AS overdue
    FROM team_tasks WHERE property_id IN (${marks})
    GROUP BY status, priority
  `).all(today, ...propertyIds);
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  let overdue = 0;
  let awaitingReview = 0;
  for (const row of rows) {
    const count = numberValue(row.count);
    const status = textValue(row.status);
    const priority = textValue(row.priority);
    byStatus[status] = (byStatus[status] ?? 0) + count;
    byPriority[priority] = (byPriority[priority] ?? 0) + count;
    overdue += numberValue(row.overdue);
    if (status === "submitted") awaitingReview += count;
  }
  return { properties, totals: { overdue, awaitingReview }, byStatus, byPriority };
}

function validateTaskReferences(
  client: PmsDatabase["$client"],
  draft: TeamTaskDraft,
): void {
  const property = client.prepare(`
    SELECT id FROM properties WHERE id = ? AND status = 'active'
  `).get(draft.propertyId);
  if (!property) throw new HttpError(404, "Active property not found.");
  const assignee = client.prepare(`
    SELECT role, is_active FROM staff_accounts WHERE id = ?
  `).get(draft.assignedStaffId);
  if (!assignee || assignee.is_active !== 1) throw new HttpError(400, "Assignee must be an active staff member.");
  if (textValue(assignee.role) !== draft.department) {
    throw new HttpError(400, "Assignee must belong to the selected department.");
  }
  if (draft.unitId !== null) {
    const unit = client.prepare(`
      SELECT id FROM units WHERE id = ? AND property_id = ?
    `).get(draft.unitId, draft.propertyId);
    if (!unit) throw new HttpError(400, "Related unit must belong to the selected property.");
  }
  if (draft.reservationId !== null) {
    const reservation = client.prepare(`
      SELECT id FROM reservations WHERE id = ? AND property_id = ?
        AND (? IS NULL OR unit_id = ?)
    `).get(draft.reservationId, draft.propertyId, draft.unitId, draft.unitId);
    if (!reservation) throw new HttpError(400, "Related reservation must belong to the selected property and unit.");
  }
}

function assertManagerProperty(
  client: PmsDatabase["$client"],
  actor: AuthenticatedStaff,
  propertyId: number,
): void {
  if (actor.role === "administrator") {
    const active = client.prepare("SELECT 1 FROM properties WHERE id = ? AND status = 'active'").get(propertyId);
    if (!active) throw new HttpError(404, "Active property not found.");
    return;
  }
  if (actor.role !== "property_manager" || !isManagerProperty(client, actor.id, propertyId)) {
    throw new HttpError(404, "Property not found.");
  }
}

function isManagerProperty(client: PmsDatabase["$client"], staffId: number, propertyId: number): boolean {
  return client.prepare(`
    SELECT 1 FROM property_manager_properties a
    JOIN properties p ON p.id = a.property_id
    WHERE a.staff_id = ? AND a.property_id = ? AND p.status = 'active'
  `).get(staffId, propertyId) !== undefined;
}

function canViewTask(
  database: PmsDatabase,
  actor: AuthenticatedStaff,
  propertyId: number,
  assignedStaffId: number,
): boolean {
  if (actor.role === "administrator") return true;
  if (actor.role === "property_manager") {
    return isManagerProperty(database.$client, actor.id, propertyId);
  }
  return actor.id === assignedStaffId &&
    (actor.role === "front_desk" || actor.role === "housekeeping" || actor.role === "accounting");
}

function assertManagerRole(actor: AuthenticatedStaff): void {
  if (actor.role !== "administrator" && actor.role !== "property_manager") {
    throw new HttpError(403, "Only managers can access team task administration.");
  }
}

function addActivity(
  client: PmsDatabase["$client"],
  taskId: number,
  actorId: number | null,
  eventType: string,
  description: string,
  createdAt = new Date().toISOString(),
): void {
  client.prepare(`
    INSERT INTO team_task_activity (task_id, actor_staff_id, event_type, description, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(taskId, actorId, eventType, description, createdAt);
}

function taskRecord(row: Record<string, unknown>, today: string) {
  return {
    id: numberValue(row.id),
    propertyId: numberValue(row.property_id),
    propertyName: textValue(row.property_name),
    unitId: nullableNumber(row.unit_id),
    unitName: nullableTextValue(row.unit_name),
    reservationId: nullableNumber(row.reservation_id),
    reservationReference: nullableTextValue(row.reservation_reference),
    title: textValue(row.title),
    description: textValue(row.description),
    department: textValue(row.department) as TaskDepartment,
    assignedStaffId: numberValue(row.assigned_staff_id),
    assignedName: textValue(row.assigned_name),
    createdByStaffId: numberValue(row.created_by_staff_id),
    creatorName: textValue(row.creator_name),
    priority: textValue(row.priority) as TeamTaskPriority,
    status: textValue(row.status) as TeamTaskStatus,
    dueDate: nullableTextValue(row.due_date),
    dueTime: nullableTextValue(row.due_time),
    completionNote: nullableTextValue(row.completion_note),
    overdue: typeof row.due_date === "string" && row.due_date < today &&
      ["pending", "in_progress", "rejected"].includes(textValue(row.status)),
    createdAt: textValue(row.created_at),
    updatedAt: textValue(row.updated_at),
  };
}

function emptyTaskTotals() {
  return { overdue: 0, awaitingReview: 0 };
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  throw new Error("Database returned an invalid task number.");
}

function nullableNumber(value: unknown): number | null {
  return value === null ? null : numberValue(value);
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  throw new Error("Database returned an invalid task text value.");
}

function nullableTextValue(value: unknown): string | null {
  return value === null ? null : textValue(value);
}
