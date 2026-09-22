import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface MigrationTarget {
  query(sql: string): Promise<unknown>;
}

export async function runMigrations(
  target: MigrationTarget,
  migrationPath = resolve(process.cwd(), "migrations", "001_init.sql"),
): Promise<void> {
  const sql = await readFile(migrationPath, "utf8");
  await target.query(sql);
}
