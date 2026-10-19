import { Router } from "express";
import type { Request } from "express";
import type { PmsDatabase } from "../db/connection.js";
import { asyncHandler, HttpError } from "../middleware/http-errors.js";
import {
  enumValue,
  optionalText,
  parseRecordId,
  requiredText,
  requireObject,
} from "../services/validation.js";
import {
  createMaintenanceRequest,
  getMaintenanceDashboard,
  getMaintenanceRequest,
  listMaintenanceRequests,
  maintenanceCategories,
  maintenancePriorities,
  maintenanceStatuses,
  transitionMaintenanceRequest,
  updateMaintenanceRequest,
  type MaintenanceDraft,
  type MaintenanceFilters,
} from "../services/maintenance.js";

export function createMaintenanceRouter(database: PmsDatabase): Router {
  const router = Router();

  router.get(
    "/dashboard",
    (request, response) => {
      response.json({
        dashboard: getMaintenanceDashboard(database, undefined, managerPropertyIds(database, request)),
      });
    },
  );

  router.get("/options", (request, response) => {
    const propertyIds = managerPropertyIds(database, request);
    const propertyScope = propertyIds === undefined
      ? ""
      : propertyIds.length
        ? ` AND id IN (${propertyIds.map(() => "?").join(", ")})`
        : " AND 0 = 1";
    const properties = database.$client.prepare(`
      SELECT id, name FROM properties WHERE status = 'active'${propertyScope}
      ORDER BY name COLLATE NOCASE, id
    `).all(...(propertyIds ?? []));
    const unitScope = propertyIds === undefined
      ? ""
      : propertyIds.length
        ? ` AND u.property_id IN (${propertyIds.map(() => "?").join(", ")})`
        : " AND 0 = 1";
    const units = database.$client.prepare(`
      SELECT u.id, u.property_id, u.name, u.unit_type
      FROM units u JOIN properties p ON p.id = u.property_id
      WHERE p.status = 'active' AND u.status = 'active' AND u.archived_at IS NULL${unitScope}
      ORDER BY p.name COLLATE NOCASE, u.name COLLATE NOCASE, u.id
    `).all(...(propertyIds ?? []));
    const staff = request.auth?.role === "administrator" ||
        request.auth?.role === "property_manager"
      ? database.$client.prepare(`
        SELECT id, display_name FROM staff_accounts
        WHERE is_active = 1 ORDER BY display_name COLLATE NOCASE, id
      `).all()
      : [];
    response.json({
      properties: properties.map((row) => ({
        id: Number(row.id),
        name: row.name,
      })),
      units: units.map((row) => ({
        id: Number(row.id),
        propertyId: Number(row.property_id),
        name: row.name,
        unitType: row.unit_type,
      })),
      staff: staff.map((row) => ({
        id: Number(row.id),
        displayName: row.display_name,
      })),
    });
  });

  router.get(
    "/",
    (request, response) => {
      response.json({
        ...listMaintenanceRequests(
          database,
          parseFilters(request, managerPropertyIds(database, request)),
        ),
      });
    },
  );

  router.post(
    "/",
    asyncHandler(async (request, response) => {
      const draft = parseDraft(request.body, true);
      if (
        request.auth?.role === "housekeeping" &&
        draft.category !== "cleaning_related"
      ) {
        throw new HttpError(403, "Housekeeping staff may only report cleaning-related issues.");
      }
      if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
      if (
        request.auth.role !== "administrator" &&
        request.auth.role !== "property_manager" &&
        draft.assignedStaffId !== null
      ) {
        throw new HttpError(403, "Only managers may assign maintenance requests.");
      }
      const maintenanceRequest = createMaintenanceRequest(
        database,
        draft,
        request.auth.id,
        managerPropertyIds(database, request),
      );
      response.status(201).json({ request: maintenanceRequest });
    }),
  );

  router.get(
    "/:requestId",
    (request, response) => {
      response.json({
        request: getMaintenanceRequest(
          database,
          parseRecordId(request.params.requestId),
          managerPropertyIds(database, request),
        ),
      });
    },
  );

  router.put(
    "/:requestId",
    asyncHandler(async (request, response) => {
      const draft = parseDraft(request.body, false);
      const maintenanceRequest = updateMaintenanceRequest(
        database,
        parseRecordId(request.params.requestId),
        draft,
        managerPropertyIds(database, request),
      );
      response.json({ request: maintenanceRequest });
    }),
  );

  router.patch(
    "/:requestId/status",
    (request, response) => {
      const body = requireObject(request.body);
      rejectFields(body, new Set(["status", "resolutionNotes"]));
      if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
      const status = enumValue(body.status, "Status", maintenanceStatuses);
      const note = optionalText(body.resolutionNotes, "Resolution notes", 4000);
      const maintenanceRequest = transitionMaintenanceRequest(
        database,
        parseRecordId(request.params.requestId),
        status,
        request.auth.id,
        note,
        managerPropertyIds(database, request),
      );
      response.json({ request: maintenanceRequest });
    },
  );

  return router;
}

