import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";
import { createTestApiClient } from "./test-api-client.js";

const testDirectory = mkdtempSync(resolve(tmpdir(), "local-pms-maintenance-test-"));
const database = createDatabase(resolve(testDirectory, "maintenance-test.sqlite"));
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
  const admin = await createTestApiClient(baseUrl);

  const propertyResult = await admin("/properties", "POST", {
    name: "Synthetic Maintenance Property",
    propertyType: "hotel",
  });
  assert.equal(propertyResult.status, 201);
  const propertyId = propertyResult.data.property.id as number;
  const secondPropertyResult = await admin("/properties", "POST", {
    name: "Synthetic Other Property",
    propertyType: "apartment",
  });
  assert.equal(secondPropertyResult.status, 201);
  const secondPropertyId = secondPropertyResult.data.property.id as number;
  const unitResult = await admin(`/properties/${propertyId}/units`, "POST", {
    name: "M-101",
    capacity: 2,
    baseNightlyRate: 100,
  });
  assert.equal(unitResult.status, 201);
  const unitId = unitResult.data.unit.id as number;
  const otherPropertyUnit = await admin(`/properties/${secondPropertyId}/units`, "POST", {
    name: "M-201",
    capacity: 2,
    baseNightlyRate: 100,
  });
  assert.equal(otherPropertyUnit.status, 201);

  const frontDeskCreated = await admin("/staff", "POST", {
    displayName: "Synthetic Maintenance Front Desk",
    username: "maintenance-front-desk",
    role: "front_desk",
    password: "synthetic-maintenance-frontdesk",
  });
  assert.equal(frontDeskCreated.status, 201);
  const housekeepingCreated = await admin("/staff", "POST", {
    displayName: "Synthetic Maintenance Housekeeping",
    username: "maintenance-housekeeping",
    role: "housekeeping",
    password: "synthetic-maintenance-housekeeping",
  });
  assert.equal(housekeepingCreated.status, 201);
  const accountingCreated = await admin("/staff", "POST", {
    displayName: "Synthetic Maintenance Accounting",
    username: "maintenance-accounting",
    role: "accounting",
    password: "synthetic-maintenance-accounting",
  });
  assert.equal(accountingCreated.status, 201);
  const inactiveStaff = await admin("/staff", "POST", {
    displayName: "Synthetic Inactive Assignee",
    username: "inactive-assignee",
    role: "administrator",
    password: "synthetic-inactive-assignee-password",
  });
  assert.equal(inactiveStaff.status, 201);
  const inactiveStaffId = inactiveStaff.data.staff.id as number;
  assert.equal(
    (await admin(`/staff/${inactiveStaffId}/status`, "PATCH", { isActive: false })).status,
    200,
  );

  const initialDashboard = await admin("/maintenance/dashboard");
  assert.equal(initialDashboard.status, 200);
  assert.equal(initialDashboard.data.dashboard.current.open, 0);
  assert.equal(initialDashboard.data.dashboard.current.overdue, 0);

  const invalidTitle = await admin("/maintenance", "POST", {
    propertyId,
    title: " ",
    description: "Synthetic description",
    category: "plumbing",
  });
  assert.equal(invalidTitle.status, 400);
  const invalidCategory = await admin("/maintenance", "POST", {
    propertyId,
    title: "Invalid category",
    description: "Synthetic description",
    category: "malware",
  });
  assert.equal(invalidCategory.status, 400);
  const invalidTargetDate = await admin("/maintenance", "POST", {
    propertyId,
    title: "Invalid date",
    description: "Synthetic description",
    category: "plumbing",
    targetCompletionDate: "2035-02-30",
  });
  assert.equal(invalidTargetDate.status, 400);
  const malformedReportedAt = await admin("/maintenance", "POST", {
    propertyId,
    title: "Invalid reported date",
    description: "Synthetic description",
    category: "plumbing",
    reportedAt: "tomorrow",
  });
  assert.equal(malformedReportedAt.status, 400);
  const wrongUnitProperty = await admin("/maintenance", "POST", {
    propertyId,
    unitId: otherPropertyUnit.data.unit.id,
    title: "Cross-property unit",
    description: "Synthetic description",
    category: "plumbing",
  });
  assert.equal(wrongUnitProperty.status, 400);
  const missingProperty = await admin("/maintenance", "POST", {
    propertyId: 999999,
    title: "Missing property",
    description: "Synthetic description",
    category: "plumbing",
  });
  assert.equal(missingProperty.status, 404);
  const badAssignment = await admin("/maintenance", "POST", {
    propertyId,
    title: "Inactive assignment",
    description: "Synthetic description",
    category: "plumbing",
    assignedStaffId: inactiveStaffId,
  });
  assert.equal(badAssignment.status, 400);
  const extraField = await admin("/maintenance", "POST", {
    propertyId,
    title: "Unsupported field",
    description: "Synthetic description",
    category: "plumbing",
    guestId: 1,
  });
  assert.equal(extraField.status, 400);

  const created = await admin("/maintenance", "POST", {
    propertyId,
    unitId,
    title: "Repair leaking faucet",
    description: "Synthetic description: inspect the basin faucet and replace the worn washer.",
    category: "plumbing",
    priority: "urgent",
    targetCompletionDate: "2020-01-01",
    assignedStaffId: frontDeskCreated.data.staff.id,
  });
  assert.equal(created.status, 201);
  const requestId = created.data.request.id as number;
  const requestCode = created.data.request.requestCode as string;
  assert.match(requestCode, /^MNT-\d{8}-[A-F0-9]{8}$/);
  assert.equal(created.data.request.status, "open");
  assert.equal(created.data.request.assignedStaffName, "Synthetic Maintenance Front Desk");
  assert.equal(created.data.request.unitId, unitId);
  assert.equal(created.data.request.history.length, 1);
  assert.equal(created.data.request.history[0].fromStatus, null);

  const propertyLevel = await admin("/maintenance", "POST", {
    propertyId,
    title: "Inspect exterior lighting",
    description: "Synthetic property-level description.",
    category: "electrical",
    priority: "low",
  });
  assert.equal(propertyLevel.status, 201);
  assert.equal(propertyLevel.data.request.unitId, null);

  const listing = await admin("/maintenance?status=open&priority=urgent&propertyId=" + propertyId);
  assert.equal(listing.status, 200);
  assert.equal(listing.data.total, 1);
  assert.equal(listing.data.requests[0].requestCode, requestCode);
  const paged = await admin("/maintenance?limit=1&offset=1&sort=priority&order=desc");
  assert.equal(paged.status, 200);
  assert.equal(paged.data.requests.length, 1);
  assert.equal(paged.data.offset, 1);
  const categoryFiltered = await admin("/maintenance?category=electrical");
  assert.equal(categoryFiltered.data.total, 1);
  const overdueFiltered = await admin("/maintenance?overdue=true");
  assert.equal(overdueFiltered.data.total, 1);
  const injectionSearch = await admin(
    "/maintenance?q=" + encodeURIComponent("' OR 1=1 --"),
  );
  assert.equal(injectionSearch.status, 200);
  assert.equal(injectionSearch.data.total, 0);
  assert.equal(
    (await admin("/maintenance?sort=created_at;DROP%20TABLE%20maintenance_requests")).status,
    400,
  );
  assert.equal((await admin("/maintenance?limit=101")).status, 400);
  assert.equal((await admin("/maintenance/not-a-number")).status, 400);
  assert.equal((await admin("/maintenance/999999")).status, 404);

  const updated = await admin(`/maintenance/${requestId}`, "PUT", {
    propertyId,
    unitId,
    title: "Repair basin faucet",
    description: "Updated synthetic description.",
    category: "plumbing",
    priority: "high",
    targetCompletionDate: "2035-07-10",
    assignedStaffId: frontDeskCreated.data.staff.id,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.request.title, "Repair basin faucet");
  assert.equal(updated.data.request.priority, "high");
  assert.equal(
    (await admin(`/maintenance/${requestId}`, "PUT", {
      propertyId,
      unitId,
      title: "Invalid reported field",
      description: "Synthetic",
      category: "plumbing",
      reportedAt: "2035-01-01T00:00:00Z",
    })).status,
    400,
  );

  const invalidDirectComplete = await admin(`/maintenance/${requestId}/status`, "PATCH", {
    status: "completed",
  });
  assert.equal(invalidDirectComplete.status, 409);
  const started = await admin(`/maintenance/${requestId}/status`, "PATCH", {
    status: "in_progress",
    resolutionNotes: "Synthetic inspection began.",
  });
  assert.equal(started.status, 200);
  assert.equal(started.data.request.status, "in_progress");
  const awaitingParts = await admin(`/maintenance/${requestId}/status`, "PATCH", {
    status: "awaiting_parts",
  });
  assert.equal(awaitingParts.status, 200);
  const resumed = await admin(`/maintenance/${requestId}/status`, "PATCH", {
    status: "in_progress",
  });
  assert.equal(resumed.status, 200);
  const completed = await admin(`/maintenance/${requestId}/status`, "PATCH", {
    status: "completed",
    resolutionNotes: "Synthetic washer replaced and checked.",
  });
  assert.equal(completed.status, 200);
  assert.ok(completed.data.request.completedAt);
  assert.equal(completed.data.request.resolutionNotes, "Synthetic washer replaced and checked.");
  assert.equal(completed.data.request.history.length, 5);
  assert.equal(
    (await admin(`/maintenance/${requestId}/status`, "PATCH", { status: "open" })).status,
    409,
  );
  assert.equal(
    (await admin(`/maintenance/${requestId}`, "PUT", {
      propertyId,
      unitId,
      title: "Cannot edit completed request",
      description: "Synthetic",
      category: "plumbing",
    })).status,
    409,
  );

  const cancelled = await admin("/maintenance", "POST", {
    propertyId,
    title: "Cancel synthetic repair",
    description: "Synthetic request for cancellation transition.",
    category: "appliance",
  });
  assert.equal(cancelled.status, 201);
  const cancelledId = cancelled.data.request.id as number;
  assert.equal(
    (await admin(`/maintenance/${cancelledId}/status`, "PATCH", {
      status: "cancelled",
    })).status,
    200,
  );
  assert.equal(
    (await admin(`/maintenance/${cancelledId}/status`, "PATCH", {
      status: "in_progress",
    })).status,
    409,
  );

  const dashboard = await admin("/maintenance/dashboard");
  assert.equal(dashboard.data.dashboard.current.open, 1);
  assert.equal(dashboard.data.dashboard.current.highPriority, 0);
  assert.equal(dashboard.data.dashboard.recentlyCompleted[0].id, requestId);

  const frontDesk = await admin.login(
    "maintenance-front-desk",
    "synthetic-maintenance-frontdesk",
  );
  assert.equal(frontDesk.status, 200);
  assert.equal((await admin("/maintenance")).status, 200);
  assert.equal((await admin("/maintenance/dashboard")).status, 200);
  assert.equal((await admin(`/maintenance/${requestId}`)).status, 200);
  const frontDeskReport = await admin("/maintenance", "POST", {
    propertyId,
    title: "Front desk report",
    description: "Synthetic issue from front desk.",
    category: "structural",
    priority: "normal",
  });
  assert.equal(frontDeskReport.status, 201);
  assert.equal(
    (await admin(`/maintenance/${frontDeskReport.data.request.id}`, "PUT", {
      propertyId,
      title: "Unauthorized edit",
      description: "Synthetic",
      category: "structural",
    })).status,
    403,
  );
  assert.equal(
    (await admin(`/maintenance/${frontDeskReport.data.request.id}/status`, "PATCH", {
      status: "cancelled",
    })).status,
    403,
  );
  assert.equal(
    (await admin("/maintenance", "POST", {
      propertyId,
      title: "Attempt assignment",
      description: "Synthetic",
      category: "plumbing",
      assignedStaffId: frontDeskCreated.data.staff.id,
    })).status,
    403,
  );

  await admin.login(
    "maintenance-housekeeping",
    "synthetic-maintenance-housekeeping",
  );
  const housekeepingReport = await admin("/maintenance", "POST", {
    propertyId,
    unitId,
    title: "Room cleaning defect",
    description: "Synthetic cleaning-related request.",
    category: "cleaning_related",
  });
  assert.equal(housekeepingReport.status, 201);
  assert.equal(
    (await admin("/maintenance", "POST", {
      propertyId,
      title: "Technical report denied",
      description: "Synthetic non-cleaning issue.",
      category: "electrical",
    })).status,
    403,
  );
  assert.equal(
    (await admin("/maintenance", "POST", {
      propertyId,
      title: "Assignment denied",
      description: "Synthetic assignment attempt.",
      category: "cleaning_related",
      assignedStaffId: frontDeskCreated.data.staff.id,
    })).status,
    403,
  );
  assert.equal(
    (await admin(`/maintenance/${housekeepingReport.data.request.id}/status`, "PATCH", {
      status: "in_progress",
    })).status,
    403,
  );
  assert.equal(
    (await admin(`/maintenance/${housekeepingReport.data.request.id}`, "PUT", {
      propertyId,
      title: "Edit denied",
      description: "Synthetic",
      category: "cleaning_related",
    })).status,
    403,
  );
  assert.equal((await admin("/guests")).status, 403);

  await admin.login(
    "maintenance-accounting",
    "synthetic-maintenance-accounting",
  );
  assert.equal((await admin("/maintenance")).status, 403);
  assert.equal((await admin("/maintenance/dashboard")).status, 403);
  assert.equal((await admin("/maintenance/options")).status, 403);

  await admin.login("test-admin", "synthetic-test-password-123");
  const options = await admin("/maintenance/options");
  assert.equal(options.status, 200);
  assert.equal(options.data.properties.length, 2);
  assert.equal(options.data.units.length, 2);
  assert.ok(options.data.staff.some((staff: { id: number }) => staff.id === inactiveStaffId) === false);

  const maintenanceUnitStatus = await admin(
    `/properties/${propertyId}/units/${unitId}/status`,
    "PATCH",
    { status: "maintenance" },
  );
  assert.equal(maintenanceUnitStatus.status, 200);
  await admin.login(
    "maintenance-housekeeping",
    "synthetic-maintenance-housekeeping",
  );
  assert.equal(
    (await admin(`/housekeeping/units/${unitId}/status`, "PATCH", {
      status: "cleaning",
    })).status,
    409,
  );
  await admin.login("test-admin", "synthetic-test-password-123");
  const stillMaintenance = await admin(
    `/properties/${propertyId}/units/${unitId}/status`,
    "PATCH",
    { status: "maintenance" },
  );
  assert.equal(stillMaintenance.data.unit.status, "maintenance");
  assert.equal(
    database.$client.prepare("SELECT COUNT(*) AS count FROM maintenance_history").get()?.count,
    10,
  );
  assert.deepEqual(database.$client.prepare("PRAGMA foreign_key_check").all(), []);

  console.log("Maintenance workflow, dashboard, role controls, validation, history, and housekeeping integration tests passed.");
} finally {
  if (server?.listening) {
    await new Promise<void>((resolveClose, reject) => {
      server?.close((error) => error ? reject(error) : resolveClose());
    });
  }
  database.$client.close();
  rmSync(testDirectory, { recursive: true, force: true });
}
