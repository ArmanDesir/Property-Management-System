import { closeDatabase, getDatabase } from "./db/index.js";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const app = createApp(getDatabase());
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Local PMS API listening at http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
