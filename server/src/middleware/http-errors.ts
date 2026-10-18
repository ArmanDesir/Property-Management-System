import type { ErrorRequestHandler, RequestHandler } from "express";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function asyncHandler(
  handler: (request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) => Promise<void>,
): RequestHandler {
  return (request, response, next) => {
    void handler(request, response).catch(next);
  };
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.message });
    return;
  }

  if (isDatabaseError(error, "SQLITE_CONSTRAINT_UNIQUE", 2067)) {
    response.status(409).json({
      error: databaseErrorMessage(error).includes("reservations.reservation_reference")
        ? "A reservation reference collision occurred; retry the request."
        : "A unit with this name already exists in this property.",
    });
    return;
  }

  if (isDatabaseError(error, "SQLITE_CONSTRAINT_TRIGGER", 1811)) {
    const triggerMessage = databaseErrorMessage(error);
    if (triggerMessage.includes("unit_has_active_stay")) {
      response.status(409).json({
        error: "This unit cannot be deactivated, archived, or put into maintenance while a guest is checked in.",
      });
      return;
    }
    if (triggerMessage.includes("reservation_has_active_stay")) {
      response.status(409).json({
        error: "Check out the guest before completing or cancelling this reservation.",
      });
      return;
    }
    if (triggerMessage.includes("reservation_stay_conflict")) {
      response.status(409).json({
        error: "The stay transition is invalid or the unit is already occupied.",
      });
      return;
    }
    response.status(409).json({
      error: "The reservation conflicts with current availability or record status.",
    });
    return;
  }

  if (isDatabaseError(error, "SQLITE_CONSTRAINT_FOREIGNKEY", 787)) {
    response.status(409).json({ error: "This record is still referenced and cannot be removed." });
    return;
  }

  if (isDatabaseError(error, "SQLITE_CONSTRAINT_CHECK", 275)) {
    response.status(400).json({ error: "One or more values violate a database constraint." });
    return;
  }

  if (
    isDatabaseError(error, "SQLITE_BUSY", 5) ||
    isDatabaseError(error, "SQLITE_LOCKED", 6)
  ) {
    response.status(503).json({
      error: "The local database is busy. Retry the reservation request.",
    });
    return;
  }

  const status = typeof error === "object" && error !== null && "status" in error
    ? error.status
    : undefined;
  if (status === 400 && error instanceof Error) {
    response.status(400).json({ error: error.message });
    return;
  }

  console.error("Unhandled API error:", error);
  response.status(500).json({ error: "An unexpected server error occurred." });
};

function databaseErrorMessage(error: unknown): string {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current.message) return current.message;
    current = "cause" in current ? current.cause : undefined;
  }
  return "";
}

function isDatabaseError(error: unknown, code: string, errorNumber: number): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if (
      "code" in current &&
      (current.code === code ||
        (current.code === "ERR_SQLITE_ERROR" &&
          "errcode" in current &&
          current.errcode === errorNumber))
    ) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
