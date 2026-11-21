import { Router } from "express";
import type { PmsDatabase } from "../db/connection.js";
import { asyncHandler, HttpError } from "../middleware/http-errors.js";
import {
  parseRecordId,
  positiveInteger,
  requireObject,
  requiredText,
} from "../services/validation.js";
import {
  createStaff,
  listStaff,
  setStaffActive,
  updateStaff,
} from "../services/auth.js";
import {
  passwordValue,
  rejectFields,
  staffRoleValue,
  usernameValue,
} from "./auth.js";

export function createStaffRouter(database: PmsDatabase): Router {
  const router = Router();

  router.get("/", (request, response) => {
    if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
    if (request.auth.role === "property_manager") {
      const propertyIdValue = request.query.propertyId;
      const propertyId = propertyIdValue === undefined
        ? undefined
        : parseRecordId(propertyIdValue);
      if (propertyId !== undefined && !request.auth.propertyIds.includes(propertyId)) {
        throw new HttpError(404, "Property not found.");
      }
      const scope = propertyId === undefined
        ? request.auth.propertyIds
        : [propertyId];
      response.json({ staff: listStaff(database, scope) });
      return;
    }
    response.json({ staff: listStaff(database) });
  });

  router.post(
    "/",
    asyncHandler(async (request, response) => {
      const body = requireObject(request.body);
      rejectFields(body, new Set(["displayName", "username", "role", "password", "propertyIds"]));
      const staff = await createStaff(database, {
        displayName: requiredText(body.displayName, "Display name", 100),
        username: usernameValue(body.username),
        role: staffRoleValue(body.role),
        password: passwordValue(body.password),
        propertyIds: propertyIdsValue(body.propertyIds),
      });
      response.status(201).json({ staff });
    }),
  );

  router.put(
    "/:staffId",
    asyncHandler(async (request, response) => {
      const body = requireObject(request.body);
      rejectFields(body, new Set(["displayName", "username", "role", "password", "propertyIds"]));
      const input = {
        displayName: requiredText(body.displayName, "Display name", 100),
        username: usernameValue(body.username),
        role: staffRoleValue(body.role),
        propertyIds: propertyIdsValue(body.propertyIds),
        ...(body.password === undefined || body.password === ""
          ? {}
          : { password: passwordValue(body.password) }),
      };
      const staff = await updateStaff(
        database,
        parseRecordId(request.params.staffId),
        input,
      );
      response.json({ staff });
    }),
  );

  router.patch(
    "/:staffId/status",
    asyncHandler(async (request, response) => {
      const body = requireObject(request.body);
      rejectFields(body, new Set(["isActive"]));
      if (typeof body.isActive !== "boolean") {
        throw new HttpError(400, "Active status must be a boolean.");
      }

      const staff = setStaffActive(
        database,
        parseRecordId(request.params.staffId),
        body.isActive,
      );
      response.json({ staff });
    }),
  );

  return router;
}

function propertyIdsValue(value: unknown): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "Property IDs must be an array.");
  return value.map((id, index) =>
    positiveInteger(id, `Property ID at position ${index + 1}`, Number.MAX_SAFE_INTEGER)
  );
}
