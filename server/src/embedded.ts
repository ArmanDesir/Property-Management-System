import { backup, DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { createApp } from "./app.js";
import { createDatabase } from "./db/connection.js";
import { runMigrations } from "./db/migrations.js";

export async function startEmbeddedServer(
  databasePath: string,
  port: number,
  baselinePath: string,
): Promise<{ close: () => Promise<void> }> {
  const migrationsFolder = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "db",
    "migrations",
  );
  let running: { server: Server; database: ReturnType<typeof createDatabase> } | null = null;
  let restoring = false;

  const start = async () => {
    const database = createDatabase(databasePath);
    try {
      await runMigrations(database, migrationsFolder);
      const app = createApp(database, {
        baselinePath,
        restoreBaseline,
      });
      const server = await listen(app, port);
      running = { server, database };
      console.log(`Local PMS API listening at http://127.0.0.1:${port}`);
    } catch (error) {
      database.$client.close();
      throw error;
    }
  };

  const restoreBaseline = async () => {
    if (restoring) return;
    restoring = true;
    const previous = running;
    running = null;
    if (!previous) {
      restoring = false;
      throw new Error("The PMS server is not running.");
    }
    try {
      await close(previous.server, previous.database.$client);
      const baseline = new DatabaseSync(baselinePath, { readOnly: true });
      try {
        await backup(baseline, databasePath);
      } finally {
        baseline.close();
      }
      const restoredDatabase = createDatabase(databasePath);
      try {
        restoredDatabase.$client.exec("DELETE FROM auth_sessions");
        restoredDatabase.$client.exec(`
          UPDATE classroom_security SET failed_attempts = 0, locked_until = NULL
        `);
      } finally {
        restoredDatabase.$client.close();
      }
      await start();
    } catch (error) {
      if (!running) {
        try {
          await start();
        } catch (restartError) {
          console.error("Could not restart PMS after a baseline restore failure:", restartError);
        }
      }
      throw error;
    } finally {
      restoring = false;
    }
  };

  await start();
  return {
    close: async () => {
      if (!running) return;
      const current = running;
      running = null;
      await close(current.server, current.database.$client);
    },
  };
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
