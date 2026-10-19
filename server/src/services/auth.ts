import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Request, RequestHandler, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import type { PmsDatabase } from "../db/connection.js";
import { HttpError } from "../middleware/http-errors.js";

export const staffRoles = [
  "administrator",
  "front_desk",
  "housekeeping",
  "accounting",
] as const;
export type StaffRole = (typeof staffRoles)[number];

export interface StaffUser {
  id: number;
  displayName: string;
  username: string;
  role: StaffRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthenticatedStaff extends StaffUser {
  tokenHash: string;
  csrfTokenHash: string;
}

const sessionDurationMs = 8 * 60 * 60 * 1000;
const sessionCookieName = "pms_session";
const csrfCookieName = "pms_csrf";
const localFrontendOrigin = configuredLocalFrontendOrigin();
const dummyPasswordHash = bcrypt.hash("constant timing-only value", 12);
const failedLogins = new Map<string, { count: number; resetAt: number }>();

export async function createInitialAdministrator(
  database: PmsDatabase,
  input: { displayName: string; username: string; password: string },
) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  const client = database.$client;
  let staffId: number;
  client.exec("BEGIN IMMEDIATE");
  try {
    const count = client.prepare("SELECT COUNT(*) AS count FROM staff_accounts").get();
    if (integerValue(count?.count) > 0) {
      throw new HttpError(409, "Initial administrator setup is already complete.");
    }
    const result = client.prepare(`
      INSERT INTO staff_accounts (display_name, username, password_hash, role)
      VALUES (?, ?, ?, 'administrator')
    `).run(input.displayName, input.username, passwordHash);
    client.exec("COMMIT");
    staffId = Number(result.lastInsertRowid);
  } catch (error) {
    client.exec("ROLLBACK");
    throw error;
  }
  return createSession(database, staffId);
}

export async function login(
  database: PmsDatabase,
  username: string,
  password: string,
): Promise<{ user: StaffUser; token: string; csrfToken: string; expiresAt: string }> {
  const now = Date.now();
  const attempt = failedLogins.get(username);
  if (attempt && attempt.resetAt > now && attempt.count >= 10) {
    throw new HttpError(429, "Too many sign-in attempts. Wait 15 minutes and try again.");
  }
  const row = database.$client.prepare(`
    SELECT id, display_name, username, password_hash, role, is_active,
      created_at, updated_at
    FROM staff_accounts WHERE username = ?
  `).get(username);
  const hash = typeof row?.password_hash === "string"
    ? row.password_hash
    : await dummyPasswordHash;
  const validPassword = await bcrypt.compare(password, hash);
  if (!row || row.is_active !== 1 || !validPassword) {
    const current = failedLogins.get(username);
    failedLogins.set(username, {
      count: current && current.resetAt > now ? current.count + 1 : 1,
      resetAt: current && current.resetAt > now ? current.resetAt : now + 15 * 60 * 1000,
    });
    throw new HttpError(401, "Username or password is incorrect.");
  }
  failedLogins.delete(username);
  database.$client.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?")
    .run(new Date(now).toISOString());
  return createSession(database, integerValue(row.id));
}

