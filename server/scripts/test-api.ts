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

  const activatedUnit = await request(
    `/properties/${propertyId}/units/${unitId}/status`,
    "PATCH",
    { status: "active" },
  );
  assert.equal(activatedUnit.status, 200);
  const reservationInput = {
    guestId,
    unitId,
    checkIn: "2030-03-01",
    checkOut: "2030-03-03",
    numberOfGuests: 2,
    nightlyRate: 150,
    notes: "Synthetic reservation note",
  };
  const createdReservation = await request("/reservations", "POST", reservationInput);
  assert.equal(createdReservation.status, 201);
  const reservationId = createdReservation.data.reservation.id as number;
  assert.equal(createdReservation.data.reservation.status, "pending");
  assert.equal(createdReservation.data.reservation.totalAmountCents, 30000);
  assert.equal(createdReservation.data.reservation.propertyId, propertyId);
  assert.equal(createdReservation.data.reservation.unitId, unitId);
  assert.match(createdReservation.data.reservation.reservationReference, /^R-[0-9A-F-]{36}$/);

  assert.equal((await request("/reservations/not-an-id")).status, 400);
  assert.equal((await request("/reservations/999999")).status, 404);
  assert.equal((await request("/reservations", "POST", {
    ...reservationInput,
    checkIn: "2030-02-30",
  })).status, 400);
  assert.equal((await request("/reservations", "POST", {
    ...reservationInput,
    checkIn: "2030-03-04",
    checkOut: "2030-03-03",
  })).status, 400);
  assert.equal((await request("/reservations", "POST", {
    ...reservationInput,
    guestId: 999999,
  })).status, 404);
  assert.equal((await request("/reservations", "POST", {
    ...reservationInput,
    unitId: 999999,
  })).status, 404);
  assert.equal((await request("/reservations", "POST", {
    ...reservationInput,
    numberOfGuests: 5,
  })).status, 400);
  assert.equal((await request("/reservations", "POST", {
    ...reservationInput,
    nightlyRate: -0.01,
  })).status, 400);
  assert.equal((await request("/reservations", "POST", {
    ...reservationInput,
    nightlyRate: 9.999,
  })).status, 400);
  assert.equal((await request("/reservations", "POST", {
    unitId,
    guestId,
  })).status, 400);

  const availabilityConflict = await request(
    "/reservations/availability?unitId=" + unitId +
      "&checkIn=2030-03-02&checkOut=2030-03-04&numberOfGuests=1",
  );
  assert.equal(availabilityConflict.status, 200);
  assert.equal(availabilityConflict.data.availability.available, false);
  assert.equal(
    (await request(
      "/reservations/availability?unitId=" + unitId +
        "&checkIn=2030-03-03&checkOut=2030-03-05&numberOfGuests=1",
    )).data.availability.available,
    true,
  );
  const overlap = await request("/reservations", "POST", {
    ...reservationInput,
    checkIn: "2030-03-02",
    checkOut: "2030-03-04",
  });
  assert.equal(overlap.status, 409);

  assert.throws(() => {
    database.$client.prepare(`
      INSERT INTO reservations (
        reservation_reference, property_id, guest_id, unit_id, check_in, check_out,
        number_of_guests, nightly_rate_cents, lifecycle_status, status,
        total_amount_cents, currency
      ) VALUES ('RAW-OVERLAP', ?, ?, ?, '2030-03-02', '2030-03-04', 1, 15000,
        'pending', 'booked', 30000, 'USD')
    `).run(propertyId, guestId, unitId);
  }, /reservation_conflict/);

  const backToBack = await request("/reservations", "POST", {
    ...reservationInput,
    guestId: sharedEmailGuest.data.guest.id,
    checkIn: "2030-03-03",
    checkOut: "2030-03-05",
    nightlyRate: 175,
  });
  assert.equal(backToBack.status, 201);
  const backToBackId = backToBack.data.reservation.id as number;

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
  assert.equal(
    (await request(`/reservations/${reservationId}/status`, "PATCH", { status: "confirmed" })).status,
    409,
  );
  assert.equal((await request("/reservations", "POST", reservationInput)).status, 409);
  assert.equal((await request(`/guests/${guestId}`, "PATCH", { firstName: "Blocked" })).status, 409);
  const restoredGuest = await request(`/guests/${guestId}/restore`, "POST");
  assert.equal(restoredGuest.status, 200);
  assert.equal(restoredGuest.data.guest.status, "active");
  assert.equal((await request("/guests")).data.guests.length, 3);

  const updatedReservation = await request(`/reservations/${reservationId}`, "PUT", {
    ...reservationInput,
    nightlyRate: 175,
    notes: "Updated synthetic note",
  });
  assert.equal(updatedReservation.status, 200);
  assert.equal(updatedReservation.data.reservation.nightlyRateCents, 17500);
  assert.equal(updatedReservation.data.reservation.totalAmountCents, 35000);
  assert.equal(updatedReservation.data.reservation.notes, "Updated synthetic note");
  assert.equal((await request(`/reservations/${backToBackId}`, "GET")).status, 200);
  assert.equal((await request("/reservations?status=pending")).data.reservations.length, 2);
  assert.equal((await request(`/reservations?q=${createdReservation.data.reservation.reservationReference}`)).data.total, 1);
  assert.equal((await request(`/reservations?guestId=${guestId}`)).data.total, 1);
  assert.equal((await request(`/reservations?propertyId=${propertyId}&unitId=${unitId}`)).data.total, 2);
  assert.equal((await request("/reservations?status=invalid")).status, 400);

  const overlappingEdit = await request(`/reservations/${backToBackId}`, "PUT", {
    ...reservationInput,
    guestId: sharedEmailGuest.data.guest.id,
    checkIn: "2030-03-02",
    checkOut: "2030-03-04",
  });
  assert.equal(overlappingEdit.status, 409);
  const confirmedReservation = await request(
    `/reservations/${reservationId}/status`,
    "PATCH",
    { status: "confirmed" },
  );
  assert.equal(confirmedReservation.status, 200);
  assert.equal(confirmedReservation.data.reservation.status, "confirmed");
  assert.equal((await request(`/reservations/${reservationId}/status`, "PATCH", { status: "pending" })).status, 400);
  assert.equal((await request(`/reservations/${reservationId}/status`, "PATCH", { status: "completed", extra: true })).status, 400);

  const cancelledBackToBack = await request(`/reservations/${backToBackId}`, "DELETE");
  assert.equal(cancelledBackToBack.status, 200);
  assert.equal(cancelledBackToBack.data.reservation.status, "cancelled");
  const reusedCancelledDates = await request("/reservations", "POST", {
    ...reservationInput,
    guestId: sharedEmailGuest.data.guest.id,
    checkIn: "2030-03-03",
    checkOut: "2030-03-05",
  });
  assert.equal(reusedCancelledDates.status, 201);
  const reusedCancelledId = reusedCancelledDates.data.reservation.id as number;
  assert.equal((await request(`/reservations/${reusedCancelledId}`, "DELETE")).status, 200);

  const completedReservation = await request(
    `/reservations/${reservationId}/status`,
    "PATCH",
    { status: "completed" },
  );
  assert.equal(completedReservation.status, 200);
  assert.equal(completedReservation.data.reservation.status, "completed");
  assert.equal((await request(`/reservations/${reservationId}`, "PUT", reservationInput)).status, 409);
  const rebookCompletedDates = await request("/reservations", "POST", reservationInput);
  assert.equal(rebookCompletedDates.status, 201);
  const rebookCompletedId = rebookCompletedDates.data.reservation.id as number;
  assert.equal((await request(`/reservations/${rebookCompletedId}`, "DELETE")).status, 200);

  const today = localDate(new Date());
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = localDate(tomorrowDate);
  const dayAfterTomorrowDate = new Date(tomorrowDate);
  dayAfterTomorrowDate.setDate(dayAfterTomorrowDate.getDate() + 1);
  const dayAfterTomorrow = localDate(dayAfterTomorrowDate);
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = localDate(yesterdayDate);
  const emptyFrontDesk = await request(`/front-desk?date=${today}`);
  assert.equal(emptyFrontDesk.data.frontDesk.summary.arrivalsToday, 0);
  assert.equal(emptyFrontDesk.data.frontDesk.summary.checkedIn, 0);
  assert.equal((await request(`/front-desk?date=${today}&date=${tomorrow}`)).status, 400);
  const frontDeskInput = {
    ...reservationInput,
    guestId: sharedEmailGuest.data.guest.id as number,
    checkIn: today,
    checkOut: tomorrow,
  };
  const arrival = await request("/reservations", "POST", frontDeskInput);
  assert.equal(arrival.status, 201);
  const arrivalId = arrival.data.reservation.id as number;
  assert.equal(arrival.data.reservation.stayStatus, "not_checked_in");
  assert.equal(
    (await request(`/reservations/${arrivalId}/check-in`, "POST")).status,
    409,
  );
  assert.equal(
    (await request(`/reservations/${arrivalId}/check-out`, "POST")).status,
    409,
  );
  assert.equal(
    (await request(`/reservations/${arrivalId}/status`, "PATCH", { status: "confirmed" })).status,
    200,
  );
  assert.equal((await request("/front-desk?date=not-a-date")).status, 400);
  assert.equal((await request("/front-desk?date=2030-02-30")).status, 400);
  const arrivalDashboard = await request(`/front-desk?date=${today}`);
  assert.equal(arrivalDashboard.status, 200);
  assert.equal(arrivalDashboard.data.frontDesk.summary.arrivalsToday, 1);
  assert.equal(arrivalDashboard.data.frontDesk.arrivals[0].id, arrivalId);

  const checkInAttempts = await Promise.all([
    request(`/reservations/${arrivalId}/check-in`, "POST"),
    request(`/reservations/${arrivalId}/check-in`, "POST"),
  ]);
  assert.deepEqual(checkInAttempts.map((result) => result.status).sort(), [200, 409]);
  const checkedIn = checkInAttempts.find((result) => result.status === 200);
  assert.ok(checkedIn);
  assert.equal(checkedIn.data.reservation.stayStatus, "checked_in");
  assert.ok(checkedIn.data.reservation.actualCheckInAt);
  const inHouseDashboard = await request(`/front-desk?date=${today}`);
  assert.equal(inHouseDashboard.data.frontDesk.summary.checkedIn, 1);
  assert.equal(inHouseDashboard.data.frontDesk.inHouse[0].id, arrivalId);
  const departureDashboard = await request(`/front-desk?date=${tomorrow}`);
  assert.equal(departureDashboard.data.frontDesk.summary.departuresToday, 1);
  assert.equal(departureDashboard.data.frontDesk.departures[0].id, arrivalId);
  assert.equal(
    (await request(`/properties/${propertyId}/units/${unitId}/status`, "PATCH", {
      status: "maintenance",
    })).status,
    409,
  );
  assert.equal((await request(`/reservations/${arrivalId}`, "DELETE")).status, 409);

  const nextStay = await request("/reservations", "POST", {
    ...frontDeskInput,
    checkIn: tomorrow,
    checkOut: dayAfterTomorrow,
  });
  assert.equal(nextStay.status, 201);
  const nextStayId = nextStay.data.reservation.id as number;
  assert.equal(
    (await request(`/reservations/${nextStayId}/status`, "PATCH", { status: "confirmed" })).status,
    200,
  );
  assert.equal(
    (await request(`/front-desk?date=${tomorrow}`)).data.frontDesk.summary.arrivalsToday,
    1,
  );
  const checkedOut = await request(`/reservations/${arrivalId}/check-out`, "POST");
  assert.equal(checkedOut.status, 200);
  assert.equal(checkedOut.data.reservation.stayStatus, "checked_out");
  assert.ok(checkedOut.data.reservation.actualCheckOutAt);
  assert.equal(
    (await request(`/reservations/${arrivalId}/check-out`, "POST")).status,
    409,
  );
  assert.equal(
    (await request(`/front-desk?date=${tomorrow}`)).data.frontDesk.summary.checkedIn,
    0,
  );
  assert.equal((await request(`/reservations/invalid/check-in`, "POST")).status, 400);
  assert.equal((await request("/reservations/999999/check-in", "POST")).status, 404);
  assert.equal((await request("/reservations/999999/check-out", "POST")).status, 404);
  assert.equal(
    database.$client
      .prepare("SELECT COUNT(*) AS count FROM reservations WHERE unit_id = ? AND stay_status = 'checked_in'")
      .get(unitId)?.count,
    0,
  );
  assert.throws(() => {
    database.$client
      .prepare("UPDATE reservations SET stay_status = 'checked_in' WHERE id = ?")
      .run(arrivalId);
  }, /reservation_stay_conflict/);

  const overdueUnit = await request(`/properties/${propertyId}/units`, "POST", {
    name: "Front Desk Overdue Test Unit",
    capacity: 2,
    baseNightlyRate: 120,
  });
  assert.equal(overdueUnit.status, 201);
  const overdueReservation = await request("/reservations", "POST", {
    ...frontDeskInput,
    unitId: overdueUnit.data.unit.id as number,
    checkIn: yesterday,
    checkOut: tomorrow,
  });
  assert.equal(overdueReservation.status, 201);
  const overdueReservationId = overdueReservation.data.reservation.id as number;
  assert.equal(
    (await request(`/reservations/${overdueReservationId}/status`, "PATCH", { status: "confirmed" })).status,
    200,
  );
  const overdueDashboard = await request(`/front-desk?date=${today}`);
  assert.equal(overdueDashboard.data.frontDesk.summary.overdueArrivals, 1);
  assert.equal(overdueDashboard.data.frontDesk.overdueArrivals[0].id, overdueReservationId);
  assert.equal(
    (await request(`/reservations/${overdueReservationId}/check-in`, "POST")).status,
    200,
  );
  assert.equal(
    (await request(`/reservations/${overdueReservationId}/check-out`, "POST")).status,
    200,
  );

  const raceInput = {
    ...reservationInput,
    checkIn: "2030-06-01",
    checkOut: "2030-06-03",
  };
  const raceResults = await Promise.all([
    request("/reservations", "POST", raceInput),
    request("/reservations", "POST", raceInput),
  ]);
  assert.deepEqual(raceResults.map((result) => result.status).sort(), [201, 409]);
  const winningRace = raceResults.find((result) => result.status === 201);
  assert.ok(winningRace);
  assert.equal((await request(`/reservations/${winningRace.data.reservation.id}`, "DELETE")).status, 200);

  const historyGuestResult = database.$client
    .prepare("INSERT INTO guests (first_name, last_name) VALUES (?, ?)")
    .run("Synthetic", "History Guest");
  const historyGuestId = Number(historyGuestResult.lastInsertRowid);
  const reservationsBeforePropertyArchive = Number(
    database.$client.prepare("SELECT COUNT(*) AS count FROM reservations WHERE property_id = ?")
      .get(propertyId)?.count,
  );
  const historyReservation = await request("/reservations", "POST", {
    guestId: historyGuestId,
    unitId,
    checkIn: "2030-02-01",
    checkOut: "2030-02-03",
    numberOfGuests: 1,
  });
  assert.equal(historyReservation.status, 201);
  const propertyArchivedWithHistory = await request(`/properties/${propertyId}`, "DELETE");
  assert.equal(propertyArchivedWithHistory.status, 200);
  assert.equal(
    database.$client.prepare("SELECT COUNT(*) AS count FROM reservations WHERE property_id = ?")
      .get(propertyId)?.count,
    reservationsBeforePropertyArchive + 1,
  );
  assert.equal(
    (await request(`/properties/${propertyId}/units?includeArchived=true`)).data.units.length,
    3,
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

  console.log("Property, unit, guest, reservation, and front-desk API integration tests passed.");
} finally {
  if (server?.listening) {
    await new Promise<void>((resolveClose, reject) => {
      server?.close((error) => error ? reject(error) : resolveClose());
    });
  }
  database.$client.close();
  rmSync(testDirectory, { recursive: true, force: true });
}

function localDate(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}
