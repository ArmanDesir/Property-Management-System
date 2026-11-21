import { and, asc, eq, inArray, like, or, sql } from "drizzle-orm";
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
import {
  assertGuestPropertyAccess,
  assertPropertyAccess,
  linkGuestToProperty,
  selectedPropertyId,
} from "../services/property-access.js";
import { withImmediateTransaction } from "../services/reservations.js";

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
    "/match",
    asyncHandler(async (request, response) => {
      if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
      const propertyId = selectedPropertyId(request, request.auth);
      if (!propertyId && request.auth.role !== "administrator") {
        throw new HttpError(400, "Select a property to match this guest.");
      }
      const email = matchText(request.query.email, "Email");
      const phone = matchText(request.query.phone, "Phone number");
      if (!email && !phone) {
        throw new HttpError(400, "Supply an exact email address or phone number.");
      }
      const matches = database.$client.prepare(`
        SELECT id FROM guests
        WHERE status = 'active' AND (
          (? IS NOT NULL AND lower(email) = lower(?)) OR
          (? IS NOT NULL AND phone = ?)
        )
        ORDER BY id LIMIT 2
      `).all(email, email, phone, phone);
      if (matches.length > 1) {
        throw new HttpError(409, "More than one guest matches. Ask an administrator to resolve the duplicate profiles.");
      }
      if (matches.length === 0) {
        response.json({ guest: null });
        return;
      }
      const guestId = Number(matches[0].id);
      const record = await findGuest(database, guestId);
      response.json({
        guest: record ? {
          id: record.id,
          firstName: record.firstName,
          lastName: record.lastName,
          email: record.email,
          phone: record.phone,
        } : null,
      });
    }),
  );

  router.get(
    "/",
    asyncHandler(async (request, response) => {
      const status = queryStatus(request.query.status);
      const search = queryText(request.query.q);
      if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
      const propertyId = selectedPropertyId(request, request.auth);
      const conditions = [];
      if (status !== "all") conditions.push(eq(guests.status, status));
      if (request.auth.role !== "administrator") {
        const propertyIds = propertyId === undefined
          ? request.auth.propertyIds
          : [propertyId];
        if (propertyIds.length === 0) {
          response.json({ guests: [] });
          return;
        }
        const placeholders = propertyIds.map(() => "?").join(", ");
        const accessibleGuests = database.$client.prepare(`
          SELECT guest_id FROM guest_property_access
          WHERE property_id IN (${placeholders})
        `).all(...propertyIds).map((row) => Number(row.guest_id));
        if (accessibleGuests.length === 0) {
          response.json({ guests: [] });
          return;
        }
        conditions.push(inArray(guests.id, [...new Set(accessibleGuests)]));
      }
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
      if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
      const propertyId = selectedPropertyId(request, request.auth);
      if (request.auth.role !== "administrator" && propertyId === undefined) {
        throw new HttpError(400, "Select a property before creating a guest profile.");
      }
      if (propertyId !== undefined) assertPropertyAccess(request.auth, propertyId);
      const result = withImmediateTransaction(database, (client) => {
        const existing = client.prepare(`
          SELECT id FROM guests
          WHERE status = 'active' AND (
            (? IS NOT NULL AND lower(email) = lower(?)) OR
            (? IS NOT NULL AND phone = ?)
          )
          ORDER BY id LIMIT 2
        `).all(input.email, input.email, input.phone, input.phone);
        if (existing.length > 0) {
          throw new HttpError(
            409,
            existing.length > 1
              ? "More than one guest matches these contact details. Ask an administrator to resolve the duplicate profiles."
              : "A guest profile already matches these contact details. Match and link that profile instead.",
          );
        }
        const inserted = client.prepare(`
          INSERT INTO guests (
            first_name, last_name, email, phone, address, country, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          input.firstName,
          input.lastName,
          input.email,
          input.phone,
          input.address,
          input.country,
          input.notes,
        );
        const guestId = Number(inserted.lastInsertRowid);
        if (propertyId !== undefined) linkGuestToProperty(database, guestId, propertyId);
        return { guestId };
      });
      const record = await findGuest(database, result.guestId);
      if (!record) throw new Error("The guest profile could not be loaded after saving.");
      response.status(201).json({ guest: record });
    }),
  );

  router.post(
    "/:guestId/link",
    asyncHandler(async (request, response) => {
      if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
      const propertyId = selectedPropertyId(request, request.auth);
      if (!propertyId && request.auth.role !== "administrator") {
        throw new HttpError(400, "Select a property before linking this guest.");
      }
      const guestId = parseRecordId(request.params.guestId);
      const body = requireObject(request.body);
      if (Object.keys(body).some((field) => field !== "email" && field !== "phone")) {
        throw new HttpError(400, "Only the exact matched email and phone may be supplied.");
      }
      const email = matchText(body.email, "Email");
      const phone = matchText(body.phone, "Phone number");
      if (!email && !phone) {
        throw new HttpError(400, "Supply the exact email address or phone used for matching.");
      }
      const match = database.$client.prepare(`
        SELECT id FROM guests
        WHERE id = ? AND status = 'active' AND (
          (? IS NOT NULL AND lower(email) = lower(?)) OR
          (? IS NOT NULL AND phone = ?)
        )
      `).get(guestId, email, email, phone, phone);
      if (!match) throw new HttpError(404, "Guest profile did not match those contact details.");
      if (propertyId !== undefined) linkGuestToProperty(database, guestId, propertyId);
      const record = await findGuest(database, guestId);
      if (!record) throw new HttpError(404, "Guest not found.");
      response.json({
        guest: {
          id: record.id,
          firstName: record.firstName,
          lastName: record.lastName,
        },
        linked: propertyId !== undefined,
      });
    }),
  );

  router.get(
    "/:guestId",
    asyncHandler(async (request, response) => {
      const guestId = parseRecordId(request.params.guestId);
      if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
      const propertyId = selectedPropertyId(request, request.auth);
      assertGuestPropertyAccess(database, request.auth, guestId, propertyId);
      const record = await findGuest(database, guestId);
      if (!record) throw new HttpError(404, "Guest not found.");
      response.json({ guest: record });
    }),
  );

  router.patch(
    "/:guestId",
    asyncHandler(async (request, response) => {
      const guestId = parseRecordId(request.params.guestId);
      if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
      const propertyId = selectedPropertyId(request, request.auth);
      assertGuestPropertyAccess(database, request.auth, guestId, propertyId);
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
      if (request.auth?.role !== "administrator") {
        throw new HttpError(403, "Only an administrator can archive a shared guest profile.");
      }
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
      if (request.auth?.role !== "administrator") {
        throw new HttpError(403, "Only an administrator can restore a shared guest profile.");
      }
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

function matchText(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, `${label} must be text.`);
  const text = value.trim();
  if (text.length > 254) throw new HttpError(400, `${label} is too long.`);
  return text || null;
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
