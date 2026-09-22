import { readFile } from "node:fs/promises";

import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";

const config = loadConfig();
const pool = createPool(config);

try {
  const migrationUrl = new URL("../migrations/001_init.sql", import.meta.url);
  const sql = await readFile(migrationUrl, "utf8");
  await pool.query(sql);
  console.log("Migration complete");
} finally {
  await pool.end();
}
