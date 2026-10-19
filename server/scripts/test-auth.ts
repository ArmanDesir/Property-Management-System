import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";
import { hasPermission } from "../src/services/auth.js";
import { createTestApiClient } from "./test-api-client.js";

const testDirectory = mkdtempSync(resolve(tmpdir(), "local-pms-auth-test-"));
const database = createDatabase(resolve(testDirectory, "auth-test.sqlite"));
const migrationsFolder = resolve(process.cwd(), "src/db/migrations");
let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;

try {
  await runMigrations(database, migrationsFolder);
  server = createApp(database).listen(0, "127.0.0.1");
  await new Promise<void>((resolveListening, reject) => {
    server?.once("listening", resolveListening);
    server?.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  assert.equal(address.address, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const anonymous = await createTestApiClient(baseUrl, false);
  assert.equal((await anonymous("/health")).status, 200);
  assert.equal((await anonymous("/staff")).status, 401);
  assert.equal((await anonymous("/properties")).status, 401);

  const admin = await createTestApiClient(baseUrl);
  assert.equal((await admin("/auth/me")).status, 200);
  assert.equal((await admin("/auth/status")).data.setupRequired, false);
  assert.equal(
    (await anonymous("/auth/setup", "POST", {
      displayName: "Second Administrator",
      username: "second-admin",
      password: "synthetic-test-password-456",
    })).status,
    403,
  );

  const staffList = await admin("/staff");
  assert.equal(staffList.status, 200);
  assert.equal(staffList.data.staff.length, 1);
  assert.equal(JSON.stringify(staffList.data).includes("password_hash"), false);
  assert.equal(JSON.stringify(staffList.data).includes("$2"), false);
  const adminId = staffList.data.staff[0].id as number;

  const invalidUser = await admin("/staff", "POST", {
    displayName: "Invalid",
    username: "x",
    role: "administrator",
    password: "short",
  });
  assert.equal(invalidUser.status, 400);
  const createdFrontDesk = await admin("/staff", "POST", {
    displayName: "Synthetic Front Desk",
    username: "front-desk",
    role: "front_desk",
    password: "synthetic-frontdesk-password",
  });
  assert.equal(createdFrontDesk.status, 201);
  const frontDeskId = createdFrontDesk.data.staff.id as number;
  assert.equal(createdFrontDesk.data.staff.isActive, true);
  const duplicateUsername = await admin("/staff", "POST", {
    displayName: "Duplicate",
    username: "FRONT-DESK",
    role: "housekeeping",
    password: "synthetic-housekeeping-password",
  });
  assert.equal(duplicateUsername.status, 409);

  const createdHousekeeping = await admin("/staff", "POST", {
    displayName: "Synthetic Housekeeping",
    username: "housekeeping",
    role: "housekeeping",
    password: "synthetic-housekeeping-password",
  });
  assert.equal(createdHousekeeping.status, 201);
  const createdAccounting = await admin("/staff", "POST", {
    displayName: "Synthetic Accounting",
    username: "accounting",
    role: "accounting",
    password: "synthetic-accounting-password",
  });
  assert.equal(createdAccounting.status, 201);

  const propertyResult = await admin("/properties", "POST", {
    name: "Synthetic Access Property",
    propertyType: "hotel",
    defaultCurrency: "USD",
  });
  assert.equal(propertyResult.status, 201);
  const propertyId = propertyResult.data.property.id as number;
  const unitResult = await admin(`/properties/${propertyId}/units`, "POST", {
    name: "A-01",
    capacity: 2,
    baseNightlyRate: 100,
  });
  assert.equal(unitResult.status, 201);
  const guestResult = await admin("/guests", "POST", {
    firstName: "Synthetic",
    lastName: "Access Guest",
    email: "access@example.test",
  });
  assert.equal(guestResult.status, 201);
  const reservationResult = await admin("/reservations", "POST", {
    guestId: guestResult.data.guest.id,
    unitId: unitResult.data.unit.id,
    checkIn: "2032-01-01",
    checkOut: "2032-01-03",
    numberOfGuests: 1,
  });
  assert.equal(reservationResult.status, 201);
  const invoiceResult = await admin("/invoices", "POST", {
    reservationId: reservationResult.data.reservation.id,
    issueDate: "2031-12-01",
    items: [{ description: "Synthetic stay", quantity: 1, unitPrice: "100.00" }],
  });
  assert.equal(invoiceResult.status, 201);

  const noCsrf = await admin("/guests", "POST", {
    firstName: "Blocked",
    lastName: "Request",
    email: "blocked@example.test",
  }, { csrf: false });
  assert.equal(noCsrf.status, 403);
  const foreignOrigin = await admin("/guests", "POST", {
    firstName: "Blocked",
    lastName: "Origin",
    email: "origin@example.test",
  }, { origin: "https://attacker.invalid" });
  assert.equal(foreignOrigin.status, 403);
  assert.equal(
    (await admin("/missing-protected-route")).status,
    403,
  );

  const frontDeskLogin = await admin.login("front-desk", "synthetic-frontdesk-password");
  assert.equal(frontDeskLogin.status, 200);
  assert.equal(frontDeskLogin.data.user.role, "front_desk");
  assert.equal((await admin("/properties")).status, 200);
  assert.equal((await admin("/guests")).status, 200);
  assert.equal((await admin("/reservations")).status, 200);
  assert.equal((await admin("/invoices")).status, 200);
  assert.equal((await admin("/properties", "POST", { name: "Denied" })).status, 403);
  assert.equal((await admin("/invoices", "POST", {})).status, 403);
  assert.equal((await admin("/housekeeping")).status, 403);
  assert.equal((await admin("/reports/summary?from=2030-01-01&to=2030-01-01")).status, 403);
  assert.equal((await admin("/staff")).status, 403);

  const housekeepingLogin = await admin.login(
    "housekeeping",
    "synthetic-housekeeping-password",
  );
  assert.equal(housekeepingLogin.status, 200);
  const housekeeping = await admin("/housekeeping");
  assert.equal(housekeeping.status, 200);
  assert.equal(JSON.stringify(housekeeping.data).includes("guestName"), false);
  assert.equal(
    (await admin(`/housekeeping/units/${unitResult.data.unit.id}/status`, "PATCH", {
      status: "cleaning",
    })).status,
    200,
  );
  assert.equal((await admin("/guests")).status, 403);
  assert.equal((await admin("/properties")).status, 403);
  assert.equal((await admin("/staff")).status, 403);
  assert.equal(
    (await admin("/guests", "POST", {
      firstName: "Blocked",
      lastName: "Role",
      email: "role@example.test",
    })).status,
    403,
  );

  const accountingLogin = await admin.login(
    "accounting",
    "synthetic-accounting-password",
  );
  assert.equal(accountingLogin.status, 200);
  assert.equal((await admin("/invoices")).status, 200);
  assert.equal(
    (await admin("/reports/summary?from=2030-01-01&to=2030-01-01")).status,
    200,
  );
  assert.equal((await admin("/guests")).status, 403);
  assert.equal((await admin("/reservations")).status, 403);
  assert.equal((await admin("/housekeeping")).status, 403);

  await admin.login("test-admin", "synthetic-test-password-123");
  const updatedStaff = await admin("/staff/" + frontDeskId, "PUT", {
    displayName: "Updated Synthetic Front Desk",
    username: "front-desk",
    role: "front_desk",
    password: "",
  });
  assert.equal(updatedStaff.status, 200);
  const deactivated = await admin(`/staff/${frontDeskId}/status`, "PATCH", {
    isActive: false,
  });
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.data.staff.isActive, false);
  assert.equal(
    (await admin.login("front-desk", "synthetic-frontdesk-password")).status,
    401,
  );
  const reactivated = await admin(`/staff/${frontDeskId}/status`, "PATCH", {
    isActive: true,
  });
  assert.equal(reactivated.status, 200);
  assert.equal(reactivated.data.staff.isActive, true);
  assert.equal(
    (await admin.login("front-desk", "synthetic-frontdesk-password")).status,
    200,
  );

  await admin.login("test-admin", "synthetic-test-password-123");
  assert.equal(
    (await admin(`/staff/${adminId}/status`, "PATCH", { isActive: false })).status,
    409,
  );
  assert.equal(
    (await admin(`/staff/${adminId}`, "PUT", {
      displayName: "Synthetic Test Administrator",
      username: "test-admin",
      role: "front_desk",
    })).status,
    409,
  );

  assert.equal(hasPermission("administrator", "GET", "/api/unknown"), false);
  assert.equal(hasPermission("housekeeping", "PATCH", "/api/guests/1"), false);
  assert.equal(hasPermission("accounting", "GET", "/api/invoices"), true);
  assert.equal(hasPermission("front_desk", "POST", "/api/invoices"), false);

  const me = await admin("/auth/me");
  assert.equal(me.status, 200);
  const logout = await admin("/auth/logout", "POST");
  assert.equal(logout.status, 204);
  assert.equal((await admin("/properties")).status, 401);

  console.log("Authentication and authorization integration tests passed.");
} finally {
  if (server) {
    await new Promise<void>((resolveClose, reject) => {
      server?.close((error) => error ? reject(error) : resolveClose());
    });
  }
  database.$client.close();
  rmSync(testDirectory, { recursive: true, force: true });
}