export function createSession(
  database: PmsDatabase,
  staffId: number,
): { user: StaffUser; token: string; csrfToken: string; expiresAt: string } {
  const row = database.$client.prepare(`
    SELECT id, display_name, username, role, is_active, created_at, updated_at
    FROM staff_accounts WHERE id = ? AND is_active = 1
  `).get(staffId);
  if (!row) throw new HttpError(401, "This staff account is inactive.");
  const token = randomBytes(32).toString("hex");
  const csrfToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + sessionDurationMs).toISOString();
  database.$client.prepare(`
    INSERT INTO auth_sessions (token_hash, staff_id, csrf_token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(hashToken(token), staffId, hashToken(csrfToken), expiresAt);
  return {
    user: toStaffUser(row),
    token,
    csrfToken,
    expiresAt,
  };
}

export function attachAuthenticatedStaff(database: PmsDatabase): RequestHandler {
  return (request, _response, next) => {
    const token = cookieValue(request, sessionCookieName);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      next();
      return;
    }
    const row = database.$client.prepare(`
      SELECT a.id, a.display_name, a.username, a.role, a.is_active,
        a.created_at, a.updated_at, s.token_hash, s.csrf_token_hash
      FROM auth_sessions s
      JOIN staff_accounts a ON a.id = s.staff_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND a.is_active = 1
    `).get(hashToken(token), new Date().toISOString());
    if (row) {
      request.auth = {
        ...toStaffUser(row),
        tokenHash: stringValue(row.token_hash),
        csrfTokenHash: stringValue(row.csrf_token_hash),
      };
    }
    next();
  };
}

export function requireAuthenticatedAndAuthorized(): RequestHandler {
  return (request, response, next) => {
    const staff = request.auth;
    if (!staff) {
      response.status(401).json({ error: "Sign in to access this resource." });
      return;
    }
    const path = new URL(request.originalUrl, "http://127.0.0.1").pathname;
    if (!hasPermission(staff.role, request.method, path)) {
      response.status(403).json({ error: "Your staff role does not allow this operation." });
      return;
    }
    if (!isSafeMethod(request.method)) {
      try {
        assertLocalOrigin(request);
      } catch (error) {
        next(error);
        return;
      }
      const cookieToken = cookieValue(request, csrfCookieName);
      const headerToken = request.get("x-csrf-token");
      if (
        !cookieToken ||
        !headerToken ||
        !constantTimeTokenMatch(cookieToken, headerToken) ||
        !constantTimeTokenMatch(hashToken(cookieToken), staff.csrfTokenHash)
      ) {
        response.status(403).json({ error: "The security token is missing or invalid. Refresh the page and retry." });
        return;
      }
    }
    next();
  };
}

export function assertLocalOrigin(request: Request): void {
  const origin = request.get("origin");
  if (!origin || origin !== localFrontendOrigin) {
    throw new HttpError(403, "Requests must originate from the local PMS interface.");
  }
}

export function assertCsrf(request: Request): void {
  const staff = request.auth;
  const cookieToken = cookieValue(request, csrfCookieName);
  const headerToken = request.get("x-csrf-token");
  if (
    !staff ||
    !cookieToken ||
    !headerToken ||
    !constantTimeTokenMatch(cookieToken, headerToken) ||
    !constantTimeTokenMatch(hashToken(cookieToken), staff.csrfTokenHash)
  ) {
    throw new HttpError(403, "The security token is missing or invalid.");
  }
}

export function listStaff(database: PmsDatabase): StaffUser[] {
  return database.$client.prepare(`
    SELECT id, display_name, username, role, is_active, created_at, updated_at
    FROM staff_accounts ORDER BY display_name COLLATE NOCASE, id
  `).all().map(toStaffUser);
}

export async function createStaff(
  database: PmsDatabase,
  input: {
    displayName: string;
    username: string;
    role: StaffRole;
    password: string;
  },
): Promise<StaffUser> {
  const passwordHash = await bcrypt.hash(input.password, 12);
  const result = database.$client.prepare(`
    INSERT INTO staff_accounts (display_name, username, password_hash, role)
    VALUES (?, ?, ?, ?)
  `).run(input.displayName, input.username, passwordHash, input.role);
  return getStaff(database, Number(result.lastInsertRowid));
}

export async function updateStaff(
  database: PmsDatabase,
  id: number,
  input: {
    displayName: string;
    username: string;
    role: StaffRole;
    password?: string;
  },
): Promise<StaffUser> {
  const client = database.$client;
  const passwordHash = input.password ? await bcrypt.hash(input.password, 12) : null;
  client.exec("BEGIN IMMEDIATE");
  try {
    const existing = client.prepare("SELECT id, role, is_active FROM staff_accounts WHERE id = ?").get(id);
    if (!existing) throw new HttpError(404, "Staff account not found.");
    const nextRole = input.role;
    assertActiveAdministratorRemains(
      client,
      id,
      existing.is_active === 1 && nextRole === "administrator",
    );
    client.prepare(`
      UPDATE staff_accounts
      SET display_name = ?, username = ?, role = ?, password_hash = COALESCE(?, password_hash),
        updated_at = ?
      WHERE id = ?
    `).run(
      input.displayName,
      input.username,
      nextRole,
      passwordHash,
      new Date().toISOString(),
      id,
    );
    client.prepare("DELETE FROM auth_sessions WHERE staff_id = ?").run(id);
    client.exec("COMMIT");
  } catch (error) {
    client.exec("ROLLBACK");
    throw error;
  }
  return getStaff(database, id);
}

export function setStaffActive(
  database: PmsDatabase,
  id: number,
  isActive: boolean,
): StaffUser {
  const client = database.$client;
  client.exec("BEGIN IMMEDIATE");
  try {
    const existing = client.prepare("SELECT id, role, is_active FROM staff_accounts WHERE id = ?").get(id);
    if (!existing) throw new HttpError(404, "Staff account not found.");
    assertActiveAdministratorRemains(
      client,
      id,
      isActive && existing.role === "administrator",
    );
    client.prepare("UPDATE staff_accounts SET is_active = ?, updated_at = ? WHERE id = ?")
      .run(isActive ? 1 : 0, new Date().toISOString(), id);
    if (!isActive) client.prepare("DELETE FROM auth_sessions WHERE staff_id = ?").run(id);
    client.exec("COMMIT");
  } catch (error) {
    client.exec("ROLLBACK");
    throw error;
  }
  return getStaff(database, id);
}

export function accountCount(database: PmsDatabase): number {
  const row = database.$client.prepare("SELECT COUNT(*) AS count FROM staff_accounts").get();
  return integerValue(row?.count);
}

export function setSessionCookies(
  response: Response,
  session: { token: string; csrfToken: string; expiresAt: string },
): void {
  const maxAgeSeconds = Math.max(0, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000));
  response.setHeader("Set-Cookie", [
    `${sessionCookieName}=${session.token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`,
    `${csrfCookieName}=; Path=/api; SameSite=Strict; Max-Age=0`,
    `${csrfCookieName}=${session.csrfToken}; Path=/; SameSite=Strict; Max-Age=${maxAgeSeconds}`,
  ]);
}

export function clearSessionCookies(response: Response): void {
  response.setHeader("Set-Cookie", [
    `${sessionCookieName}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0`,
    `${csrfCookieName}=; Path=/api; SameSite=Strict; Max-Age=0`,
    `${csrfCookieName}=; Path=/; SameSite=Strict; Max-Age=0`,
  ]);
}

export function deleteCurrentSession(database: PmsDatabase, request: Request): void {
  if (request.auth) {
    database.$client.prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
      .run(request.auth.tokenHash);
  }
}

export function userFromRequest(request: Request): StaffUser | null {
  if (!request.auth) return null;
  const { tokenHash: _tokenHash, csrfTokenHash: _csrfTokenHash, ...user } = request.auth;
  return user;
}

export function hasPermission(role: StaffRole, method: string, path: string): boolean {
  const isGet = method === "GET";
  const isPropertiesRead = isGet &&
    /^\/api\/properties(?:\/[^/]+)?(?:\/units(?:\/[^/]+)?)?$/.test(path);
  const isPropertyWrite =
    (method === "POST" && /^\/api\/properties$|^\/api\/properties\/[^/]+\/units$/.test(path)) ||
    (method === "PUT" && /^\/api\/properties\/[^/]+$|^\/api\/properties\/[^/]+\/units\/[^/]+$/.test(path)) ||
    (method === "PATCH" && /^\/api\/properties\/[^/]+\/(?:status|units\/[^/]+\/status)$/.test(path)) ||
    (method === "DELETE" && /^\/api\/properties\/[^/]+$|^\/api\/properties\/[^/]+\/units\/[^/]+$/.test(path));
  const isGuest =
    (isGet && /^\/api\/guests(?:\/[^/]+)?$/.test(path)) ||
    (method === "POST" && /^\/api\/guests$|^\/api\/guests\/[^/]+\/(?:archive|restore)$/.test(path)) ||
    (method === "PATCH" && /^\/api\/guests\/[^/]+$/.test(path));
  const isReservation =
    (isGet && /^\/api\/reservations(?:\/availability|\/[^/]+)?$/.test(path)) ||
    (method === "POST" && /^\/api\/reservations$|^\/api\/reservations\/[^/]+\/(?:check-in|check-out)$/.test(path)) ||
    (method === "PUT" && /^\/api\/reservations\/[^/]+$/.test(path)) ||
    (method === "PATCH" && /^\/api\/reservations\/[^/]+\/status$/.test(path)) ||
    (method === "DELETE" && /^\/api\/reservations\/[^/]+$/.test(path));
  const isFrontDesk = isGet && path === "/api/front-desk";
  const isHousekeepingRead = isGet && path === "/api/housekeeping";
  const isHousekeepingWrite = method === "PATCH" &&
    /^\/api\/housekeeping\/units\/[^/]+\/status$/.test(path);
  const isInvoiceRead = isGet &&
    /^\/api\/invoices(?:\/reservations(?:\/[^/]+)?|\/[^/]+)?$/.test(path);
  const isInvoiceWrite =
    (method === "POST" && /^\/api\/invoices$|^\/api\/invoices\/[^/]+\/(?:issue|void|payments)$/.test(path)) ||
    (method === "PUT" && /^\/api\/invoices\/[^/]+$/.test(path));
  const isReport = isGet &&
    /^\/api\/reports\/(?:summary|reservations|occupancy|housekeeping|billing)$/.test(path);
  const isStaff =
    (isGet && path === "/api/staff") ||
    (method === "POST" && path === "/api/staff") ||
    (method === "PUT" && /^\/api\/staff\/[^/]+$/.test(path)) ||
    (method === "PATCH" && /^\/api\/staff\/[^/]+\/status$/.test(path));
  const isMaintenanceRead = method === "GET" &&
    /^\/api\/maintenance(?:\/dashboard|\/[^/]+)?$/.test(path);
  const isMaintenanceCreate = method === "POST" && path === "/api/maintenance";
  const isMaintenanceAdminWrite =
    (method === "PUT" && /^\/api\/maintenance\/[^/]+$/.test(path)) ||
    (method === "PATCH" && /^\/api\/maintenance\/[^/]+\/status$/.test(path));
  const supportedOperation = isPropertiesRead || isPropertyWrite || isGuest ||
    isReservation || isFrontDesk || isHousekeepingRead || isHousekeepingWrite ||
    isInvoiceRead || isInvoiceWrite || isReport || isStaff || isMaintenanceRead ||
    isMaintenanceCreate || isMaintenanceAdminWrite;
  if (!supportedOperation) return false;

  switch (role) {
    case "administrator":
      return true;
    case "front_desk":
      return isPropertiesRead || isGuest || isReservation || isFrontDesk ||
        isInvoiceRead || isMaintenanceRead || isMaintenanceCreate;
    case "housekeeping":
      return isHousekeepingRead || isHousekeepingWrite ||
        isMaintenanceRead || isMaintenanceCreate;
    case "accounting":
      return (
        isInvoiceRead ||
        isInvoiceWrite ||
        isReport
      );
    default:
      return false;
  }
}

function assertActiveAdministratorRemains(
  client: DatabaseSync,
  targetId: number,
  targetWillRemainAdministrator: boolean,
): void {
  if (targetWillRemainAdministrator) return;
  const activeAdmins = integerValue(client.prepare(`
    SELECT COUNT(*) AS count FROM staff_accounts
    WHERE role = 'administrator' AND is_active = 1 AND id <> ?
  `).get(targetId)?.count);
  const target = client.prepare("SELECT id FROM staff_accounts WHERE id = ?").get(targetId);
  if (target && activeAdmins === 0) {
    const current = client.prepare("SELECT role, is_active FROM staff_accounts WHERE id = ?").get(targetId);
    if (current?.role === "administrator" && current.is_active === 1) {
      throw new HttpError(409, "At least one active administrator must remain.");
    }
  }
}

function getStaff(database: PmsDatabase, id: number): StaffUser {
  const row = database.$client.prepare(`
    SELECT id, display_name, username, role, is_active, created_at, updated_at
    FROM staff_accounts WHERE id = ?
  `).get(id);
  if (!row) throw new HttpError(404, "Staff account not found.");
  return toStaffUser(row);
}

function toStaffUser(row: Record<string, unknown>): StaffUser {
  const role = stringValue(row.role);
  if (!staffRoles.includes(role as StaffRole)) {
    throw new Error("Database returned an invalid staff role.");
  }
  return {
    id: integerValue(row.id),
    displayName: stringValue(row.display_name),
    username: stringValue(row.username),
    role: role as StaffRole,
    isActive: row.is_active === 1 || row.is_active === true,
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
  };
}

function cookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
    return pair.slice(separator + 1).trim() || null;
  }
  return null;
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeTokenMatch(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function configuredLocalFrontendOrigin(): string {
  const value = process.env.PMS_FRONTEND_ORIGIN ?? "http://127.0.0.1:5173";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("PMS_FRONTEND_ORIGIN must be an exact http://127.0.0.1 origin.");
  }
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.origin !== value
  ) {
    throw new Error("PMS_FRONTEND_ORIGIN must be an exact http://127.0.0.1 origin.");
  }
  return value;
}

function integerValue(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  throw new Error("Database returned an invalid staff account value.");
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  throw new Error("Database returned an invalid staff account text value.");
}
