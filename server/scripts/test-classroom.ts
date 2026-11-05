import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { createTestApiClient } from "./test-api-client.js";

process.env.PMS_FRONTEND_ORIGIN = "http://127.0.0.1:5173";

const testDirectory = mkdtempSync(resolve(tmpdir(), "local-pms-classroom-test-"));
const databasePath = resolve(testDirectory, "classroom-test.sqlite");
const baselinePath = resolve(testDirectory, "classroom-baseline.sqlite");
const portProbe = createServer();
let embeddedServer: { close: () => Promise<void> } | undefined;

try {
  await new Promise<void>((resolveListening, reject) => {
    portProbe.once("error", reject);
    portProbe.listen(0, "127.0.0.1", resolveListening);
  });
  const address = portProbe.address() as AddressInfo;
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => {
    portProbe.close((error) => error ? reject(error) : resolveClose());
  });

  const { startEmbeddedServer } = await import("../src/embedded.js");
  embeddedServer = await startEmbeddedServer(databasePath, port, baselinePath);
  const baseUrl = `http://127.0.0.1:${port}/api`;
  const admin = await createTestApiClient(baseUrl);

  const initialProperty = await admin("/properties", "POST", {
    name: "Baseline Classroom Hotel",
    propertyType: "hotel",
    defaultCurrency: "USD",
  });
  assert.equal(initialProperty.status, 201);
  const initialPropertyId = initialProperty.data.property.id as number;
  assert.equal((await admin(`/properties/${initialPropertyId}/units`, "POST", {
    name: "B-01",
    capacity: 2,
    baseNightlyRate: 100,
  })).status, 201);

  const initialStatus = await admin("/classroom/status");
  assert.equal(initialStatus.status, 200);
  assert.equal(initialStatus.data.recoveryPinConfigured, true);
  assert.equal(initialStatus.data.baselineSaved, false);

  const deniedPinChange = await admin("/auth/recovery-pin", "PUT", {
    currentRecoveryPin: "000000",
    recoveryPin: "654321",
  });
  assert.equal(deniedPinChange.status, 401);
  assert.equal(
    (await admin("/auth/recovery-pin", "PUT", {
      currentRecoveryPin: "842691",
      recoveryPin: "654321",
    })).status,
    204,
  );
  assert.equal(
    (await admin("/auth/recovery-pin", "PUT", {
      currentRecoveryPin: "654321",
      recoveryPin: "842691",
    })).status,
    204,
  );

  assert.equal(
    (await admin("/classroom/baseline", "POST", {
      recoveryPin: "000000",
    })).status,
    401,
  );
  const savedBaseline = await admin("/classroom/baseline", "POST", {
    recoveryPin: "842691",
  });
  assert.equal(savedBaseline.status, 201);
  assert.equal(savedBaseline.data.baselineSaved, true);

  const studentProperty = await admin("/properties", "POST", {
    name: "Student Demo Hotel",
    propertyType: "hotel",
    defaultCurrency: "USD",
  });
  assert.equal(studentProperty.status, 201);
  const studentGuest = await admin("/guests", "POST", {
    firstName: "Synthetic",
    lastName: "Classroom Guest",
    email: "classroom@example.test",
  });
  assert.equal(studentGuest.status, 201);
  const studentAccount = await admin("/staff", "POST", {
    displayName: "Synthetic Student",
    username: "student-demo",
    role: "front_desk",
    password: "admin123",
  });
  assert.equal(studentAccount.status, 201);

  const student = await createTestApiClient(baseUrl, false);
  assert.equal((await student.login("student-demo", "admin123")).status, 200);
  const changedAdminPassword = await admin("/auth/recovery", "POST", {
    username: "test-admin",
    recoveryPin: "842691",
    password: "changed123",
  });
  assert.equal(changedAdminPassword.status, 200);
  assert.equal((await admin("/auth/me")).status, 200);

  const rejectedReset = await admin("/classroom/reset", "POST", {
    recoveryPin: "000000",
  });
  assert.equal(rejectedReset.status, 401);
  assert.equal((await admin("/guests?status=all")).data.guests.length, 1);

  const reset = await admin("/classroom/reset", "POST", {
    recoveryPin: "842691",
  });
  assert.equal(reset.status, 202);

  const deadline = Date.now() + 10_000;
  let sessionInvalidated = false;
  while (Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    try {
      if ((await admin("/auth/me")).status === 401) {
        sessionInvalidated = true;
        break;
      }
    } catch {
      // The embedded API is expected to be unavailable while it restarts.
    }
  }
  assert.equal(sessionInvalidated, true, "baseline restoration should restart the API and invalidate sessions");
  assert.equal((await student("/auth/me")).status, 401);

  const restoredAdmin = await createTestApiClient(baseUrl, false);
  assert.equal(
    (await restoredAdmin.login("test-admin", "synthetic-test-password-123")).status,
    200,
  );
  assert.equal(
    (await restoredAdmin.login("test-admin", "changed123")).status,
    401,
  );
  const restoredProperties = await restoredAdmin("/properties");
  assert.equal(restoredProperties.status, 200);
  assert.equal(restoredProperties.data.properties.length, 1);
  assert.equal(restoredProperties.data.properties[0].name, "Baseline Classroom Hotel");
  const restoredGuests = await restoredAdmin("/guests?status=all");
  assert.equal(restoredGuests.status, 200);
  assert.equal(restoredGuests.data.guests.length, 0);
  const restoredStaff = await restoredAdmin("/staff");
  assert.equal(restoredStaff.data.staff.length, 1);
  const restoredStatus = await restoredAdmin("/classroom/status");
  assert.equal(restoredStatus.data.recoveryPinConfigured, true);
  assert.equal(restoredStatus.data.baselineSaved, true);

  console.log("Classroom baseline and reset integration tests passed.");
} finally {
  if (portProbe.listening) {
    await new Promise<void>((resolveClose, reject) => {
      portProbe.close((error) => error ? reject(error) : resolveClose());
    });
  }
  if (embeddedServer) await embeddedServer.close();
  rmSync(testDirectory, { recursive: true, force: true });
}
