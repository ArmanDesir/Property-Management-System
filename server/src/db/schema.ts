import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

export function initializeSchema(database: DatabaseSync, migrationPath: string): void {
  const migration = readFileSync(migrationPath, "utf8");
  database.exec(migration);
}
