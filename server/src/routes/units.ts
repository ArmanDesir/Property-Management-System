import { and, asc, eq, inArray, isNull } from "drizzle-orm";
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
import { withImmediateTransaction } from "../services/reservations.js";
import { assertPropertyAccess } from "../services/property-access.js";

const maximumBulkUnits = 500;

export function createUnitsRouter(database: PmsDatabase): Router {
  const router = Router({ mergeParams: true });

  router.get(
    "/",
    asyncHandler(async (request, response) => {
      const propertyId = parseRecordId(request.params.propertyId);
      if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
      assertPropertyAccess(request.auth, propertyId);
      const [property] = await database
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .all();
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
      if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
      assertPropertyAccess(request.auth, propertyId);
      const [property] = await database
        .select({ status: properties.status })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .all();
      if (!property) throw new HttpError(404, "Property not found.");
      if (property.status !== "active") {
        throw new HttpError(409, "Restore this property before adding units.");
      }

      const body = requireObject(request.body);
      if ("units" in body) {
        if (
          Object.keys(body).length !== 1 ||
          !Array.isArray(body.units) ||
          body.units.length === 0 ||
          body.units.length > maximumBulkUnits
        ) {
          throw new HttpError(
            400,
            `Bulk creation requires 1 to ${maximumBulkUnits} units.`,
          );
        }
        const inputs = body.units.map(parseUnitInput);
        const ids = createUnits(database, propertyId, inputs);
        const records = await database
          .select()
          .from(units)
          .where(inArray(units.id, ids))
          .all();
        const recordsById = new Map(records.map((record) => [record.id, record]));
        const createdUnits = ids.map((id) => {
          const record = recordsById.get(id);
          if (!record) throw new Error("A newly created unit could not be loaded.");
          return record;
        });
        response.status(201).json({ units: createdUnits });
        return;
      }

      const input = parseUnitInput(body);
      const [record] = await database
        .insert(units)
        .values({ ...input, propertyId })
        .returning()
        .all();
      response.status(201).json({ unit: record });
    }),
  );

  router.get(
    "/:unitId",
    asyncHandler(async (request, response) => {
      const { propertyId, unitId } = parseIds(request.params.propertyId, request.params.unitId);
      if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
      assertPropertyAccess(request.auth, propertyId);
      const record = await findUnit(database, propertyId, unitId);
      if (!record) throw new HttpError(404, "Unit not found in this property.");
      response.json({ unit: record });
    }),
  );

  router.put(
    "/:unitId",
    asyncHandler(async (request, response) => {
      const { propertyId, unitId } = parseIds(request.params.propertyId, request.params.unitId);
      if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
      assertPropertyAccess(request.auth, propertyId);
      const [property] = await database
        .select({ status: properties.status })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .all();
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
      if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
      assertPropertyAccess(request.auth, propertyId);
      const [property] = await database
        .select({ status: properties.status })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .all();
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
      if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
      assertPropertyAccess(request.auth, propertyId);
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

function createUnits(
  database: PmsDatabase,
  propertyId: number,
  inputs: ReturnType<typeof parseUnitInput>[],
): number[] {
  return withImmediateTransaction(database, (client) => {
    const property = client.prepare(`
      SELECT status FROM properties WHERE id = ?
    `).get(propertyId);
    if (!property) throw new HttpError(404, "Property not found.");
    if (property.status !== "active") {
      throw new HttpError(409, "Restore this property before adding units.");
    }

    const existingNames = new Set(
      client.prepare(`
        SELECT name FROM units WHERE property_id = ? AND archived_at IS NULL
      `).all(propertyId)
        .map((row) => String(row.name).trim().toLowerCase()),
    );
    const batchNames = new Set<string>();
    const conflicts = new Set<string>();
    for (const input of inputs) {
      const normalizedName = input.name.trim().toLowerCase();
      if (existingNames.has(normalizedName) || batchNames.has(normalizedName)) {
        conflicts.add(input.name);
      }
      batchNames.add(normalizedName);
    }
    if (conflicts.size > 0) {
      const names = [...conflicts];
      const examples = names.slice(0, 10).join(", ");
      const remaining = names.length > 10 ? `, and ${names.length - 10} more` : "";
      throw new HttpError(
        409,
        `These unit names already exist in this property: ${examples}${remaining}. No units were created.`,
      );
    }

    const insert = client.prepare(`
      INSERT INTO units (
        property_id, name, unit_type, description, capacity,
        base_nightly_rate_cents, status, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', NULL)
    `);
    return inputs.map((input) => Number(insert.run(
      propertyId,
      input.name,
      input.unitType,
      input.description,
      input.capacity,
      input.baseNightlyRateCents,
    ).lastInsertRowid));
  });
}

async function findUnit(database: PmsDatabase, propertyId: number, unitId: number) {
  const [record] = await database
    .select()
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.propertyId, propertyId)))
    .all();
  return record;
}

function parseIds(propertyIdValue: unknown, unitIdValue: unknown) {
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
