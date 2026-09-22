import { Pool } from "pg";

import type { AppConfig } from "../config.js";

export function createPool(config: AppConfig): Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    max: config.poolMax,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: "replit-cockroachdb-poc",
  });
}
