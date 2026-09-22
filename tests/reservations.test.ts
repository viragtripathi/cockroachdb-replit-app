import { describe, expect, test } from "vitest";

import type { PoolClientLike, PoolLike, QueryResultLike } from "../src/db/contracts.js";
import {
  ReservationNotFoundError,
  ReservationService,
  SeatOccupiedError,
} from "../src/reservations/service.js";

interface RecordedQuery {
  text: string;
  values?: readonly unknown[];
}

const operationId = "10000000-0000-4000-8000-000000000001";
const seatId = "20000000-0000-4000-8000-000000000002";
const userId = "30000000-0000-4000-8000-000000000003";
const createdAt = new Date("2026-09-22T12:00:00.000Z");

const reservationRow = {
  operationId,
  seatId,
  userId,
  createdAt,
};

class ReservationClient implements PoolClientLike {
  readonly queries: RecordedQuery[] = [];
  released = false;

  constructor(
    private readonly state: {
      existing?: typeof reservationRow;
      seat?: { id: string; label: string; reservedBy: string | null };
    },
  ) {}

  async query<Row = unknown>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResultLike<Row>> {
    this.queries.push(values === undefined ? { text } : { text, values });
    const normalized = text.replace(/\s+/g, " ").trim();

    if (/^SELECT .* FROM reservations WHERE operation_id/.test(normalized)) {
      const rows = this.state.existing === undefined ? [] : [this.state.existing];
      return { rows: rows as Row[], rowCount: rows.length };
    }

    if (/^SELECT .* FROM seats WHERE id .* FOR UPDATE$/.test(normalized)) {
      const rows = this.state.seat === undefined ? [] : [this.state.seat];
      return { rows: rows as Row[], rowCount: rows.length };
    }

    if (/^INSERT INTO reservations/.test(normalized)) {
      return { rows: [reservationRow] as Row[], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }

  release(): void {
    this.released = true;
  }
}

class SingleClientPool implements PoolLike {
  constructor(readonly client: ReservationClient) {}

  async connect(): Promise<ReservationClient> {
    return this.client;
  }
}

function sqlQueries(client: ReservationClient): RecordedQuery[] {
  return client.queries.filter(({ text }) => !["BEGIN", "COMMIT", "ROLLBACK"].includes(text));
}

describe("ReservationService.reserve", () => {
  test("locks an available seat, inserts the reservation, and marks the seat reserved", async () => {
    const client = new ReservationClient({
      seat: { id: seatId, label: "A-1", reservedBy: null },
    });
    const service = new ReservationService(new SingleClientPool(client), { sleep: async () => undefined });

    await expect(service.reserve({ operationId, seatId, userId })).resolves.toEqual(reservationRow);

    expect(client.queries.map(({ text }) => text.replace(/\s+/g, " ").trim())).toEqual([
      "BEGIN",
      expect.stringMatching(/^SELECT .* FROM reservations WHERE operation_id/),
      expect.stringMatching(/^SELECT .* FROM seats WHERE id .* FOR UPDATE$/),
      expect.stringMatching(/^INSERT INTO reservations/),
      expect.stringMatching(/^UPDATE seats SET reserved_by/),
      "COMMIT",
    ]);
    expect(sqlQueries(client).map(({ values }) => values)).toEqual([
      [operationId],
      [seatId],
      [operationId, seatId, userId],
      [userId, seatId],
    ]);
    expect(client.released).toBe(true);
  });

  test("returns an existing operation without touching the seat", async () => {
    const client = new ReservationClient({ existing: reservationRow });
    const service = new ReservationService(new SingleClientPool(client), { sleep: async () => undefined });

    await expect(service.reserve({ operationId, seatId, userId })).resolves.toEqual(reservationRow);

    expect(client.queries.map(({ text }) => text)).toEqual([
      "BEGIN",
      expect.stringMatching(/FROM reservations/),
      "COMMIT",
    ]);
  });

  test("rejects a new operation for an occupied seat", async () => {
    const client = new ReservationClient({
      seat: { id: seatId, label: "A-1", reservedBy: "40000000-0000-4000-8000-000000000004" },
    });
    const service = new ReservationService(new SingleClientPool(client), { sleep: async () => undefined });

    await expect(service.reserve({ operationId, seatId, userId })).rejects.toBeInstanceOf(
      SeatOccupiedError,
    );
    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
  });

  test("rejects an operation for a missing seat", async () => {
    const client = new ReservationClient({});
    const service = new ReservationService(new SingleClientPool(client), { sleep: async () => undefined });

    await expect(service.reserve({ operationId, seatId, userId })).rejects.toBeInstanceOf(
      ReservationNotFoundError,
    );
    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
  });

  test("never interpolates identifiers into SQL text", async () => {
    const client = new ReservationClient({
      seat: { id: seatId, label: "A-1", reservedBy: null },
    });
    const service = new ReservationService(new SingleClientPool(client), { sleep: async () => undefined });

    await service.reserve({ operationId, seatId, userId });

    for (const { text } of sqlQueries(client)) {
      expect(text).not.toContain(operationId);
      expect(text).not.toContain(seatId);
      expect(text).not.toContain(userId);
    }
  });
});
