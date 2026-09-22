import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { PoolLike } from "../../src/db/contracts.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createPool } from "../../src/db/pool.js";
import { executeTx } from "../../src/db/retry.js";
import { ReservationService, SeatOccupiedError } from "../../src/reservations/service.js";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(databaseUrl === undefined)("CockroachDB integration", () => {
  const pool = createPool({
    databaseUrl: databaseUrl as string,
    port: 3000,
    host: "127.0.0.1",
    poolMax: 4,
    applicationName: "cockroachdb-replit-app-integration",
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 5_000,
    retry: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5 },
    nodeEnv: "test",
  });
  const compatiblePool = pool as unknown as PoolLike;
  const service = new ReservationService(compatiblePool, {
    maxAttempts: 5,
    baseDelayMs: 1,
    maxDelayMs: 5,
  });
  const seatIds: string[] = [];

  beforeAll(async () => {
    await runMigrations(pool);
  });

  afterAll(async () => {
    if (seatIds.length > 0) {
      await pool.query("DELETE FROM reservations WHERE seat_id = ANY($1::UUID[])", [seatIds]);
      await pool.query("DELETE FROM seats WHERE id = ANY($1::UUID[])", [seatIds]);
    }
    await pool.end();
  });

  test("migrates and completes an idempotent reservation workflow", async () => {
    const seatId = randomUUID();
    const operationId = randomUUID();
    const userId = randomUUID();
    seatIds.push(seatId);

    await service.createSeat({ id: seatId, label: `integration-${seatId}` });
    const first = await service.reserve({ operationId, seatId, userId });
    const repeated = await service.reserve({ operationId, seatId, userId });

    expect(repeated).toEqual(first);
    expect(await service.get(operationId)).toEqual(first);
    await expect(
      service.reserve({ operationId: randomUUID(), seatId, userId: randomUUID() }),
    ).rejects.toBeInstanceOf(SeatOccupiedError);
  });

  test("retries a real serialization conflict from the complete callback", async () => {
    const seatId = randomUUID();
    const initialLabel = `retry-${seatId}`;
    seatIds.push(seatId);
    await service.createSeat({ id: seatId, label: initialLabel });

    let firstReaders = 0;
    let releaseReaders: (() => void) | undefined;
    const bothRead = new Promise<void>((resolve) => {
      releaseReaders = resolve;
    });
    const callbackCalls: [number, number] = [0, 0];

    const appendToLabel = async (worker: number, suffix: string): Promise<void> => {
      await executeTx(
        compatiblePool,
        async (client) => {
          callbackCalls[worker] = (callbackCalls[worker] ?? 0) + 1;
          const response = await client.query<{ label: string }>(
            "SELECT label FROM seats WHERE id = $1",
            [seatId],
          );

          if (callbackCalls[worker] === 1) {
            firstReaders += 1;
            if (firstReaders === 2) releaseReaders?.();
            await bothRead;
          }

          await client.query("UPDATE seats SET label = $1 WHERE id = $2", [
            `${response.rows[0]?.label}${suffix}`,
            seatId,
          ]);
        },
        { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5 },
      );
    };

    await Promise.all([appendToLabel(0, "-a"), appendToLabel(1, "-b")]);

    const final = await pool.query<{ label: string }>("SELECT label FROM seats WHERE id = $1", [
      seatId,
    ]);
    expect(callbackCalls[0] + callbackCalls[1]).toBeGreaterThanOrEqual(3);
    expect(final.rows[0]?.label).toMatch(new RegExp(`^${initialLabel}-(a-b|b-a)$`));
  });
});
