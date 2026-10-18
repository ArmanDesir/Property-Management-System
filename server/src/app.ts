import express from "express";
import type { PmsDatabase } from "./db/connection.js";
import { errorHandler } from "./middleware/http-errors.js";
import { createHealthRouter } from "./routes/health.js";
import { createGuestsRouter } from "./routes/guests.js";
import { createFrontDeskRouter } from "./routes/front-desk.js";
import { createHousekeepingRouter } from "./routes/housekeeping.js";
import { createInvoicesRouter } from "./routes/invoices.js";
import { createPropertiesRouter } from "./routes/properties.js";
import { createReservationsRouter } from "./routes/reservations.js";

export function createApp(database: PmsDatabase) {
  const app = express();

  app.use(express.json({ limit: "100kb" }));
  app.use("/api/health", createHealthRouter(database));
  app.use("/api/front-desk", createFrontDeskRouter(database));
  app.use("/api/housekeeping", createHousekeepingRouter(database));
  app.use("/api/invoices", createInvoicesRouter(database));
  app.use("/api/guests", createGuestsRouter(database));
  app.use("/api/properties", createPropertiesRouter(database));
  app.use("/api/reservations", createReservationsRouter(database));
  app.use(errorHandler);

  return app;
}
