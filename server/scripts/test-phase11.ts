import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";
import { createTestApiClient } from "./test-api-client.js";

const testDirectory = mkdtempSync(resolve(tmpdir(), "local-pms-phase11-test-"));
const database = createDatabase(resolve(testDirectory, "phase11-test.sqlite"));
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
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const admin = await createTestApiClient(baseUrl);

  const propertyOne = await admin("/properties", "POST", {
    name: "Synthetic Phase 11 Hotel One",
    propertyType: "hotel",
  });
  const propertyTwo = await admin("/properties", "POST", {
    name: "Synthetic Phase 11 Hotel Two",
    propertyType: "hotel",
  });
  assert.equal(propertyOne.status, 201);
  assert.equal(propertyTwo.status, 201);
  const propertyOneId = propertyOne.data.property.id as number;
  const propertyTwoId = propertyTwo.data.property.id as number;

  const unitOne = await admin(`/properties/${propertyOneId}/units`, "POST", {
    name: "101",
    capacity: 2,
    baseNightlyRate: 100,
  });
  const unitTwo = await admin(`/properties/${propertyOneId}/units`, "POST", {
    name: "102",
    capacity: 2,
    baseNightlyRate: 100,
  });
  const unitOther = await admin(`/properties/${propertyTwoId}/units`, "POST", {
    name: "201",
    capacity: 2,
    baseNightlyRate: 100,
  });
  assert.equal(unitOne.status, 201);
  assert.equal(unitTwo.status, 201);
  assert.equal(unitOther.status, 201);

  const frontDeskCreated = await admin("/staff", "POST", {
    displayName: "Synthetic Phase 11 Front Desk",
    username: "phase11-front-desk",
    role: "front_desk",
    password: "synthetic-phase11-frontdesk-password",
  });
  const housekeepingCreated = await admin("/staff", "POST", {
    displayName: "Synthetic Phase 11 Housekeeping",
    username: "phase11-housekeeping",
    role: "housekeeping",
    password: "synthetic-phase11-housekeeping-password",
  });
  const accountingCreated = await admin("/staff", "POST", {
    displayName: "Synthetic Phase 11 Accounting",
    username: "phase11-accounting",
    role: "accounting",
    password: "synthetic-phase11-accounting-password",
  });
  const managerCreated = await admin("/staff", "POST", {
    displayName: "Synthetic Phase 11 Manager",
    username: "phase11-manager",
    role: "property_manager",
    password: "synthetic-phase11-manager-password",
    propertyIds: [propertyOneId],
  });
  assert.equal(frontDeskCreated.status, 201);
  assert.equal(housekeepingCreated.status, 201);
  assert.equal(accountingCreated.status, 201);
  assert.equal(managerCreated.status, 201);
  const managerId = managerCreated.data.staff.id as number;
  const frontDeskId = frontDeskCreated.data.staff.id as number;
  assert.deepEqual(managerCreated.data.staff.propertyIds, [propertyOneId]);

  const guest = await admin("/guests", "POST", {
    firstName: "Synthetic",
    lastName: "Calendar Guest",
    email: "phase11-calendar@example.test",
  });
  assert.equal(guest.status, 201);
  const reservation = await admin("/reservations", "POST", {
    guestId: guest.data.guest.id,
    unitId: unitOne.data.unit.id,
    checkIn: "2032-01-10",
    checkOut: "2032-01-12",
    numberOfGuests: 1,
  });
  assert.equal(reservation.status, 201);

  const otherPropertyRequest = await admin("/maintenance", "POST", {
    propertyId: propertyTwoId,
    unitId: unitOther.data.unit.id,
    title: "Synthetic other-property issue",
    description: "Used to verify manager property isolation.",
    category: "plumbing",
  });
  assert.equal(otherPropertyRequest.status, 201);
  const otherRequestId = otherPropertyRequest.data.request.id as number;

  const manager = await createTestApiClient(baseUrl, false);
  assert.equal((await manager.login("phase11-manager", "synthetic-phase11-manager-password")).status, 200);
  assert.equal((await manager("/properties")).status, 403);
  assert.equal((await manager("/staff")).status, 403);
  assert.equal((await manager("/reports/summary?from=2032-01-10&to=2032-01-10")).status, 403);

  const calendarProperties = await manager("/room-availability/properties");
  assert.equal(calendarProperties.status, 200);
  assert.deepEqual(
    calendarProperties.data.properties.map((property: { id: number }) => property.id),
    [propertyOneId],
  );
  const availability = await manager(
    `/room-availability/${propertyOneId}?from=2032-01-10&to=2032-01-13&checkIn=2032-01-10&checkOut=2032-01-12`,
  );
  assert.equal(availability.status, 200);
  assert.equal(availability.data.availability.summary.totalRooms, 2);
  const calendarRoom = availability.data.availability.rooms.find(
    (room: { id: number }) => room.id === unitOne.data.unit.id,
  );
  assert.equal(calendarRoom.availableForStay, false);
  assert.deepEqual(
    calendarRoom.nights.slice(0, 2).map((night: { status: string }) => night.status),
    ["reserved", "reserved"],
  );
  const availableRoom = availability.data.availability.rooms.find(
    (room: { id: number }) => room.id === unitTwo.data.unit.id,
  );
  assert.equal(availableRoom.availableForStay, true);
  assert.equal(
    (await manager(`/room-availability/${propertyTwoId}?from=2032-01-10&to=2032-01-13`)).status,
    404,
  );

  const managerDashboard = await manager("/manager/dashboard?date=2032-01-10");
  assert.equal(managerDashboard.status, 200);
  assert.deepEqual(
    managerDashboard.data.dashboard.properties.map((property: { id: number }) => property.id),
    [propertyOneId],
  );
  assert.equal(managerDashboard.data.dashboard.operations.availableRooms, 1);

  const maintenanceOptions = await manager("/maintenance/options");
  assert.equal(maintenanceOptions.status, 200);
  assert.deepEqual(
    maintenanceOptions.data.properties.map((property: { id: number }) => property.id),
    [propertyOneId],
  );
  assert.equal((await manager(`/maintenance/${otherRequestId}`)).status, 404);
  const maintenanceCountBeforeRejectedCreate = database.$client
    .prepare("SELECT COUNT(*) AS count FROM maintenance_requests").get()?.count;
  assert.equal(
    (await manager("/maintenance", "POST", {
      propertyId: propertyTwoId,
      title: "Out-of-scope request",
      description: "Should not be created.",
      category: "plumbing",
    })).status,
    404,
  );
  assert.equal(
    database.$client.prepare("SELECT COUNT(*) AS count FROM maintenance_requests").get()?.count,
    maintenanceCountBeforeRejectedCreate,
  );
  const scopedRequest = await manager("/maintenance", "POST", {
    propertyId: propertyOneId,
    unitId: unitTwo.data.unit.id,
    title: "Synthetic assigned-property issue",
    description: "Property manager-created issue for the assigned hotel.",
    category: "electrical",
    assignedStaffId: frontDeskId,
  });
  assert.equal(scopedRequest.status, 201);
  const scopedRequestId = scopedRequest.data.request.id as number;
  assert.equal((await manager(`/maintenance/${scopedRequestId}`)).status, 200);
  assert.equal((await manager("/maintenance")).data.requests.length, 1);
  assert.equal(
    (await manager(`/maintenance/${otherRequestId}/status`, "PATCH", { status: "in_progress" })).status,
    404,
  );
  assert.equal(
    (await manager(`/maintenance/${scopedRequestId}`, "PUT", {
      propertyId: propertyTwoId,
      title: "Move out of scope",
      description: "This should be rejected.",
      category: "electrical",
    })).status,
    404,
  );
  const updatedMaintenance = await manager(`/maintenance/${scopedRequestId}`, "PUT", {
    propertyId: propertyOneId,
    unitId: unitTwo.data.unit.id,
    title: "Synthetic assigned-property issue updated",
    description: "Updated by the assigned property manager.",
    category: "electrical",
    priority: "high",
    targetCompletionDate: "2032-01-12",
    assignedStaffId: frontDeskId,
  });
  assert.equal(updatedMaintenance.status, 200);
  assert.equal(updatedMaintenance.data.request.title, "Synthetic assigned-property issue updated");
  const scopedMaintenanceDashboard = await manager("/maintenance/dashboard");
  assert.equal(scopedMaintenanceDashboard.status, 200);
  assert.equal(scopedMaintenanceDashboard.data.dashboard.current.open, 1);
  assert.equal(scopedMaintenanceDashboard.data.dashboard.byProperty.length, 1);
  assert.equal((await manager(`/maintenance/${scopedRequestId}/status`, "PATCH", {
    status: "in_progress",
  })).status, 200);

  const taskOptions = await manager("/team-tasks/options");
  assert.equal(taskOptions.status, 200);
  assert.deepEqual(
    taskOptions.data.options.properties.map((property: { id: number }) => property.id),
    [propertyOneId],
  );
  assert.equal(
    (await manager(`/team-tasks/options?propertyId=${propertyTwoId}`)).status,
    404,
  );
  assert.equal(
    (await manager("/team-tasks", "POST", {
      propertyId: propertyTwoId,
      title: "Out-of-scope task",
      description: "Should not be created.",
      department: "front_desk",
      assignedStaffId: frontDeskId,
    })).status,
    404,
  );
  const taskCountBeforeRejectedCreate = database.$client
    .prepare("SELECT COUNT(*) AS count FROM team_tasks").get()?.count;
  assert.equal(taskCountBeforeRejectedCreate, 0);
  const taskCreated = await manager("/team-tasks", "POST", {
    propertyId: propertyOneId,
    unitId: unitTwo.data.unit.id,
    reservationId: null,
    title: "Synthetic turn room 102",
    description: "Inspect and prepare room 102.",
    department: "front_desk",
    assignedStaffId: frontDeskId,
    priority: "high",
    dueDate: "2032-01-10",
    dueTime: "09:00",
  });
  assert.equal(taskCreated.status, 201);
  const taskId = taskCreated.data.task.id as number;
  const taskUpdated = await manager(`/team-tasks/${taskId}`, "PUT", {
    propertyId: propertyOneId,
    unitId: unitTwo.data.unit.id,
    reservationId: null,
    title: "Synthetic turn room 102 updated",
    description: "Inspect, prepare, and verify room 102.",
    department: "front_desk",
    assignedStaffId: frontDeskId,
    priority: "urgent",
    dueDate: "2032-01-10",
    dueTime: "10:00",
  });
  assert.equal(taskUpdated.status, 200);
  assert.equal(taskUpdated.data.task.title, "Synthetic turn room 102 updated");
  assert.equal(
    (await manager("/team-tasks?status=pending")).data.tasks.length,
    1,
  );
  assert.equal((await manager(`/team-tasks/${taskId}/status`, "PATCH", {
    status: "completed",
  })).status, 403);
  assert.equal((await manager(`/team-tasks/${taskId}`, "PUT", {
    propertyId: propertyTwoId,
    title: "Move task out of scope",
    description: "Should not be permitted.",
    department: "front_desk",
    assignedStaffId: frontDeskId,
    priority: "normal",
    unitId: null,
    reservationId: null,
    dueDate: null,
    dueTime: null,
  })).status, 404);

  const worker = await createTestApiClient(baseUrl, false);
  assert.equal((await worker.login("phase11-front-desk", "synthetic-phase11-frontdesk-password")).status, 200);
  assert.equal((await worker("/team-tasks/options")).status, 403);
  const tasksBeforeRejectedWrite = database.$client
    .prepare("SELECT COUNT(*) AS count FROM team_tasks").get()?.count;
  assert.equal((await worker("/team-tasks", "POST", {})).status, 403);
  assert.equal(
    database.$client.prepare("SELECT COUNT(*) AS count FROM team_tasks").get()?.count,
    tasksBeforeRejectedWrite,
  );
  assert.equal((await worker("/team-tasks")).data.tasks.length, 1);
  assert.equal((await worker(`/team-tasks/${taskId}`)).status, 200);
  assert.equal((await worker(`/team-tasks/${taskId}/status`, "PATCH", {
    status: "in_progress",
  })).status, 200);
  assert.equal((await worker(`/team-tasks/${taskId}/status`, "PATCH", {
    status: "submitted",
    note: "Room inspection completed.",
  })).status, 200);
  assert.equal((await worker(`/team-tasks/${taskId}/status`, "PATCH", {
    status: "completed",
  })).status, 403);
  assert.equal((await manager(`/team-tasks/${taskId}`)).data.task.status, "submitted");
  assert.equal((await manager(`/team-tasks/${taskId}/status`, "PATCH", {
    status: "completed",
    note: "Reviewed synthetic task.",
  })).status, 200);
  const completedTask = await manager(`/team-tasks/${taskId}`);
  assert.equal(completedTask.data.task.status, "completed");
  assert.deepEqual(
    completedTask.data.task.activity.map((event: { eventType: string }) => event.eventType),
    ["created", "details_changed", "status_changed", "submitted", "approved"],
  );

  const housekeeper = await createTestApiClient(baseUrl, false);
  assert.equal(
    (await housekeeper.login("phase11-housekeeping", "synthetic-phase11-housekeeping-password")).status,
    200,
  );
  const frontDesk = await createTestApiClient(baseUrl, false);
  assert.equal(
    (await frontDesk.login("phase11-front-desk", "synthetic-phase11-frontdesk-password")).status,
    200,
  );
  assert.equal((await frontDesk(`/room-availability/${propertyOneId}?from=2032-01-10&to=2032-01-13`)).status, 200);
  assert.equal((await housekeeper("/room-availability/properties")).status, 403);
  assert.equal((await housekeeper("/manager/dashboard?date=2032-01-10")).status, 403);
  assert.equal((await housekeeper("/maintenance/dashboard")).status, 200);
  const accounting = await createTestApiClient(baseUrl, false);
  assert.equal(
    (await accounting.login("phase11-accounting", "synthetic-phase11-accounting-password")).status,
    200,
  );
  assert.equal((await accounting("/room-availability/properties")).status, 403);
  assert.equal((await accounting("/manager/dashboard?date=2032-01-10")).status, 403);

  console.log("Phase 11 manager, task workflow, room calendar, maintenance scope, and authorization tests passed.");
} finally {
  if (server) {
    await new Promise<void>((resolveClose, reject) => {
      server?.close((error) => error ? reject(error) : resolveClose());
    });
  }
  database.$client.close();
  rmSync(testDirectory, { recursive: true, force: true });
}
