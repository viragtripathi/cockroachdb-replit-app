import type { Server } from "node:http";

import { loadConfig } from "./config.js";
import type { PoolLike } from "./db/contracts.js";
import { createPool } from "./db/pool.js";
import { createApp } from "./http/app.js";
import { ReservationService } from "./reservations/service.js";

const config = loadConfig();
const pool = createPool(config);
const service = new ReservationService(pool as unknown as PoolLike, config.retry);
const app = createApp({
  service,
  healthCheck: async () => {
    await pool.query("SELECT 1");
  },
});

let server: Server;
let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  await pool.end();
}

server = app.listen(config.port, config.host, () => {
  console.log(`Server listening on port ${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().catch(() => {
      process.exitCode = 1;
    });
  });
}
