import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { createApp } from "./app.js";
import { createDatabase } from "./db/connection.js";
import { runMigrations } from "./db/migrations.js";

export async function startEmbeddedServer(
  databasePath: string,
  port: number,
): Promise<{ close: () => Promise<void> }> {
  const database = createDatabase(databasePath);
  const migrationsFolder = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "db",
    "migrations",
  );

  try {
    await runMigrations(database, migrationsFolder);
    const app = createApp(database);
    const server = await listen(app, port);
    console.log(`Local PMS API listening at http://127.0.0.1:${port}`);
    return {
      close: () => close(server, database.$client),
    };
  } catch (error) {
    database.$client.close();
    throw error;
  }
}

function listen(
  app: ReturnType<typeof createApp>,
  port: number,
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

function close(
  server: Server,
  database: ReturnType<typeof createDatabase>["$client"],
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      database.close();
      if (error) reject(error);
      else resolve();
    });
  });
}
