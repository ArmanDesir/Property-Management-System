import { Router } from "express";
import type { Request } from "express";
import type { PmsDatabase } from "../db/connection.js";
import { HttpError } from "../middleware/http-errors.js";
import { getPropertyManagerDashboard, validateCalendarDate } from "../services/room-availability.js";

export function createManagerRouter(database: PmsDatabase): Router {
  const router = Router();
  router.get("/dashboard", (request, response) => {
    if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
    const value = request.query.date;
    if (typeof value !== "string") throw new HttpError(400, "Dashboard date is required.");
    response.json({
      dashboard: getPropertyManagerDashboard(
        database,
        request.auth,
        validateCalendarDate(value, "Dashboard date"),
      ),
    });
  });
  return router;
}
