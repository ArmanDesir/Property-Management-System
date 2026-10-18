import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
import type { PmsDatabase } from "./connection.js";

export async function runMigrations(
  database: PmsDatabase,
  migrationsFolder: string,
): Promise<void> {
  await migrate(
    database,
    async (queries) => {
      const client = database.$client;
      client.exec("BEGIN IMMEDIATE");
      try {
        for (const query of queries) client.exec(query);
        client.exec("COMMIT");
      } catch (error) {
        client.exec("ROLLBACK");
        throw error;
      }
    },
    { migrationsFolder },
  );
}
