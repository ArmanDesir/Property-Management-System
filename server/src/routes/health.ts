import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";

export function createHealthRouter(database: DatabaseSync): Router {
  const router = Router();

  router.get("/", (_request, response) => {
    database.prepare("SELECT 1").get();
    response.json({ status: "ok", database: "connected" });
  });

  return router;
}
