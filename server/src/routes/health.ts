import { Router } from "express";
import type Database from "better-sqlite3";

export function createHealthRouter(database: Database.Database): Router {
  const router = Router();

  router.get("/", (_request, response) => {
    database.prepare("SELECT 1").get();
    response.json({ status: "ok", database: "connected" });
  });

  return router;
}
