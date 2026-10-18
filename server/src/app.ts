import express from "express";
import type { PmsDatabase } from "./db/connection.js";
import { errorHandler } from "./middleware/http-errors.js";
import { createHealthRouter } from "./routes/health.js";
import { createPropertiesRouter } from "./routes/properties.js";

export function createApp(database: PmsDatabase) {
  const app = express();

  app.use(express.json({ limit: "100kb" }));
  app.use("/api/health", createHealthRouter(database));
  app.use("/api/properties", createPropertiesRouter(database));
  app.use(errorHandler);

  return app;
}
