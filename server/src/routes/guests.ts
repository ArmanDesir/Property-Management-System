import { and, asc, eq, like, or, sql } from "drizzle-orm";
import { Router } from "express";
import type { PmsDatabase } from "../db/connection.js";
import { guests } from "../db/schema.js";
import { asyncHandler, HttpError } from "../middleware/http-errors.js";
import {
  optionalEmail,
  optionalText,
  parseRecordId,
  requireObject,
  requiredText,
} from "../services/validation.js";

const editableFields = new Set([
  "firstName",
  "lastName",
  "email",
  "phone",
  "address",
  "country",
  "notes",
]);
type GuestRecord = typeof guests.$inferSelect;

export function createGuestsRouter(database: PmsDatabase): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (request, response) => {
      const status = queryStatus(request.query.status);
      const search = queryText(request.query.q);
      const conditions = [];
      if (status !== "all") conditions.push(eq(guests.status, status));
      if (search) {
        const pattern = `%${search}%`;
        conditions.push(or(
          like(guests.firstName, pattern),
          like(guests.lastName, pattern),
          like(sql`${guests.firstName} || ' ' || ${guests.lastName}`, pattern),
          like(guests.email, pattern),
          like(guests.phone, pattern),
        )!);
      }

      const records = await database
        .select({
          id: guests.id,
          firstName: guests.firstName,
          lastName: guests.lastName,
          email: guests.email,
          phone: guests.phone,
          status: guests.status,
          createdAt: guests.createdAt,
        })
        .from(guests)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(guests.lastName), asc(guests.firstName), asc(guests.id))
        .all();
      response.json({ guests: records });
    }),
  );

  router.post(
    "/",
    asyncHandler(async (request, response) => {
      const input = parseGuestInput(request.body);
      const [record] = await database
        .insert(guests)
        .values(input)
        .returning()
        .all();
      response.status(201).json({ guest: record });
    }),
  );

  router.get(
    "/:guestId",
    asyncHandler(async (request, response) => {
      const guestId = parseRecordId(request.params.guestId);
      const record = await findGuest(database, guestId);
      if (!record) throw new HttpError(404, "Guest not found.");
      response.json({ guest: record });
    }),
  );

  router.patch(
    "/:guestId",
    asyncHandler(async (request, response) => {
      const guestId = parseRecordId(request.params.guestId);
      const existing = await findGuest(database, guestId);
      if (!existing) throw new HttpError(404, "Guest not found.");
      if (existing.status === "archived") {
        throw new HttpError(409, "Restore this guest before editing the profile.");
      }

      const changes = parseGuestPatch(request.body, existing);
      const [record] = await database
        .update(guests)
        .set({ ...changes, updatedAt: new Date().toISOString() })
        .where(eq(guests.id, guestId))
        .returning()
        .all();
      response.json({ guest: record });
    }),
  );

  router.post(
    "/:guestId/archive",
    asyncHandler(async (request, response) => {
      const guestId = parseRecordId(request.params.guestId);
      const existing = await findGuest(database, guestId);
      if (!existing) throw new HttpError(404, "Guest not found.");
      if (existing.status === "archived") {
        response.json({ guest: existing });
        return;
      }

      const [record] = await database
        .update(guests)
        .set({ status: "archived", updatedAt: new Date().toISOString() })
        .where(eq(guests.id, guestId))
        .returning()
        .all();
      response.json({ guest: record });
    }),
  );

  router.post(
    "/:guestId/restore",
    asyncHandler(async (request, response) => {
      const guestId = parseRecordId(request.params.guestId);
      const existing = await findGuest(database, guestId);
      if (!existing) throw new HttpError(404, "Guest not found.");
      if (existing.status === "active") {
        response.json({ guest: existing });
        return;
      }

      const [record] = await database
        .update(guests)
        .set({ status: "active", updatedAt: new Date().toISOString() })
        .where(eq(guests.id, guestId))
        .returning()
        .all();
      response.json({ guest: record });
    }),
  );

  return router;
}

async function findGuest(database: PmsDatabase, id: number) {
  const [record] = await database
    .select()
    .from(guests)
    .where(eq(guests.id, id))
    .all();
  return record;
}

function queryStatus(value: unknown): "active" | "archived" | "all" {
  if (value === undefined) return "active";
  if (value === "all") return "all";
  if (value === "active") return "active";
  if (value === "archived") return "archived";
  throw new HttpError(400, "Status must be active, archived, or all.");
}

function queryText(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new HttpError(400, "Search query must be text.");
  const search = value.trim();
  if (search.length > 120) {
    throw new HttpError(400, "Search query must be 120 characters or fewer.");
  }
  return search;
}

function parseGuestInput(value: unknown) {
  const body = requireObject(value);
  assertEditableFields(body);
  const input = {
    firstName: requiredText(body.firstName, "First name", 100),
    lastName: requiredText(body.lastName, "Last name", 100),
    email: optionalEmail(body.email, "Email"),
    phone: guestPhone(body.phone),
    address: optionalText(body.address, "Address", 500),
    country: optionalText(body.country, "Country", 100),
    notes: optionalText(body.notes, "Notes", 2000),
  };
  assertContactMethod(input.email, input.phone);
  return input;
}

function parseGuestPatch(
  value: unknown,
  existing: GuestRecord,
) {
  const body = requireObject(value);
  assertEditableFields(body);
  const keys = Object.keys(body);
  if (keys.length === 0) throw new HttpError(400, "Provide at least one guest profile field to update.");

  const changes: {
    firstName?: string;
    lastName?: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    country?: string | null;
    notes?: string | null;
  } = {};
  if ("firstName" in body) changes.firstName = requiredText(body.firstName, "First name", 100);
  if ("lastName" in body) changes.lastName = requiredText(body.lastName, "Last name", 100);
  if ("email" in body) changes.email = optionalEmail(body.email, "Email");
  if ("phone" in body) changes.phone = guestPhone(body.phone);
  if ("address" in body) changes.address = optionalText(body.address, "Address", 500);
  if ("country" in body) changes.country = optionalText(body.country, "Country", 100);
  if ("notes" in body) changes.notes = optionalText(body.notes, "Notes", 2000);

  assertContactMethod(
    changes.email !== undefined ? changes.email : existing.email,
    changes.phone !== undefined ? changes.phone : existing.phone,
  );
  return changes;
}

function assertEditableFields(body: Record<string, unknown>): void {
  const invalidField = Object.keys(body).find((key) => !editableFields.has(key));
  if (invalidField) throw new HttpError(400, `Unsupported guest field: ${invalidField}.`);
}

function guestPhone(value: unknown): string | null {
  const phone = optionalText(value, "Phone number", 40);
  if (phone && phone.length < 5) {
    throw new HttpError(400, "Phone number must be at least 5 characters when supplied.");
  }
  return phone;
}

function assertContactMethod(email: string | null, phone: string | null): void {
  if (!email && !phone) {
    throw new HttpError(400, "Provide at least one contact method: email or phone number.");
  }
}
