import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { runMigrations } from "../../src/db/migrate.js";

const databaseUrl = process.env.DATABASE_URL;
const enabled = databaseUrl !== undefined && process.env.RUN_E2E === "true";

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not allocate an E2E port");
  }
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error === undefined ? resolveClose() : reject(error))),
  );
  return address.port;
}

async function waitForHealth(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("App process exited before becoming healthy");
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The server may still be binding or establishing its first database connection.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("App did not become healthy within 30 seconds");
}

describe.skipIf(!enabled)("built application E2E", () => {
  const seatId = randomUUID();
  const operationId = randomUUID();
  const userId = randomUUID();
  let child: ChildProcess | undefined;
  let pool: Pool | undefined;
  let baseUrl = "";

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl as string, max: 2 });
    await runMigrations(pool);
    const port = await availablePort();
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [resolve(process.cwd(), "dist", "src", "server.js")], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl as string,
        PORT: String(port),
        HOST: "127.0.0.1",
        APPLICATION_NAME: "cockroachdb-replit-app-e2e",
        NODE_ENV: "test",
      },
      stdio: "ignore",
    });
    await waitForHealth(baseUrl, child);
  }, 35_000);

  afterAll(async () => {
    if (child !== undefined && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        once(child, "exit"),
        new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    if (pool !== undefined) {
      await pool.query("DELETE FROM reservations WHERE seat_id = $1", [seatId]);
      await pool.query("DELETE FROM seats WHERE id = $1", [seatId]);
      await pool.end();
    }
  });

  test("serves the complete reservation lifecycle over HTTP", async () => {
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);

    const invalid = await fetch(`${baseUrl}/seats`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "invalid", label: "" }),
    });
    expect(invalid.status).toBe(400);

    const created = await fetch(`${baseUrl}/seats`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: seatId, label: `e2e-${seatId}` }),
    });
    expect(created.status).toBe(201);

    const requestBody = JSON.stringify({ operationId, seatId, userId });
    const first = await fetch(`${baseUrl}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestBody,
    });
    const repeated = await fetch(`${baseUrl}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestBody,
    });
    expect(first.status).toBe(201);
    expect(repeated.status).toBe(201);
    expect(await repeated.json()).toEqual(await first.json());

    const conflict = await fetch(`${baseUrl}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operationId: randomUUID(), seatId, userId: randomUUID() }),
    });
    expect(conflict.status).toBe(409);

    const lookup = await fetch(`${baseUrl}/reservations/${operationId}`);
    expect(lookup.status).toBe(200);
    expect(await lookup.json()).toMatchObject({ operationId, seatId, userId });
  });
});
