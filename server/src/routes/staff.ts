import { Router } from "express";
import type { PmsDatabase } from "../db/connection.js";
import { asyncHandler, HttpError } from "../middleware/http-errors.js";
import { parseRecordId, requireObject, requiredText } from "../services/validation.js";
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

  router.get("/", (_request, response) => {
    response.json({ staff: listStaff(database) });
  });

  router.post(
    "/",
    asyncHandler(async (request, response) => {
      const body = requireObject(request.body);
      rejectFields(body, new Set(["displayName", "username", "role", "password"]));
      const staff = await createStaff(database, {
        displayName: requiredText(body.displayName, "Display name", 100),
        username: usernameValue(body.username),
        role: staffRoleValue(body.role),
        password: passwordValue(body.password),
      });
      response.status(201).json({ staff });
    }),
  );

  router.put(
    "/:staffId",
    asyncHandler(async (request, response) => {
      const body = requireObject(request.body);
      rejectFields(body, new Set(["displayName", "username", "role", "password"]));
      const input = {
        displayName: requiredText(body.displayName, "Display name", 100),
        username: usernameValue(body.username),
        role: staffRoleValue(body.role),
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