function parseDraft(value: unknown, allowReportedAt: boolean): MaintenanceDraft {
  const body = requireObject(value);
  const fields = new Set([
    "propertyId",
    "unitId",
    "title",
    "description",
    "category",
    "priority",
    "reportedAt",
    "targetCompletionDate",
    "assignedStaffId",
  ]);
  if (!allowReportedAt) fields.delete("reportedAt");
  rejectFields(body, fields);
  if (
    !("propertyId" in body) ||
    !("title" in body) ||
    !("description" in body) ||
    !("category" in body)
  ) {
    throw new HttpError(400, "Property, title, description, and category are required.");
  }
  const reportedAt = allowReportedAt && body.reportedAt !== undefined
    ? timestampValue(body.reportedAt, "Reported date and time")
    : null;
  return {
    propertyId: positiveId(body.propertyId, "Property ID"),
    unitId: optionalId(body.unitId, "Unit ID"),
    title: requiredText(body.title, "Title", 160),
    description: requiredText(body.description, "Description", 4000),
    category: enumValue(body.category, "Category", maintenanceCategories),
    priority: body.priority === undefined
      ? "normal"
      : enumValue(body.priority, "Priority", maintenancePriorities),
    reportedAt,
    targetCompletionDate: optionalDate(body.targetCompletionDate, "Target completion date"),
    assignedStaffId: optionalId(body.assignedStaffId, "Assigned staff ID"),
  };
}

function parseFilters(request: Request, allowedPropertyIds?: number[]): MaintenanceFilters {
  const status = queryValue(request, "status");
  const priority = queryValue(request, "priority");
  const category = queryValue(request, "category");
  const sort = queryValue(request, "sort") ?? "updated";
  const order = queryValue(request, "order") ?? "desc";
  const overdueValue = queryValue(request, "overdue") ?? "false";
  if (overdueValue !== "true" && overdueValue !== "false") {
    throw new HttpError(400, "Overdue filter must be true or false.");
  }
  return {
    search: (queryValue(request, "q") ?? "").trim().slice(0, 120),
    propertyId: optionalId(queryValue(request, "propertyId"), "Property ID"),
    allowedPropertyIds,
    unitId: optionalId(queryValue(request, "unitId"), "Unit ID"),
    assignedStaffId: optionalId(queryValue(request, "assignedStaffId"), "Assigned staff ID"),
    status: status === undefined
      ? "all"
      : enumValue(status, "Status", ["all", ...maintenanceStatuses] as const),
    priority: priority === undefined
      ? "all"
      : enumValue(priority, "Priority", ["all", ...maintenancePriorities] as const),
    category: category === undefined
      ? "all"
      : enumValue(category, "Category", ["all", ...maintenanceCategories] as const),
    overdue: overdueValue === "true",
    sort: enumValue(sort, "Sort", ["updated", "reported", "target", "priority"] as const),
    order: enumValue(order, "Order", ["asc", "desc"] as const),
    limit: queryInteger(request, "limit", 50, 1, 100),
    offset: queryInteger(request, "offset", 0, 0, 1_000_000),
  };
}

function managerPropertyIds(
  database: PmsDatabase,
  request: Request,
): number[] | undefined {
  if (request.auth?.role !== "property_manager") return undefined;
  return database.$client.prepare(`
    SELECT a.property_id
    FROM property_manager_properties a
    JOIN properties p ON p.id = a.property_id
    WHERE a.staff_id = ? AND p.status = 'active'
    ORDER BY a.property_id
  `).all(request.auth.id).map((row) => Number(row.property_id));
}

function queryValue(request: Request, name: string): string | undefined {
  const value = request.query[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new HttpError(400, `${name} must be supplied once.`);
  return value;
}

function queryInteger(
  request: Request,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = queryValue(request, name);
  if (value === undefined) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new HttpError(400, `${name} must be a whole number.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpError(400, `${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function optionalId(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new HttpError(400, `${label} must be a positive integer.`);
}

function positiveId(value: unknown, label: string): number {
  const parsed = optionalId(value, label);
  if (parsed === null) throw new HttpError(400, `${label} is required.`);
  return parsed;
}

function optionalDate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith("0000-")
  ) {
    throw new HttpError(400, `${label} must be a valid date in YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${label} must be a valid calendar date.`);
  }
  return value;
}

function timestampValue(value: unknown, label: string): string {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new HttpError(400, `${label} must be an ISO 8601 timestamp with a timezone.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new HttpError(400, `${label} must be a valid ISO 8601 timestamp.`);
  }
  return parsed.toISOString();
}

function rejectFields(body: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  const unsupported = Object.keys(body).find((field) => !allowed.has(field));
  if (unsupported) throw new HttpError(400, `Unsupported field: ${unsupported}.`);
}
