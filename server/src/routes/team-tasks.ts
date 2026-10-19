import { Router } from "express";
import type { Request } from "express";
import type { PmsDatabase } from "../db/connection.js";
import { asyncHandler, HttpError } from "../middleware/http-errors.js";
import {
  enumValue,
  optionalText,
  parseRecordId,
  positiveInteger,
  requiredText,
  requireObject,
  timeValue,
} from "../services/validation.js";
import {
  createTeamTask,
  getTaskForActor,
  getTaskOptions,
  listTeamTasks,
  managerTaskSummary,
  taskDepartments,
  taskPriorities,
  taskStatuses,
  transitionTeamTask,
  updateTeamTask,
  type TeamTaskDraft,
  type TeamTaskFilters,
} from "../services/team-tasks.js";
import { validateCalendarDate } from "../services/room-availability.js";

export function createTeamTasksRouter(database: PmsDatabase): Router {
  const router = Router();

  router.get("/options", (request, response) => {
    response.json({ options: getTaskOptions(
      database,
      requireActor(request),
      optionalQueryId(request.query.propertyId, "Property ID"),
    ) });
  });

  router.get("/dashboard", (request, response) => {
    response.json({ dashboard: managerTaskSummary(database, requireActor(request)) });
  });

  router.get("/", (request, response) => {
    response.json({ ...listTeamTasks(database, requireActor(request), parseFilters(request)) });
  });

  router.post("/", asyncHandler(async (request, response) => {
    const actor = requireActor(request);
    const draft = parseDraft(request.body);
    response.status(201).json({ task: createTeamTask(database, actor, draft) });
  }));

  router.get("/:taskId", (request, response) => {
    response.json({
      task: getTaskForActor(database, requireActor(request), parseRecordId(request.params.taskId)),
    });
  });

  router.put("/:taskId", asyncHandler(async (request, response) => {
    const actor = requireActor(request);
    response.json({
      task: updateTeamTask(
        database,
        actor,
        parseRecordId(request.params.taskId),
        parseDraft(request.body),
      ),
    });
  }));

  router.patch("/:taskId/status", (request, response) => {
    const actor = requireActor(request);
    const body = requireObject(request.body);
    rejectFields(body, new Set(["status", "note"]));
    const status = enumValue(body.status, "Status", taskStatuses);
    const note = optionalText(body.note, "Task note", 2000);
    response.json({
      task: transitionTeamTask(
        database,
        actor,
        parseRecordId(request.params.taskId),
        status,
        note,
      ),
    });
  });

  return router;
}

function parseDraft(value: unknown): TeamTaskDraft {
  const body = requireObject(value);
  rejectFields(body, new Set([
    "propertyId", "unitId", "reservationId", "title", "description",
    "department", "assignedStaffId", "priority", "dueDate", "dueTime",
  ]));
  const dueDate = body.dueDate === undefined || body.dueDate === null || body.dueDate === ""
    ? null
    : validateCalendarDate(body.dueDate, "Due date");
  const dueTime = body.dueTime === undefined || body.dueTime === null || body.dueTime === ""
    ? null
    : timeValue(body.dueTime, "Due time");
  return {
    propertyId: positiveInteger(body.propertyId, "Property ID", Number.MAX_SAFE_INTEGER),
    unitId: optionalId(body.unitId, "Unit ID"),
    reservationId: optionalId(body.reservationId, "Reservation ID"),
    title: requiredText(body.title, "Title", 160),
    description: requiredText(body.description, "Description", 4000),
    department: enumValue(body.department, "Department", taskDepartments),
    assignedStaffId: positiveInteger(body.assignedStaffId, "Assignee ID", Number.MAX_SAFE_INTEGER),
    priority: body.priority === undefined
      ? "normal"
      : enumValue(body.priority, "Priority", taskPriorities),
    dueDate,
    dueTime,
  };
}

function parseFilters(request: Request): TeamTaskFilters {
  const status = queryValue(request, "status");
  const priority = queryValue(request, "priority");
  const department = queryValue(request, "department");
  const dueFrom = queryValue(request, "dueFrom");
  const dueTo = queryValue(request, "dueTo");
  const parsedFrom = dueFrom === undefined ? null : validateCalendarDate(dueFrom, "Due date start");
  const parsedTo = dueTo === undefined ? null : validateCalendarDate(dueTo, "Due date end");
  if (parsedFrom && parsedTo && parsedFrom > parsedTo) {
    throw new HttpError(400, "Due date start must not be after due date end.");
  }
  return {
    status: status === undefined ? "all" : enumValue(status, "Status", ["all", ...taskStatuses] as const),
    priority: priority === undefined ? "all" : enumValue(priority, "Priority", ["all", ...taskPriorities] as const),
    department: department === undefined
      ? "all"
      : enumValue(department, "Department", ["all", ...taskDepartments] as const),
    propertyId: optionalQueryId(request.query.propertyId, "Property ID"),
    assignedStaffId: optionalQueryId(request.query.assignedStaffId, "Assignee ID"),
    dueFrom: parsedFrom,
    dueTo: parsedTo,
    limit: queryInteger(request.query.limit, 100, 1, 200),
    offset: queryInteger(request.query.offset, 0, 0, 1_000_000),
  };
}

function requireActor(request: Request) {
  if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
  return request.auth;
}

function rejectFields(body: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  const invalid = Object.keys(body).find((key) => !allowed.has(key));
  if (invalid) throw new HttpError(400, `Unsupported field: ${invalid}.`);
}

function optionalId(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  return positiveInteger(value, field, Number.MAX_SAFE_INTEGER);
}

function optionalQueryId(value: unknown, field: string): number | null {
  if (value === undefined) return null;
  if (typeof value !== "string") throw new HttpError(400, `${field} must be a single ID.`);
  return positiveInteger(Number(value), field, Number.MAX_SAFE_INTEGER);
}

function queryValue(request: Request, name: string): string | undefined {
  const value = request.query[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new HttpError(400, `${name} must be a single value.`);
  return value;
}

function queryInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new HttpError(400, "Pagination values must be whole numbers.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpError(400, "Pagination value is out of range.");
  }
  return parsed;
}
