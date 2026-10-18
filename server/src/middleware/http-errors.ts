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

  if (isDatabaseError(error, "SQLITE_CONSTRAINT_UNIQUE")) {
    response.status(409).json({ error: "A unit with this name already exists in this property." });
    return;
  }

  if (isDatabaseError(error, "SQLITE_CONSTRAINT_FOREIGNKEY")) {
    response.status(409).json({ error: "This record is still referenced and cannot be removed." });
    return;
  }

  if (isDatabaseError(error, "SQLITE_CONSTRAINT_CHECK")) {
    response.status(400).json({ error: "One or more values violate a database constraint." });
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

function isDatabaseError(error: unknown, code: string): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if ("code" in current && current.code === code) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
