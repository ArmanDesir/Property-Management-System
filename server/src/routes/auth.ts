import { randomBytes, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { PmsDatabase } from "../db/connection.js";
import { asyncHandler, HttpError } from "../middleware/http-errors.js";
import {
  accountCount,
  assertCsrf,
  assertLocalOrigin,
  clearSessionCookies,
  createInitialAdministrator,
  deleteCurrentSession,
  login,
  setSessionCookies,
  userFromRequest,
} from "../services/auth.js";
import {
  enumValue,
  requiredText,
  requireObject,
} from "../services/validation.js";

export function createAuthRouter(database: PmsDatabase): Router {
  const router = Router();
  let setupChallenge: { token: string; expiresAt: number } | null = null;

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/status", (_request, response) => {
    const setupRequired = accountCount(database) === 0;
    if (!setupRequired) {
      setupChallenge = null;
      response.json({ setupRequired: false });
      return;
    }
    if (!setupChallenge || setupChallenge.expiresAt <= Date.now()) {
      setupChallenge = {
        token: randomBytes(32).toString("hex"),
        expiresAt: Date.now() + 5 * 60 * 1000,
      };
    }
    response.json({
      setupRequired: true,
      setupToken: setupChallenge.token,
    });
  });

  router.post(
    "/setup",
    asyncHandler(async (request, response) => {
      assertLocalOrigin(request);
      if (
        !setupChallenge ||
        setupChallenge.expiresAt <= Date.now() ||
        !safeEqual(request.get("x-setup-token") ?? "", setupChallenge.token)
      ) {
        throw new HttpError(403, "Administrator setup token is missing or expired. Reload the page.");
      }
      if (accountCount(database) > 0) {
        setupChallenge = null;
        throw new HttpError(409, "Initial administrator setup is already complete.");
      }
      const input = parseInitialAdministrator(request.body);
      const session = await createInitialAdministrator(database, input);
      setupChallenge = null;
      setSessionCookies(response, session);
      response.status(201).json({ user: session.user });
    }),
  );

  router.post(
    "/login",
    asyncHandler(async (request, response) => {
      assertLocalOrigin(request);
      const input = parseLogin(request.body);
      const session = await login(database, input.username, input.password);
      if (request.auth) deleteCurrentSession(database, request);
      setSessionCookies(response, session);
      response.json({ user: session.user });
    }),
  );

  router.get("/me", (request, response) => {
    const user = userFromRequest(request);
    if (!user) {
      response.status(401).json({ error: "Sign in to access this resource." });
      return;
    }
    response.json({ user });
  });

  router.post("/logout", (request, response, next) => {
    try {
      assertLocalOrigin(request);
      if (request.auth) {
        assertCsrf(request);
        deleteCurrentSession(database, request);
      }
      clearSessionCookies(response);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function parseInitialAdministrator(value: unknown) {
  const body = requireObject(value);
  rejectFields(body, new Set(["displayName", "username", "password"]));
  return {
    displayName: requiredText(body.displayName, "Display name", 100),
    username: usernameValue(body.username),
    password: passwordValue(body.password),
  };
}

function parseLogin(value: unknown) {
  const body = requireObject(value);
  rejectFields(body, new Set(["username", "password"]));
  if (typeof body.password !== "string" || body.password.length === 0 || Buffer.byteLength(body.password) > 72) {
    throw new HttpError(400, "Password is required and must be at most 72 UTF-8 bytes.");
  }
  return {
    username: usernameValue(body.username),
    password: body.password,
  };
}

export function usernameValue(value: unknown): string {
  const normalized = requiredText(value, "Username", 32).toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/.test(normalized)) {
    throw new HttpError(
      400,
      "Username must be 3–32 characters using letters, numbers, dots, underscores, or hyphens.",
    );
  }
  return normalized;
}

export function passwordValue(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 12 ||
    Buffer.byteLength(value, "utf8") > 72
  ) {
    throw new HttpError(400, "Password must be at least 12 characters and at most 72 UTF-8 bytes.");
  }
  return value;
}

export function rejectFields(
  body: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
): void {
  const invalidField = Object.keys(body).find((key) => !allowedFields.has(key));
  if (invalidField) throw new HttpError(400, `Unsupported field: ${invalidField}.`);
}

export function staffRoleValue(value: unknown) {
  return enumValue(value, "Role", [
    "administrator",
    "property_manager",
    "front_desk",
    "housekeeping",
    "accounting",
  ] as const);
}

function safeEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
