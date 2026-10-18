import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";

const testDirectory = mkdtempSync(resolve(tmpdir(), "local-pms-api-test-"));
const database = createDatabase(resolve(testDirectory, "api-test.sqlite"));
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

  const request = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data: unknown = await response.json();
    return { status: response.status, data: data as Record<string, any> };
  };

  const health = await request("/health");
  assert.equal(health.status, 200);
  assert.equal(health.data.status, "ok");

  const invalidProperty = await request("/properties", "POST", { name: " " });
  assert.equal(invalidProperty.status, 400);
  const invalidType = await request("/properties", "POST", {
    name: "Invalid Type",
    propertyType: "spaceship",
  });
  assert.equal(invalidType.status, 400);

  const createdProperty = await request("/properties", "POST", {
    name: "Synthetic Harbor Hotel",
    propertyType: "hotel",
    address: "10 Example Road",
    contactName: "Test Contact",
    contactEmail: "contact@example.test",
    contactPhone: "+1-555-0100",
    defaultCurrency: "USD",
    defaultCheckInTime: "15:00",
    defaultCheckOutTime: "11:00",
  });
  assert.equal(createdProperty.status, 201);
  const propertyId = createdProperty.data.property.id as number;
  assert.equal(createdProperty.data.property.propertyType, "hotel");

  const propertyList = await request("/properties");
  assert.equal(propertyList.status, 200);
  assert.equal(propertyList.data.properties.length, 1);
  const propertyDetails = await request(`/properties/${propertyId}`);
  assert.equal(propertyDetails.status, 200);
  assert.equal(propertyDetails.data.property.defaultCurrency, "USD");

  const invalidEmail = await request(`/properties/${propertyId}`, "PUT", {
    name: "Updated Harbor Hotel",
    propertyType: "hotel",
    contactEmail: "not-an-email",
  });
  assert.equal(invalidEmail.status, 400);
  const updatedProperty = await request(`/properties/${propertyId}`, "PUT", {
    name: "Updated Harbor Hotel",
    propertyType: "resort",
    address: "20 Example Road",
    contactName: "Updated Contact",
    contactEmail: "updated@example.test",
    contactPhone: "+1-555-0101",
    defaultCurrency: "CAD",
    defaultCheckInTime: "16:00",
    defaultCheckOutTime: "10:00",
  });
  assert.equal(updatedProperty.status, 200);
  assert.equal(updatedProperty.data.property.propertyType, "resort");
  assert.equal(updatedProperty.data.property.address, "20 Example Road");

  const badPropertyId = await request("/properties/not-an-id");
  assert.equal(badPropertyId.status, 400);
  const missingProperty = await request("/properties/999999");
  assert.equal(missingProperty.status, 404);

  const missingParentUnit = await request("/properties/999999/units", "POST", {
    name: "101",
    capacity: 2,
    baseNightlyRate: 120,
  });
  assert.equal(missingParentUnit.status, 404);
  const missingUnit = await request(`/properties/${propertyId}/units/999999`);
  assert.equal(missingUnit.status, 404);

  const invalidCapacity = await request(`/properties/${propertyId}/units`, "POST", {
    name: "101",
    capacity: 0,
    baseNightlyRate: 120,
  });
  assert.equal(invalidCapacity.status, 400);
  const invalidRate = await request(`/properties/${propertyId}/units`, "POST", {
    name: "101",
    capacity: 2,
    baseNightlyRate: -0.01,
  });
  assert.equal(invalidRate.status, 400);
  const tooPreciseRate = await request(`/properties/${propertyId}/units`, "POST", {
    name: "101",
    capacity: 2,
    baseNightlyRate: 9.999,
  });
  assert.equal(tooPreciseRate.status, 400);

  const createdUnit = await request(`/properties/${propertyId}/units`, "POST", {
    name: " 101 ",
    unitType: "suite",
    description: "Synthetic test suite",
    capacity: 3,
    baseNightlyRate: 125.5,
  });
  assert.equal(createdUnit.status, 201);
  const unitId = createdUnit.data.unit.id as number;
  assert.equal(createdUnit.data.unit.propertyId, propertyId);
  assert.equal(createdUnit.data.unit.baseNightlyRateCents, 12550);

  const unitsList = await request(`/properties/${propertyId}/units`);
  assert.equal(unitsList.status, 200);
  assert.equal(unitsList.data.units.length, 1);
  const unitDetails = await request(`/properties/${propertyId}/units/${unitId}`);
  assert.equal(unitDetails.status, 200);
  assert.equal(unitDetails.data.unit.name, "101");

  const duplicateUnit = await request(`/properties/${propertyId}/units`, "POST", {
    name: " 101 ",
    capacity: 2,
    baseNightlyRate: 100,
  });
  assert.equal(duplicateUnit.status, 409);

  const unitOnWrongProperty = await request(`/properties/${propertyId + 1}/units/${unitId}`);
  assert.equal(unitOnWrongProperty.status, 404);
  const unitMissingFromAnotherParent = await request(
    `/properties/${propertyId + 1}/units`,
    "POST",
    { name: "202", capacity: 2, baseNightlyRate: 100 },
  );
  assert.equal(unitMissingFromAnotherParent.status, 404);

  const updatedUnit = await request(`/properties/${propertyId}/units/${unitId}`, "PUT", {
    name: "101-A",
    unitType: "apartment",
    description: "Updated synthetic unit",
    capacity: 4,
    baseNightlyRate: 199.99,
  });
  assert.equal(updatedUnit.status, 200);
  assert.equal(updatedUnit.data.unit.name, "101-A");
  assert.equal(updatedUnit.data.unit.baseNightlyRateCents, 19999);

  const archivedUnit = await request(`/properties/${propertyId}/units/${unitId}`, "DELETE");
  assert.equal(archivedUnit.status, 200);
  assert.ok(archivedUnit.data.unit.archivedAt);
  assert.equal(archivedUnit.data.unit.status, "inactive");
  assert.equal((await request(`/properties/${propertyId}/units`)).data.units.length, 0);
  assert.equal(
    (await request(`/properties/${propertyId}/units?includeArchived=true`)).data.units.length,
    1,
  );

  const reusedArchivedName = await request(`/properties/${propertyId}/units`, "POST", {
    name: "101-A",
    capacity: 2,
    baseNightlyRate: 150,
  });
  assert.equal(reusedArchivedName.status, 201);
  const blockedRestore = await request(
    `/properties/${propertyId}/units/${unitId}/status`,
    "PATCH",
    { status: "active" },
  );
  assert.equal(blockedRestore.status, 409);
  const reusedUnitId = reusedArchivedName.data.unit.id as number;
  assert.equal(
    (await request(`/properties/${propertyId}/units/${reusedUnitId}`, "DELETE")).status,
    200,
  );

  const restoredUnit = await request(
    `/properties/${propertyId}/units/${unitId}/status`,
    "PATCH",
    { status: "maintenance" },
  );
  assert.equal(restoredUnit.status, 200);
  assert.equal(restoredUnit.data.unit.archivedAt, null);
  assert.equal(restoredUnit.data.unit.status, "maintenance");

  const archivedProperty = await request(`/properties/${propertyId}`, "DELETE");
  assert.equal(archivedProperty.status, 200);
  assert.equal(archivedProperty.data.property.status, "archived");
  assert.equal((await request("/properties")).data.properties.length, 0);
  assert.equal(
    (await request("/properties?includeArchived=true")).data.properties.length,
    1,
  );
  const rejectedArchivedUpdate = await request(`/properties/${propertyId}`, "PUT", {
    name: "Should Not Update",
    propertyType: "hotel",
  });
  assert.equal(rejectedArchivedUpdate.status, 409);
  const rejectedUnitCreate = await request(`/properties/${propertyId}/units`, "POST", {
    name: "202",
    capacity: 2,
    baseNightlyRate: 100,
  });
  assert.equal(rejectedUnitCreate.status, 409);

  const restoredProperty = await request(`/properties/${propertyId}/status`, "PATCH", {
    status: "active",
  });
  assert.equal(restoredProperty.status, 200);
  assert.equal(restoredProperty.data.property.status, "active");

  const missingContact = await request("/guests", "POST", {
    firstName: "No",
    lastName: "Contact",
  });
  assert.equal(missingContact.status, 400);
  const invalidGuestEmail = await request("/guests", "POST", {
    firstName: "Invalid",
    lastName: "Email",
    email: "not-an-email",
  });
  assert.equal(invalidGuestEmail.status, 400);
  const shortGuestPhone = await request("/guests", "POST", {
    firstName: "Short",
    lastName: "Phone",
    phone: "123",
  });
  assert.equal(shortGuestPhone.status, 400);
  assert.equal(
    (await request("/guests", "POST", {
      firstName: "A".repeat(101),
      lastName: "Long",
      email: "long@example.test",
    })).status,
    400,
  );
  const invalidGuestStatus = await request("/guests?status=unknown");
  assert.equal(invalidGuestStatus.status, 400);
  const malformedSearch = await request("/guests?q=one&q=two");
  assert.equal(malformedSearch.status, 400);
  const invalidGuestBody = await request("/guests", "POST", []);
  assert.equal(invalidGuestBody.status, 400);

  const firstGuest = await request("/guests", "POST", {
    firstName: "  Avery ",
    lastName: " Chen  ",
    email: "family@example.test",
    phone: "+1 (555) 010-0200",
    address: "  12 Example Lane ",
    country: "  Exampleland ",
    notes: "Synthetic guest note",
  });
  assert.equal(firstGuest.status, 201);
  const guestId = firstGuest.data.guest.id as number;
  assert.equal(firstGuest.data.guest.firstName, "Avery");
  assert.equal(firstGuest.data.guest.lastName, "Chen");
  assert.equal(firstGuest.data.guest.address, "12 Example Lane");
  assert.equal(firstGuest.data.guest.country, "Exampleland");
  assert.equal(firstGuest.data.guest.status, "active");

  const sharedEmailGuest = await request("/guests", "POST", {
    firstName: "Jordan",
    lastName: "Chen",
    email: "family@example.test",
  });
  assert.equal(sharedEmailGuest.status, 201);
  const sharedPhoneGuest = await request("/guests", "POST", {
    firstName: "Morgan",
    lastName: "Ray",
    phone: "+1 (555) 010-0200",
  });
  assert.equal(sharedPhoneGuest.status, 201);
  assert.equal(sharedPhoneGuest.data.guest.email, null);

  assert.equal((await request("/guests")).data.guests.length, 3);
  assert.equal("notes" in (await request("/guests")).data.guests[0], false);
  assert.equal((await request("/guests?status=all")).data.guests.length, 3);
  assert.equal((await request("/guests?status=active&q=avery")).data.guests.length, 1);
  assert.equal((await request("/guests?status=all&q=FAMILY%40EXAMPLE.TEST")).data.guests.length, 2);
  assert.equal((await request("/guests?status=all&q=010-0200")).data.guests.length, 2);
  assert.equal((await request("/guests/not-an-id")).status, 400);
  assert.equal((await request("/guests/999999")).status, 404);
  assert.equal((await request("/guests/999999", "PATCH", { firstName: "Missing" })).status, 404);
  assert.equal((await request("/guests/999999/archive", "POST")).status, 404);
  assert.equal((await request("/guests/999999/restore", "POST")).status, 404);

  const guestDetails = await request(`/guests/${guestId}`);
  assert.equal(guestDetails.status, 200);
  assert.equal(guestDetails.data.guest.email, "family@example.test");
  const updatedGuest = await request(`/guests/${guestId}`, "PATCH", {
    firstName: " Avery Rae ",
    address: "Updated Example Lane",
  });
  assert.equal(updatedGuest.status, 200);
  assert.equal(updatedGuest.data.guest.firstName, "Avery Rae");
  assert.equal(updatedGuest.data.guest.address, "Updated Example Lane");
  assert.equal(
    (await request(`/guests/${guestId}`, "PATCH", { email: null, phone: null })).status,
    400,
  );
  assert.equal((await request(`/guests/${guestId}`, "PATCH", { status: "archived" })).status, 400);

  database.$client
    .prepare(`
      INSERT INTO reservations (property_id, guest_id, check_in, check_out)
      VALUES (?, ?, ?, ?)
    `)
    .run(propertyId, guestId, "2030-03-01", "2030-03-02");
  const archivedGuest = await request(`/guests/${guestId}/archive`, "POST");
  assert.equal(archivedGuest.status, 200);
  assert.equal(archivedGuest.data.guest.status, "archived");
  assert.equal((await request(`/guests/${guestId}`)).data.guest.status, "archived");
  assert.equal((await request("/guests")).data.guests.length, 2);
  assert.equal((await request("/guests?status=archived")).data.guests.length, 1);
  assert.equal(
    database.$client.prepare("SELECT COUNT(*) AS count FROM reservations WHERE guest_id = ?")
      .get(guestId)?.count,
    1,
  );
  assert.equal((await request(`/guests/${guestId}`, "PATCH", { firstName: "Blocked" })).status, 409);
  const restoredGuest = await request(`/guests/${guestId}/restore`, "POST");
  assert.equal(restoredGuest.status, 200);
  assert.equal(restoredGuest.data.guest.status, "active");
  assert.equal((await request("/guests")).data.guests.length, 3);

  database.$client
    .prepare("INSERT INTO guests (first_name, last_name) VALUES (?, ?)")
    .run("Synthetic", "History Guest");
  database.$client
    .prepare(`
      INSERT INTO reservations (property_id, guest_id, check_in, check_out)
      VALUES (?, ?, ?, ?)
    `)
    .run(propertyId, 1, "2030-02-01", "2030-02-03");
  const propertyArchivedWithHistory = await request(`/properties/${propertyId}`, "DELETE");
  assert.equal(propertyArchivedWithHistory.status, 200);
  assert.equal(
    database.$client.prepare("SELECT COUNT(*) AS count FROM reservations WHERE property_id = ?")
      .get(propertyId)?.count,
    2,
  );
  assert.equal(
    (await request(`/properties/${propertyId}/units?includeArchived=true`)).data.units.length,
    2,
  );
  assert.throws(() => {
    database.$client.prepare("DELETE FROM properties WHERE id = ?").run(propertyId);
  });

  let foreignKeyRejected = false;
  try {
    database.$client
      .prepare(`
        INSERT INTO units (property_id, name, capacity, base_nightly_rate_cents)
        VALUES (?, ?, ?, ?)
      `)
      .run(999999, "Invalid Parent", 1, 100);
  } catch (error) {
    foreignKeyRejected = error instanceof Error;
  }
  assert.equal(foreignKeyRejected, true);

  console.log("Property, unit, and guest API integration tests passed.");
} finally {
  if (server?.listening) {
    await new Promise<void>((resolveClose, reject) => {
      server?.close((error) => error ? reject(error) : resolveClose());
    });
  }
  database.$client.close();
  rmSync(testDirectory, { recursive: true, force: true });
}
