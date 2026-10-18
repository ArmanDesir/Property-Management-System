import { Router } from "express";
import type { PmsDatabase } from "../db/connection.js";
import { asyncHandler, HttpError } from "../middleware/http-errors.js";
import {
  listFrontDesk,
} from "../services/front-desk.js";

export function createFrontDeskRouter(database: PmsDatabase): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (request, response) => {
      const date = request.query.date === undefined
        ? localDate(new Date())
        : parseDate(request.query.date);
      response.json({ frontDesk: listFrontDesk(database, date) });
    }),
  );

  return router;
}

function parseDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, "Date must be supplied once in YYYY-MM-DD format.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new HttpError(400, "Date must be a valid calendar date.");
  }
  return value;
}

function localDate(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}
