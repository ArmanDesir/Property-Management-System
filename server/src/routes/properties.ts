import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import type { PmsDatabase } from "../db/connection.js";
import { properties } from "../db/schema.js";
import { asyncHandler, HttpError } from "../middleware/http-errors.js";
import {
  currencyValue,
  enumValue,
  optionalEmail,
  optionalText,
  parseRecordId,
  propertyTypes,
  requireObject,
  requiredText,
  timeValue,
} from "../services/validation.js";
import { createUnitsRouter } from "./units.js";

export function createPropertiesRouter(database: PmsDatabase): Router {
  const router = Router();
  router.use("/:propertyId/units", createUnitsRouter(database));

  router.get(
    "/",
    asyncHandler(async (request, response) => {
      const includeArchived = request.query.includeArchived === "true";
      const records = await database
        .select()
        .from(properties)
        .where(includeArchived ? undefined : eq(properties.status, "active"))
        .orderBy(asc(properties.name))
        .all();
      response.json({ properties: records });
    }),
  );

  router.post(
    "/",
    asyncHandler(async (request, response) => {
      const input = parsePropertyInput(request.body);
      const record = await database
        .insert(properties)
        .values(input)
        .returning()
        .get();
      response.status(201).json({ property: record });
    }),
  );

  router.get(
    "/:propertyId",
    asyncHandler(async (request, response) => {
      const propertyId = parseRecordId(request.params.propertyId);
      const record = await findProperty(database, propertyId);
      if (!record) throw new HttpError(404, "Property not found.");
      response.json({ property: record });
    }),
  );

  router.put(
    "/:propertyId",
    asyncHandler(async (request, response) => {
      const propertyId = parseRecordId(request.params.propertyId);
      const existing = await findProperty(database, propertyId);
      if (!existing) throw new HttpError(404, "Property not found.");
      if (existing.status === "archived") {
        throw new HttpError(409, "Restore this property before editing its details.");
      }

      const input = parsePropertyInput(request.body);
      const [record] = await database
        .update(properties)
        .set({ ...input, updatedAt: new Date().toISOString() })
        .where(eq(properties.id, propertyId))
        .returning()
        .all();
      response.json({ property: record });
    }),
  );

  router.patch(
    "/:propertyId/status",
    asyncHandler(async (request, response) => {
      const propertyId = parseRecordId(request.params.propertyId);
      const existing = await findProperty(database, propertyId);
      if (!existing) throw new HttpError(404, "Property not found.");
      const body = requireObject(request.body);
      const status = enumValue(body.status, "Status", ["active", "archived"] as const);
      const [record] = await database
        .update(properties)
        .set({ status, updatedAt: new Date().toISOString() })
        .where(eq(properties.id, propertyId))
        .returning()
        .all();
      response.json({ property: record });
    }),
  );

  router.delete(
    "/:propertyId",
    asyncHandler(async (request, response) => {
      const propertyId = parseRecordId(request.params.propertyId);
      const existing = await findProperty(database, propertyId);
      if (!existing) throw new HttpError(404, "Property not found.");
      if (existing.status === "archived") {
        response.json({ property: existing, archived: true });
        return;
      }

      const [record] = await database
        .update(properties)
        .set({ status: "archived", updatedAt: new Date().toISOString() })
        .where(eq(properties.id, propertyId))
        .returning()
        .all();
      response.json({ property: record, archived: true });
    }),
  );

  return router;
}

async function findProperty(database: PmsDatabase, id: number) {
  return database
    .select()
    .from(properties)
    .where(eq(properties.id, id))
    .get();
}

function parsePropertyInput(value: unknown) {
  const body = requireObject(value);
  return {
    name: requiredText(body.name, "Property name", 120),
    propertyType: body.propertyType === undefined
      ? "other" as const
      : enumValue(body.propertyType, "Property type", propertyTypes),
    address: optionalText(body.address, "Address", 500),
    contactName: optionalText(body.contactName, "Contact name", 120),
    contactEmail: optionalEmail(body.contactEmail),
    contactPhone: optionalText(body.contactPhone, "Contact phone", 50),
    defaultCurrency: body.defaultCurrency === undefined
      ? "USD"
      : currencyValue(body.defaultCurrency),
    defaultCheckInTime: body.defaultCheckInTime === undefined
      ? "15:00"
      : timeValue(body.defaultCheckInTime, "Default check-in time"),
    defaultCheckOutTime: body.defaultCheckOutTime === undefined
      ? "11:00"
      : timeValue(body.defaultCheckOutTime, "Default check-out time"),
  };
}
