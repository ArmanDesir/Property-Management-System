import { Router } from "express";
import type { PmsDatabase } from "../db/connection.js";
import { asyncHandler, HttpError } from "../middleware/http-errors.js";
import {
  enumValue,
  parseRecordId,
  requireObject,
} from "../services/validation.js";
import {
  listHousekeeping,
  updateHousekeepingStatus,
  type HousekeepingStatus,
} from "../services/housekeeping.js";

const housekeepingStatuses = ["dirty", "cleaning", "clean"] as const;

export function createHousekeepingRouter(database: PmsDatabase): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (request, response) => {
      const propertyId = request.query.propertyId === undefined
        ? null
        : parseRecordId(request.query.propertyId);
      const status = request.query.status === undefined
        ? "all"
        : queryStatus(request.query.status);
      const overview = listHousekeeping(database, propertyId, status);
      if (request.auth?.role === "housekeeping") {
        response.json({
          housekeeping: {
            ...overview,
            units: overview.units.map((unit) => ({
              ...unit,
              activeStay: unit.activeStay
                ? {
                  checkIn: unit.activeStay.checkIn,
                  checkOut: unit.activeStay.checkOut,
                }
                : null,
            })),
          },
        });
        return;
      }
      response.json({ housekeeping: overview });
    }),
  );

  router.patch(
    "/units/:unitId/status",
    asyncHandler(async (request, response) => {
      const unitId = parseRecordId(request.params.unitId);
      const body = requireObject(request.body);
      const status = enumValue(body.status, "Housekeeping status", housekeepingStatuses);
      const unit = updateHousekeepingStatus(database, unitId, status as HousekeepingStatus);
      response.json({ unit });
    }),
  );

  return router;
}

function queryStatus(value: unknown): HousekeepingStatus | "all" {
  if (value === "all") return "all";
  if (typeof value !== "string") {
    throw new HttpError(400, "Status must be supplied once as dirty, cleaning, clean, or all.");
  }
  return enumValue(value, "Status", ["all", ...housekeepingStatuses] as const);
}
