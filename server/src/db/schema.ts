import Database from "better-sqlite3";
import { readFileSync } from "node:fs";

export function initializeSchema(database: Database.Database, migrationPath: string): void {
  const migration = readFileSync(migrationPath, "utf8");
  database.exec(migration);
}
