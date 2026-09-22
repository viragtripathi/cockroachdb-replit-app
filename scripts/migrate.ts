import { loadConfig } from "../src/config.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";

const config = loadConfig();
const pool = createPool(config);

try {
  await runMigrations(pool);
  console.log("Migration complete");
} finally {
  await pool.end();
}
