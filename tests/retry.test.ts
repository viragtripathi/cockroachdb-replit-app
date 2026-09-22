import { describe, expect, test, vi } from "vitest";

import type {
  PoolClientLike,
  PoolLike,
  QueryResultLike,
} from "../src/db/contracts.js";
import { AmbiguousResultError } from "../src/db/errors.js";
import { executeTx } from "../src/db/retry.js";

function databaseError(code: string, message = `database error ${code}`): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

class ScriptedClient implements PoolClientLike {
  readonly commands: string[] = [];
  released = false;

  constructor(
    private readonly commitError?: unknown,
    private readonly rollbackError?: unknown,
  ) {}

  async query<Row = unknown>(text: string): Promise<QueryResultLike<Row>> {
    this.commands.push(text);
    if (text === "COMMIT" && this.commitError !== undefined) {
      throw this.commitError;
    }
    if (text === "ROLLBACK" && this.rollbackError !== undefined) {
      throw this.rollbackError;
    }
    return { rows: [], rowCount: 0 };
  }

  release(): void {
    this.released = true;
  }
}

class ScriptedPool implements PoolLike {
  readonly clients: ScriptedClient[] = [];
  connectCalls = 0;

  constructor(private readonly createClient: (attempt: number) => ScriptedClient = () => new ScriptedClient()) {}

  async connect(): Promise<ScriptedClient> {
    this.connectCalls += 1;
    const client = this.createClient(this.connectCalls);
    this.clients.push(client);
    return client;
  }
}

const noDelay = async (): Promise<void> => undefined;

describe("executeTx", () => {
  test("commits and releases a successful transaction", async () => {
    const pool = new ScriptedPool();

    const result = await executeTx(pool, async () => "reserved", { sleep: noDelay });

    expect(result).toBe("reserved");
    expect(pool.clients[0]?.commands).toEqual(["BEGIN", "COMMIT"]);
    expect(pool.clients[0]?.released).toBe(true);
  });

  test("replays the complete transaction after serialization failures", async () => {
    const pool = new ScriptedPool();
    const retryEvents: Array<{ attempt: number; delayMs: number; code: string }> = [];
    let operationCalls = 0;

    const result = await executeTx(
      pool,
      async () => {
        operationCalls += 1;
        if (operationCalls < 3) {
          throw databaseError("40001");
        }
        return "reserved";
      },
      {
        sleep: noDelay,
        random: () => 0.5,
        onRetry: (event) => retryEvents.push(event),
      },
    );

    expect(result).toBe("reserved");
    expect(operationCalls).toBe(3);
    expect(pool.connectCalls).toBe(3);
    expect(pool.clients.map((client) => client.commands)).toEqual([
      ["BEGIN", "ROLLBACK"],
      ["BEGIN", "ROLLBACK"],
      ["BEGIN", "COMMIT"],
    ]);
    expect(pool.clients.every((client) => client.released)).toBe(true);
    expect(retryEvents).toEqual([
      { attempt: 1, delayMs: 10, code: "40001" },
      { attempt: 2, delayMs: 20, code: "40001" },
    ]);
  });

  test("surfaces an ambiguous result without retrying", async () => {
    const pool = new ScriptedPool();
    const cause = databaseError("40003", "statement completion unknown");

    const error = await executeTx(
      pool,
      async () => {
        throw cause;
      },
      { sleep: noDelay },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AmbiguousResultError);
    expect((error as AmbiguousResultError).cause).toBe(cause);
    expect(pool.connectCalls).toBe(1);
    expect(pool.clients[0]?.commands).toEqual(["BEGIN", "ROLLBACK"]);
  });

  test("does not retry non-retryable database errors", async () => {
    const pool = new ScriptedPool();
    const original = databaseError("23505", "duplicate key");

    await expect(
      executeTx(
        pool,
        async () => {
          throw original;
        },
        { sleep: noDelay },
      ),
    ).rejects.toBe(original);
    expect(pool.connectCalls).toBe(1);
  });

  test("stops after the configured number of attempts", async () => {
    const pool = new ScriptedPool();
    const lastError = databaseError("40001");

    await expect(
      executeTx(
        pool,
        async () => {
          throw lastError;
        },
        { maxAttempts: 3, sleep: noDelay },
      ),
    ).rejects.toBe(lastError);
    expect(pool.connectCalls).toBe(3);
  });

  test("does not acquire a connection when already aborted", async () => {
    const pool = new ScriptedPool();
    const controller = new AbortController();
    controller.abort();

    await expect(
      executeTx(pool, async () => "unreachable", {
        signal: controller.signal,
        sleep: noDelay,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(pool.connectCalls).toBe(0);
  });

  test("does not start another attempt after abortion during backoff", async () => {
    const pool = new ScriptedPool();
    const controller = new AbortController();
    const sleep = vi.fn(async () => {
      controller.abort();
    });

    await expect(
      executeTx(
        pool,
        async () => {
          throw databaseError("40001");
        },
        { signal: controller.signal, sleep },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(pool.connectCalls).toBe(1);
    expect(sleep).toHaveBeenCalledOnce();
  });

  test("preserves the original error when rollback also fails", async () => {
    const original = databaseError("23505", "duplicate key");
    const pool = new ScriptedPool(() => new ScriptedClient(undefined, new Error("rollback failed")));

    await expect(
      executeTx(
        pool,
        async () => {
          throw original;
        },
        { sleep: noDelay },
      ),
    ).rejects.toBe(original);
    expect(pool.clients[0]?.released).toBe(true);
  });

  test("replays the callback when commit returns a serialization failure", async () => {
    const pool = new ScriptedPool((attempt) =>
      attempt === 1 ? new ScriptedClient(databaseError("40001")) : new ScriptedClient(),
    );
    let operationCalls = 0;

    const result = await executeTx(
      pool,
      async () => {
        operationCalls += 1;
        return "reserved";
      },
      { sleep: noDelay },
    );

    expect(result).toBe("reserved");
    expect(operationCalls).toBe(2);
    expect(pool.clients.map((client) => client.commands)).toEqual([
      ["BEGIN", "COMMIT", "ROLLBACK"],
      ["BEGIN", "COMMIT"],
    ]);
  });
});
