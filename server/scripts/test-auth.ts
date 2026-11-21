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
    (await admin.login("test-admin", "synthetic-incorrect-password")).status,
    401,
  );
  assert.equal((await admin("/auth/me")).status, 200);
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
    password: "",
  });
  assert.equal(invalidUser.status, 400);
  const propertyResult = await admin("/properties", "POST", {
    name: "Synthetic Access Property",
    propertyType: "hotel",
    defaultCurrency: "USD",
  });
  assert.equal(propertyResult.status, 201);
  const propertyId = propertyResult.data.property.id as number;
  const createdFrontDesk = await admin("/staff", "POST", {
    displayName: "Synthetic Front Desk",
    username: "front-desk",
    role: "front_desk",
    password: "synthetic-frontdesk-password",
    propertyIds: [propertyId],
  });
  assert.equal(createdFrontDesk.status, 201);
  const frontDeskId = createdFrontDesk.data.staff.id as number;
  assert.equal(createdFrontDesk.data.staff.isActive, true);
  const duplicateUsername = await admin("/staff", "POST", {
    displayName: "Duplicate",
    username: "FRONT-DESK",
    role: "housekeeping",
    password: "synthetic-housekeeping-password",
    propertyIds: [propertyId],
  });
  assert.equal(duplicateUsername.status, 409);

  const createdHousekeeping = await admin("/staff", "POST", {
    displayName: "Synthetic Housekeeping",
    username: "housekeeping",
    role: "housekeeping",
    password: "synthetic-housekeeping-password",
    propertyIds: [propertyId],
  });
  assert.equal(createdHousekeeping.status, 201);
  const createdAccounting = await admin("/staff", "POST", {
    displayName: "Synthetic Accounting",
    username: "accounting",
    role: "accounting",
    password: "synthetic-accounting-password",
    propertyIds: [propertyId],
  });
  assert.equal(createdAccounting.status, 201);

  const unitResult = await admin(`/properties/${propertyId}/units`, "POST", {
    name: "A-01",
    capacity: 2,
    baseNightlyRate: 100,
  });
  assert.equal(unitResult.status, 201);
  assert.equal(
    (await admin(`/housekeeping/units/${unitResult.data.unit.id}/status`, "PATCH", {
      status: "cleaning",
    })).status,
    200,
  );
  assert.equal(
    (await admin(`/housekeeping/units/${unitResult.data.unit.id}/status`, "PATCH", {
      status: "clean",
    })).status,
    200,
  );
  const outsideProperty = await admin("/properties", "POST", {
    name: "Synthetic Outside Property",
    propertyType: "hotel",
    defaultCurrency: "USD",
  });
  assert.equal(outsideProperty.status, 201);
  const outsideUnit = await admin(`/properties/${outsideProperty.data.property.id}/units`, "POST", {
    name: "B-01",
    capacity: 2,
    baseNightlyRate: 100,
  });
  assert.equal(outsideUnit.status, 201);
  const outsidePropertyId = outsideProperty.data.property.id as number;
  const outsideFrontDesk = await admin("/staff", "POST", {
    displayName: "Synthetic Outside Front Desk",
    username: "outside-front-desk",
    role: "front_desk",
    password: "synthetic-outside-password",
    propertyIds: [outsidePropertyId],
  });
  assert.equal(outsideFrontDesk.status, 201);
  const createdManager = await admin("/staff", "POST", {
    displayName: "Synthetic Property Manager",
    username: "property-manager",
    role: "property_manager",
    password: "synthetic-manager-password",
    propertyIds: [propertyId],
  });
  assert.equal(createdManager.status, 201);
  const guestResult = await admin("/guests", "POST", {
    firstName: "Synthetic",
    lastName: "Access Guest",
    email: "access@example.test",
  });
  assert.equal(guestResult.status, 201);
  const reservationResult = await admin("/reservations", "POST", {
    guestId: guestResult.data.guest.id,
    unitId: unitResult.data.unit.id,
    checkIn: new Date().toISOString().slice(0, 10),
    checkOut: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    numberOfGuests: 1,
  });
  assert.equal(reservationResult.status, 201);
  const outsideReservationResult = await admin("/reservations", "POST", {
    guestId: guestResult.data.guest.id,
    unitId: outsideUnit.data.unit.id,
    checkIn: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    checkOut: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    numberOfGuests: 1,
  });
  assert.equal(outsideReservationResult.status, 201);
  assert.equal(
    (await admin(`/reservations/${reservationResult.data.reservation.id}/status`, "PATCH", {
      status: "confirmed",
    })).status,
    200,
  );
  const invoiceResult = await admin("/invoices", "POST", {
    reservationId: reservationResult.data.reservation.id,
    issueDate: "2031-12-01",
    items: [{ description: "Synthetic stay", quantity: 1, unitPrice: "100.00" }],
  });
  assert.equal(invoiceResult.status, 201);
  const outsideInvoiceResult = await admin("/invoices", "POST", {
    reservationId: outsideReservationResult.data.reservation.id,
    issueDate: "2031-12-02",
    items: [{ description: "Synthetic outside stay", quantity: 1, unitPrice: "150.00" }],
  });
  assert.equal(outsideInvoiceResult.status, 201);

  const rejectedWriteCountBefore = database.$client
    .prepare("SELECT COUNT(*) AS count FROM guests").get()?.count;
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
  const alternateLoopbackPortOrigin = await admin("/guests", "POST", {
    firstName: "Blocked",
    lastName: "Alternate Loopback Port",
    email: "alternate-origin@example.test",
  }, {
    origin: (process.env.PMS_FRONTEND_ORIGIN ?? "http://127.0.0.1:5173") ===
        "http://127.0.0.1:5174"
      ? "http://127.0.0.1:5173"
      : "http://127.0.0.1:5174",
  });
  assert.equal(alternateLoopbackPortOrigin.status, 403);
  assert.equal(
    database.$client.prepare("SELECT COUNT(*) AS count FROM guests").get()?.count,
    rejectedWriteCountBefore,
  );
  assert.equal(
    (await admin("/missing-protected-route")).status,
    403,
  );

  const previousCsrfToken = admin.csrfToken();
  assert.equal(typeof previousCsrfToken, "string");
  const frontDeskLogin = await admin.login("front-desk", "synthetic-frontdesk-password");
  assert.equal(frontDeskLogin.status, 200);
  assert.equal(frontDeskLogin.data.user.role, "front_desk");
  assert.equal((await admin("/housekeeping")).status, 200);
  assert.deepEqual(
    (await admin("/room-availability/properties")).data.properties.map(
      (property: { id: number }) => property.id,
    ),
    [propertyId],
  );
  const frontDeskGuestReservations = await admin(
    `/reservations?guestId=${guestResult.data.guest.id}`,
  );
  assert.deepEqual(
    frontDeskGuestReservations.data.reservations.map(
      (reservation: { id: number }) => reservation.id,
    ),
    [reservationResult.data.reservation.id],
  );
  assert.equal(
    (await admin(`/reservations/${reservationResult.data.reservation.id}/check-in`, "POST")).status,
    200,
  );
  assert.equal(
    (await admin(`/housekeeping/units/${unitResult.data.unit.id}/status`, "PATCH", {
      status: "dirty",
    })).status,
    200,
  );
  assert.equal(
    (await admin(`/housekeeping/units/${unitResult.data.unit.id}/status`, "PATCH", {
      status: "cleaning",
    })).status,
    403,
  );
  assert.equal(
    (await admin(`/reservations/${reservationResult.data.reservation.id}/check-out`, "POST")).status,
    200,
  );
  assert.equal((await admin("/classroom/status")).status, 403);
  const loginCookies = frontDeskLogin.response.headers.getSetCookie();
  assert.ok(loginCookies.some((cookie) =>
    cookie.startsWith("pms_session=") &&
    /(?:^|;\s*)Path=\/api(?:;|$)/.test(cookie) &&
    /(?:^|;\s*)HttpOnly(?:;|$)/.test(cookie)
  ));
  assert.ok(loginCookies.some((cookie) =>
    cookie.startsWith("pms_csrf=") &&
    /(?:^|;\s*)Path=\/(?:;|$)/.test(cookie) &&
    /(?:^|;\s*)SameSite=Strict(?:;|$)/.test(cookie)
  ));
  assert.ok(loginCookies.some((cookie) =>
    cookie.startsWith("pms_csrf=") &&
    /(?:^|;\s*)Path=\/api(?:;|$)/.test(cookie) &&
    /(?:^|;\s*)Max-Age=0(?:;|$)/.test(cookie)
  ));
  const refreshedToken = admin.csrfToken();
  assert.equal(typeof refreshedToken, "string");
  assert.equal(refreshedToken !== previousCsrfToken, true);
  const invalidCsrfCountBefore = database.$client
    .prepare("SELECT COUNT(*) AS count FROM guests").get()?.count;
  assert.equal(
    (await admin(`/guests?propertyId=${propertyId}`, "POST", {
      firstName: "Rejected",
      lastName: "Invalid CSRF",
      email: "invalid-csrf@example.test",
    }, { csrf: "0".repeat(64) })).status,
    403,
  );
  assert.equal(
    (await admin("/guests", "POST", {
      firstName: "Rejected",
      lastName: "Stale CSRF",
      email: "stale-csrf@example.test",
    }, { csrf: previousCsrfToken ?? "" })).status,
    403,
  );
  assert.equal(
    database.$client.prepare("SELECT COUNT(*) AS count FROM guests").get()?.count,
    invalidCsrfCountBefore,
  );
  assert.equal(
    (await admin(`/guests?propertyId=${propertyId}`, "POST", {
      firstName: "Synthetic",
      lastName: "Refreshed CSRF",
      email: "refreshed-csrf@example.test",
    })).status,
    201,
  );
  assert.equal((await admin("/properties")).status, 200);
  assert.equal((await admin("/guests")).status, 200);
  assert.equal((await admin("/reservations")).status, 200);
  const frontDeskInvoices = await admin("/invoices");
  assert.deepEqual(
    frontDeskInvoices.data.invoices.map((invoice: { id: number }) => invoice.id),
    [invoiceResult.data.invoice.id],
  );
  assert.equal((await admin("/invoices")).status, 200);
  assert.equal((await admin("/properties", "POST", { name: "Denied" })).status, 403);
  assert.equal((await admin("/invoices", "POST", {})).status, 403);
  assert.equal((await admin("/housekeeping")).status, 200);
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
  assert.equal(
    (await admin(`/housekeeping/units/${unitResult.data.unit.id}/status`, "PATCH", {
      status: "clean",
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
  const manager = await createTestApiClient(baseUrl, false);
  assert.equal(
    (await manager.login("property-manager", "synthetic-manager-password")).status,
    200,
  );
  const managerHousekeeping = await manager("/housekeeping");
  assert.equal(managerHousekeeping.status, 200);
  assert.equal(managerHousekeeping.data.housekeeping.units.length, 1);
  assert.equal(managerHousekeeping.data.housekeeping.units[0].propertyId, propertyId);
  assert.equal(
    (await manager(`/housekeeping/units/${unitResult.data.unit.id}/status`, "PATCH", {
      status: "dirty",
    })).status,
    200,
  );
  assert.equal(
    (await manager(`/housekeeping/units/${unitResult.data.unit.id}/status`, "PATCH", {
      status: "cleaning",
    })).status,
    403,
  );
  assert.equal(
    (await manager(`/housekeeping/units/${outsideUnit.data.unit.id}/status`, "PATCH", {
      status: "dirty",
    })).status,
    404,
  );
  assert.equal(
    (await manager(`/housekeeping?propertyId=${outsideProperty.data.property.id}`)).status,
    404,
  );
  const managerStaff = await manager("/staff");
  assert.equal(managerStaff.status, 200);
  assert.equal(
    managerStaff.data.staff.some((user: { id: number }) => user.id === outsideFrontDesk.data.staff.id),
    false,
  );
  assert.equal(
    (await manager(`/staff?propertyId=${outsidePropertyId}`)).status,
    404,
  );
  const managerMaintenanceOptions = await manager("/maintenance/options");
  assert.equal(managerMaintenanceOptions.status, 200);
  assert.equal(
    managerMaintenanceOptions.data.staff.some(
      (user: { id: number }) => user.id === outsideFrontDesk.data.staff.id,
    ),
    false,
  );
  assert.equal(
    (await manager("/maintenance", "POST", {
      propertyId,
      title: "Cross-property assignment",
      description: "Synthetic request",
      category: "other",
      assignedStaffId: outsideFrontDesk.data.staff.id,
    })).status,
    400,
  );
  const outsideClient = await createTestApiClient(baseUrl, false);
  assert.equal(
    (await outsideClient.login("outside-front-desk", "synthetic-outside-password")).status,
    200,
  );
  assert.deepEqual(
    (await outsideClient("/room-availability/properties")).data.properties.map(
      (property: { id: number }) => property.id,
    ),
    [outsidePropertyId],
  );
  const outsideHousekeeping = await outsideClient("/housekeeping");
  assert.equal(outsideHousekeeping.data.housekeeping.units.length, 1);
  assert.equal(
    (await outsideClient(`/housekeeping?propertyId=${propertyId}`)).status,
    404,
  );
  const matchingGuest = await outsideClient(
    `/guests/match?propertyId=${outsidePropertyId}&email=access%40example.test`,
  );
  assert.equal(matchingGuest.status, 200);
  assert.equal(matchingGuest.data.guest.id, guestResult.data.guest.id);
  const outsideGuest = await outsideClient(
    `/guests/${guestResult.data.guest.id}?propertyId=${outsidePropertyId}`,
  );
  assert.equal(outsideGuest.status, 200);
  assert.equal(
    (await outsideClient(`/guests/${guestResult.data.guest.id}?propertyId=${propertyId}`)).status,
    404,
  );
  const outsideInvoices = await outsideClient("/invoices");
  assert.deepEqual(
    outsideInvoices.data.invoices.map((invoice: { id: number }) => invoice.id),
    [outsideInvoiceResult.data.invoice.id],
  );
  assert.equal(
    (await outsideClient(`/invoices/${invoiceResult.data.invoice.id}`)).status,
    404,
  );
  const outsideGuestReservations = await outsideClient(
    `/reservations?guestId=${guestResult.data.guest.id}`,
  );
  assert.deepEqual(
    outsideGuestReservations.data.reservations.map((reservation: { id: number }) => reservation.id),
    [outsideReservationResult.data.reservation.id],
  );

  const accountingLogin = await admin.login(
    "accounting",
    "synthetic-accounting-password",
  );
  assert.equal(accountingLogin.status, 200);
  assert.equal((await admin("/reports/summary?from=2030-01-01&to=2030-01-01")).status, 400);
  assert.equal(
    (await admin(`/reports/summary?from=2030-01-01&to=2030-01-01&propertyId=${outsidePropertyId}`)).status,
    404,
  );
  assert.equal((await admin("/invoices")).status, 200);
  const accountingProperties = await admin("/properties");
  assert.deepEqual(
    accountingProperties.data.properties.map((property: { id: number }) => property.id),
    [propertyId],
  );
  const accountingReport = await admin(
    `/reports/summary?from=2030-01-01&to=2030-01-01&propertyId=${propertyId}`,
  );
  assert.equal(accountingReport.status, 200);
  assert.deepEqual(
    accountingReport.data.report.properties.map((property: { id: number }) => property.id),
    [propertyId],
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
    propertyIds: [propertyId],
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
      propertyIds: [propertyId],
    })).status,
    409,
  );

  assert.equal(hasPermission("administrator", "GET", "/api/unknown"), false);
  assert.equal(hasPermission("housekeeping", "PATCH", "/api/guests/1"), false);
  assert.equal(hasPermission("front_desk", "GET", "/api/housekeeping"), true);
  assert.equal(hasPermission("property_manager", "PATCH", "/api/housekeeping/units/1/status"), true);
  assert.equal(hasPermission("accounting", "GET", "/api/invoices"), true);
  assert.equal(hasPermission("front_desk", "POST", "/api/invoices"), false);

  const me = await admin("/auth/me");
  assert.equal(me.status, 200);
  const logout = await admin("/auth/logout", "POST");
  assert.equal(logout.status, 204);
  const logoutCookies = logout.response.headers.getSetCookie();
  assert.ok(logoutCookies.some((cookie) =>
    cookie.startsWith("pms_csrf=") &&
    /(?:^|;\s*)Path=\/(?:;|$)/.test(cookie) &&
    /(?:^|;\s*)Max-Age=0(?:;|$)/.test(cookie)
  ));
  assert.ok(logoutCookies.some((cookie) =>
    cookie.startsWith("pms_csrf=") &&
    /(?:^|;\s*)Path=\/api(?:;|$)/.test(cookie) &&
    /(?:^|;\s*)Max-Age=0(?:;|$)/.test(cookie)
  ));
  assert.equal((await admin("/properties")).status, 401);
  assert.equal(
    (await admin.login("test-admin", "synthetic-test-password-123")).status,
    200,
  );
  database.$client.prepare("UPDATE auth_sessions SET expires_at = ? WHERE staff_id = ?")
    .run(new Date(0).toISOString(), adminId);
  assert.equal((await admin("/auth/me")).status, 401);
  const expiredSessionGuestCount = database.$client
    .prepare("SELECT COUNT(*) AS count FROM guests").get()?.count;
  assert.equal(
    (await admin("/guests", "POST", {
      firstName: "Rejected",
      lastName: "Expired Session",
      email: "expired-session@example.test",
    })).status,
    401,
  );
  assert.equal(
    database.$client.prepare("SELECT COUNT(*) AS count FROM guests").get()?.count,
    expiredSessionGuestCount,
  );

  const incorrectRecovery = await anonymous("/auth/recovery", "POST", {
    username: "test-admin",
    recoveryPin: "000000",
    password: "admin123",
  });
  assert.equal(incorrectRecovery.status, 401);
  const recovered = await anonymous("/auth/recovery", "POST", {
    username: "test-admin",
    recoveryPin: "842691",
    password: "admin123",
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.data.user.role, "administrator");
  assert.equal((await anonymous("/auth/me")).status, 200);
  assert.equal((await anonymous.login("test-admin", "admin123")).status, 200);

  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal(
      (await anonymous("/auth/recovery", "POST", {
        username: "test-admin",
        recoveryPin: "000000",
        password: "admin123",
      })).status,
      401,
    );
  }
  assert.equal(
    (await anonymous("/auth/recovery", "POST", {
      username: "test-admin",
      recoveryPin: "842691",
      password: "admin123",
    })).status,
    429,
  );

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
