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
  type HousekeepingUnit,
  type HousekeepingStatus,
} from "../services/housekeeping.js";

const housekeepingStatuses = ["dirty", "cleaning", "clean"] as const;
type HousekeepingUnitWithoutGuestDetails =
  Omit<HousekeepingUnit, "activeStay"> & {
    activeStay: Pick<
      NonNullable<HousekeepingUnit["activeStay"]>,
      "checkIn" | "checkOut"
    > | null;
  };

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
      if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
      const allowedPropertyIds = request.auth.role === "property_manager"
        ? managerPropertyIds(database, request.auth.id)
        : undefined;
      const overview = listHousekeeping(database, propertyId, status, allowedPropertyIds);
      if (
        request.auth.role === "housekeeping" ||
        request.auth.role === "property_manager"
      ) {
        response.json({
          housekeeping: {
            ...overview,
            units: overview.units.map(hideGuestDetails),
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
      if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
      const unit = updateHousekeepingStatus(
        database,
        unitId,
        status as HousekeepingStatus,
        request.auth,
      );
      response.json({
        unit: request.auth.role === "housekeeping" ||
            request.auth.role === "property_manager"
          ? hideGuestDetails(unit)
          : unit,
      });
    }),
  );

  return router;
}

function hideGuestDetails(unit: HousekeepingUnit): HousekeepingUnitWithoutGuestDetails {
  return {
    ...unit,
    activeStay: unit.activeStay
      ? {
        checkIn: unit.activeStay.checkIn,
        checkOut: unit.activeStay.checkOut,
      }
      : null,
  };
}

function managerPropertyIds(database: PmsDatabase, staffId: number): number[] {
  return database.$client.prepare(`
    SELECT a.property_id
    FROM property_manager_properties a
    JOIN properties p ON p.id = a.property_id
    WHERE a.staff_id = ? AND p.status = 'active'
    ORDER BY a.property_id
  `).all(staffId).map((row) => Number(row.property_id));
}

function queryStatus(value: unknown): HousekeepingStatus | "all" {
  if (value === "all") return "all";
  if (typeof value !== "string") {
    throw new HttpError(400, "Status must be supplied once as dirty, cleaning, clean, or all.");
  }
  return enumValue(value, "Status", ["all", ...housekeepingStatuses] as const);
}
