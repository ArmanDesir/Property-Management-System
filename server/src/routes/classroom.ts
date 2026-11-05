import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { backup } from "node:sqlite";
import { Router } from "express";
import type { PmsDatabase } from "../db/connection.js";
import { asyncHandler, HttpError } from "../middleware/http-errors.js";
import { verifyAdministratorRecoveryPin } from "../services/auth.js";
import { requireObject } from "../services/validation.js";
import { recoveryPinValue, rejectFields } from "./auth.js";

export function createClassroomRouter(
  database: PmsDatabase,
  options: {
    baselinePath?: string;
    restoreBaseline?: () => Promise<void>;
  },
): Router {
  const router = Router();

  router.get("/status", asyncHandler(async (_request, response) => {
    const configured = database.$client.prepare(
      "SELECT 1 FROM classroom_security WHERE id = 1",
    ).get() !== undefined;
    if (!options.baselinePath) {
      response.json({ recoveryPinConfigured: configured, baselineSaved: false });
      return;
    }
    try {
      const baseline = await stat(options.baselinePath);
      response.json({
        recoveryPinConfigured: configured,
        baselineSaved: true,
        baselineSavedAt: baseline.mtime.toISOString(),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      response.json({ recoveryPinConfigured: configured, baselineSaved: false });
    }
  }));

  router.post(
    "/baseline",
    asyncHandler(async (request, response) => {
      const baselinePath = requireBaselinePath(options.baselinePath);
      const body = requireObject(request.body);
      rejectFields(body, new Set(["recoveryPin"]));
      verifyAdministratorRecoveryPin(database, recoveryPinValue(body.recoveryPin));
      await mkdir(dirname(baselinePath), { recursive: true });
      await backup(database.$client, baselinePath);
      const baseline = await stat(baselinePath);
      response.status(201).json({
        baselineSaved: true,
        baselineSavedAt: baseline.mtime.toISOString(),
      });
    }),
  );

  router.post(
    "/reset",
    asyncHandler(async (request, response) => {
      const baselinePath = requireBaselinePath(options.baselinePath);
      if (!options.restoreBaseline) {
        throw new HttpError(503, "Baseline restore is available only in the desktop app.");
      }
      await stat(baselinePath);
      const body = requireObject(request.body);
      rejectFields(body, new Set(["recoveryPin"]));
      verifyAdministratorRecoveryPin(database, recoveryPinValue(body.recoveryPin));
      response.status(202).json({ resetting: true });
      response.once("finish", () => {
        setTimeout(() => {
          void options.restoreBaseline?.().catch((error: unknown) => {
            console.error("Could not restore the classroom baseline:", error);
          });
        }, 250);
      });
    }),
  );

  return router;
}

function requireBaselinePath(path: string | undefined): string {
  if (!path) {
    throw new HttpError(503, "Classroom baseline controls are available only in the desktop app.");
  }
  return path;
}
