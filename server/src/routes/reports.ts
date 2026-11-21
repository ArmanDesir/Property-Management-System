import { Router } from "express";
import type { PmsDatabase } from "../db/connection.js";
import { asyncHandler, HttpError } from "../middleware/http-errors.js";
import { parseRecordId } from "../services/validation.js";
import {
  getBillingReport,
  getHousekeepingReport,
  getOccupancyReport,
  getReportSummary,
  getReservationReport,
  type ReportFilters,
} from "../services/reports.js";
import type { AuthenticatedStaff } from "../services/auth.js";
import { assertPropertyAccess } from "../services/property-access.js";

export function createReportsRouter(database: PmsDatabase): Router {
  const router = Router();

  router.get(
    "/summary",
    asyncHandler(async (request, response) => {
      response.json({
        report: getReportSummary(database, parseFilters(database, request.query, request.auth)),
      });
    }),
  );
  router.get(
    "/reservations",
    asyncHandler(async (request, response) => {
      response.json({
        report: getReservationReport(database, parseFilters(database, request.query, request.auth)),
      });
    }),
  );
  router.get(
    "/occupancy",
    asyncHandler(async (request, response) => {
      response.json({
        report: getOccupancyReport(database, parseFilters(database, request.query, request.auth)),
      });
    }),
  );
  router.get(
    "/housekeeping",
    asyncHandler(async (request, response) => {
      response.json({
        report: getHousekeepingReport(database, parseFilters(database, request.query, request.auth)),
      });
    }),
  );
  router.get(
    "/billing",
    asyncHandler(async (request, response) => {
      response.json({
        report: getBillingReport(database, parseFilters(database, request.query, request.auth)),
      });
    }),
  );

  return router;
}

function parseFilters(
  database: PmsDatabase,
  query: Record<string, unknown>,
  actor: AuthenticatedStaff | undefined,
): ReportFilters {
  const from = parseDate(queryValue(query.from, "Start date"), "Start date");
  const to = parseDate(queryValue(query.to, "End date"), "End date");
  if (to < from) throw new HttpError(400, "End date cannot be before start date.");
  const days = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
    86_400_000 + 1;
  if (days > 366) throw new HttpError(400, "Report date ranges cannot exceed 366 days.");

  const propertyId = query.propertyId === undefined
    ? null
    : parseRecordId(queryValue(query.propertyId, "Property ID"));
  if (!actor) throw new HttpError(401, "Sign in to access this resource.");
  if (propertyId === null && actor.role !== "administrator") {
    throw new HttpError(400, "Select a property to view its reports.");
  }
  if (propertyId !== null) {
    assertPropertyAccess(actor, propertyId);
    const property = database.$client.prepare("SELECT id FROM properties WHERE id = ?").get(propertyId);
    if (!property) throw new HttpError(404, "Property not found.");
  }
  return { from, to, propertyId };
}

function queryValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new HttpError(400, `${label} must be supplied once.`);
  }
  return value;
}

function parseDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) {
    throw new HttpError(400, `${label} must be a valid date in YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${label} must be a valid calendar date.`);
  }
  return value;
}
