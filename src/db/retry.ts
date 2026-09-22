import type { PoolClientLike, PoolLike } from "./contracts.js";
import { abortError, AmbiguousResultError, sqlState } from "./errors.js";

export interface RetryEvent {
  attempt: number;
  delayMs: number;
  code: "40001";
}

export interface ExecuteTxOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  onRetry?: (event: RetryEvent) => void;
}

const defaultSleep = (delayMs: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

async function rollback(client: PoolClientLike): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the transaction error; a failed rollback is not actionable to the caller.
  }
}

export async function executeTx<Result>(
  pool: PoolLike,
  operation: (client: PoolClientLike) => Promise<Result>,
  options: ExecuteTxOptions = {},
): Promise<Result> {
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 20;
  const maxDelayMs = options.maxDelayMs ?? 1_000;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;

  requirePositiveInteger(maxAttempts, "maxAttempts");
  requirePositiveInteger(baseDelayMs, "baseDelayMs");
  requirePositiveInteger(maxDelayMs, "maxDelayMs");
  throwIfAborted(options.signal);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(options.signal);
    const client = await pool.connect();
    let began = false;

    try {
      await client.query("BEGIN");
      began = true;
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (began) {
        await rollback(client);
      }

      const code = sqlState(error);
      if (code === "40003") {
        throw new AmbiguousResultError(error);
      }

      if (code !== "40001" || attempt === maxAttempts) {
        throw error;
      }

      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delayMs = Math.floor(ceiling * random());
      options.onRetry?.({ attempt, delayMs, code });
      await sleep(delayMs, options.signal);
      throwIfAborted(options.signal);
    } finally {
      client.release();
    }
  }

  throw new Error("Transaction retry loop exited unexpectedly");
}
