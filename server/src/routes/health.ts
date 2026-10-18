import { Router } from "express";
import type { PmsDatabase } from "../db/connection.js";

export function createHealthRouter(database: PmsDatabase): Router {
  const router = Router();

  router.get("/", (_request, response) => {
    database.$client.prepare("SELECT 1").get();
    response.json({ status: "ok", database: "connected" });
  });

  return router;
}
