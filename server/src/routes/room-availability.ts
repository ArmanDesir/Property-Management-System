import { Router } from "express";
import type { Request } from "express";
import type { PmsDatabase } from "../db/connection.js";
import { HttpError } from "../middleware/http-errors.js";
import { parseRecordId } from "../services/validation.js";
import {
  getRoomAvailability,
  listCalendarProperties,
  validateCalendarDate,
} from "../services/room-availability.js";

export function createRoomAvailabilityRouter(database: PmsDatabase): Router {
  const router = Router();
  router.get("/properties", (request, response) => {
    if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
    response.json({ properties: listCalendarProperties(database, request.auth) });
  });
  router.get("/:propertyId", (request, response) => {
    if (!request.auth) throw new HttpError(401, "Sign in to access this resource.");
    const from = queryValue(request, "from");
    const to = queryValue(request, "to");
    const checkIn = queryValue(request, "checkIn");
    const checkOut = queryValue(request, "checkOut");
    if ((checkIn === undefined) !== (checkOut === undefined)) {
      throw new HttpError(400, "Both requested stay dates must be provided.");
    }
    const parsedFrom = validateCalendarDate(from, "Calendar start");
    const parsedTo = validateCalendarDate(to, "Calendar end");
    const parsedCheckIn = checkIn === undefined ? null : validateCalendarDate(checkIn, "Check-in date");
    const parsedCheckOut = checkOut === undefined ? null : validateCalendarDate(checkOut, "Check-out date");
    if (parsedCheckIn !== null && parsedCheckOut !== null && parsedCheckOut <= parsedCheckIn) {
      throw new HttpError(400, "Check-out date must be after check-in date.");
    }
    response.json({
      availability: getRoomAvailability(database, request.auth, {
        propertyId: parseRecordId(request.params.propertyId),
        from: parsedFrom,
        to: parsedTo,
        checkIn: parsedCheckIn,
        checkOut: parsedCheckOut,
      }),
    });
  });
  return router;
}

function queryValue(request: Request, name: string): string {
  const value = request.query[name];
  if (typeof value !== "string") throw new HttpError(400, `${name} is required.`);
  return value;
}
