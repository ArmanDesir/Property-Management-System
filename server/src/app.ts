import cors from "cors";
import express from "express";
import { closeDatabase, getDatabase } from "./db/index.js";
import { createHealthRouter } from "./routes/health.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const database = getDatabase();

app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json());
app.use("/api/health", createHealthRouter(database));

const server = app.listen(port, () => {
  console.log(`Local PMS API listening at http://localhost:${port}`);
});

function shutdown() {
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
