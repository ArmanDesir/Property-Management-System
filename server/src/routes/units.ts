import { and, asc, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import type { PmsDatabase } from "../db/connection.js";
import { properties, units } from "../db/schema.js";
import { asyncHandler, HttpError } from "../middleware/http-errors.js";
import {
  enumValue,
  optionalText,
  parseRecordId,
  positiveInteger,
  rateToCents,
  requireObject,
  requiredText,
  unitStatuses,
  unitTypes,
} from "../services/validation.js";

export function createUnitsRouter(database: PmsDatabase): Router {
  const router = Router({ mergeParams: true });

  router.get(
    "/",
    asyncHandler(async (request, response) => {
      const propertyId = parseRecordId(request.params.propertyId);
      const property = await database
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .get();
      if (!property) throw new HttpError(404, "Property not found.");

      const includeArchived = request.query.includeArchived === "true";
      const where = includeArchived
        ? eq(units.propertyId, propertyId)
        : and(eq(units.propertyId, propertyId), isNull(units.archivedAt));
      const records = await database
        .select()
        .from(units)
        .where(where)
        .orderBy(asc(units.name))
        .all();
      response.json({ units: records });
    }),
  );

  router.post(
    "/",
    asyncHandler(async (request, response) => {
      const propertyId = parseRecordId(request.params.propertyId);
      const property = await database
        .select({ status: properties.status })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .get();
      if (!property) throw new HttpError(404, "Property not found.");
      if (property.status !== "active") {
        throw new HttpError(409, "Restore this property before adding units.");
      }

      const input = parseUnitInput(request.body);
      const record = await database
        .insert(units)
        .values({ ...input, propertyId })
        .returning()
        .get();
      response.status(201).json({ unit: record });
    }),
  );

  router.get(
    "/:unitId",
    asyncHandler(async (request, response) => {
      const { propertyId, unitId } = parseIds(request.params.propertyId, request.params.unitId);
      const record = await findUnit(database, propertyId, unitId);
      if (!record) throw new HttpError(404, "Unit not found in this property.");
      response.json({ unit: record });
    }),
  );

  router.put(
    "/:unitId",
    asyncHandler(async (request, response) => {
      const { propertyId, unitId } = parseIds(request.params.propertyId, request.params.unitId);
      const property = await database
        .select({ status: properties.status })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .get();
      if (!property) throw new HttpError(404, "Property not found.");
      if (property.status !== "active") {
        throw new HttpError(409, "Restore this property before editing its units.");
      }

      const existing = await findUnit(database, propertyId, unitId);
      if (!existing) throw new HttpError(404, "Unit not found in this property.");
      if (existing.archivedAt) throw new HttpError(409, "Restore this unit before editing it.");

      const input = parseUnitInput(request.body);
      const [record] = await database
        .update(units)
        .set({ ...input, updatedAt: new Date().toISOString() })
        .where(eq(units.id, unitId))
        .returning()
        .all();
      response.json({ unit: record });
    }),
  );

  router.patch(
    "/:unitId/status",
    asyncHandler(async (request, response) => {
      const { propertyId, unitId } = parseIds(request.params.propertyId, request.params.unitId);
      const property = await database
        .select({ status: properties.status })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .get();
      if (!property) throw new HttpError(404, "Property not found.");
      if (property.status !== "active") {
        throw new HttpError(409, "Restore this property before changing unit status.");
      }

      const existing = await findUnit(database, propertyId, unitId);
      if (!existing) throw new HttpError(404, "Unit not found in this property.");
      const body = requireObject(request.body);
      const status = enumValue(body.status, "Status", unitStatuses);
      const [record] = await database
        .update(units)
        .set({
          status,
          archivedAt: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(units.id, unitId))
        .returning()
        .all();
      response.json({ unit: record });
    }),
  );

  router.delete(
    "/:unitId",
    asyncHandler(async (request, response) => {
      const { propertyId, unitId } = parseIds(request.params.propertyId, request.params.unitId);
      const record = await findUnit(database, propertyId, unitId);
      if (!record) throw new HttpError(404, "Unit not found in this property.");
      if (record.archivedAt) {
        response.json({ unit: record, archived: true });
        return;
      }

      const [archivedUnit] = await database
        .update(units)
        .set({
          status: "inactive",
          archivedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(units.id, unitId))
        .returning()
        .all();
      response.json({ unit: archivedUnit, archived: true });
    }),
  );

  return router;
}

async function findUnit(database: PmsDatabase, propertyId: number, unitId: number) {
  return database
    .select()
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.propertyId, propertyId)))
    .get();
}

function parseIds(propertyIdValue: string, unitIdValue: string) {
  return {
    propertyId: parseRecordId(propertyIdValue),
    unitId: parseRecordId(unitIdValue),
  };
}

function parseUnitInput(value: unknown) {
  const body = requireObject(value);
  return {
    name: requiredText(body.name, "Unit name or number", 100),
    unitType: body.unitType === undefined
      ? "room" as const
      : enumValue(body.unitType, "Unit type", unitTypes),
    description: optionalText(body.description, "Description", 2000),
    capacity: positiveInteger(body.capacity, "Capacity", 1000),
    baseNightlyRateCents: rateToCents(body.baseNightlyRate),
    status: "active" as const,
    archivedAt: null,
  };
}
