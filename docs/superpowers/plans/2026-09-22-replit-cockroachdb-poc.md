# Replit CockroachDB POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Replit-importable TypeScript reservation API that demonstrates correct CockroachDB transaction retries and documents use of the managed CockroachDB Cloud MCP server.

**Architecture:** An Express process owns one small `pg.Pool`. A driver-neutral transaction helper retries complete callbacks only for SQLSTATE `40001`, surfaces `40003` as ambiguous, and supports cancellation and telemetry. Reservation SQL uses a UUID operation ID for idempotency and runs only through the transaction helper.

**Tech Stack:** Node.js 22+, TypeScript 7.0.2, Express 5.2.1, node-postgres 8.23.0, Zod 4.6.5, Vitest 5.0.1, tsx 4.23.15.

**Spec:** `docs/superpowers/specs/2026-09-22-replit-cockroachdb-poc-design.md`

## Global constraints

- Do not commit credentials, certificates, cluster IDs, or customer data.
- Connect application traffic through `pg`; do not use MCP as the data plane.
- Retry only SQLSTATE `40001` by default and retry the complete transaction callback.
- Never retry SQLSTATE `40003` automatically.
- Keep external side effects outside retryable callbacks.
- Use a process-wide pool with a default maximum of five connections.
- Make live database tests optional when `DATABASE_URL` is absent.
- Keep the POC small enough to import and run directly in Replit.

---

### Task 1: Project scaffold and validated configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `.replit`
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env?: NodeJS.ProcessEnv): AppConfig`
- Produces: `AppConfig` with `databaseUrl`, `port`, `poolMax`, and `nodeEnv`

- [ ] **Step 1: Create package and compiler configuration**

Create scripts for `dev`, `build`, `start`, `test`, `test:unit`, `test:integration`, `typecheck`, and `migrate`. Pin the dependency versions listed in the plan header. Configure strict ESM TypeScript targeting Node 22.

- [ ] **Step 2: Write failing configuration tests**

Cover a missing `DATABASE_URL`, default port `3000`, default pool maximum `5`, valid integer overrides, and rejection of invalid numeric values.

```ts
expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
expect(loadConfig({ DATABASE_URL: "postgresql://example" }).poolMax).toBe(5);
expect(loadConfig({ DATABASE_URL: "postgresql://example", DB_POOL_MAX: "0" })).toThrow(/DB_POOL_MAX/);
```

- [ ] **Step 3: Run the test and confirm failure**

Run: `npm test -- tests/config.test.ts`

Expected: failure because `src/config.ts` does not exist.

- [ ] **Step 4: Implement configuration validation**

Use Zod coercion for numeric environment variables and return an immutable `AppConfig`. Do not log the database URL.

- [ ] **Step 5: Add Replit and secret-safe defaults**

`.replit` must run `npm run dev` for development and `npm run start` after `npm run build` for deployment. `.env.example` contains only non-secret examples. `.gitignore` excludes `.env`, build output, coverage, and dependencies.

- [ ] **Step 6: Verify the scaffold**

Run: `npm test -- tests/config.test.ts && npm run typecheck`

Expected: all configuration tests pass and TypeScript reports no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .env.example .replit src/config.ts tests/config.test.ts
git commit -m "chore: scaffold Replit CockroachDB POC"
```

### Task 2: Retry-safe transaction executor

**Files:**
- Create: `src/db/contracts.ts`
- Create: `src/db/errors.ts`
- Create: `src/db/retry.ts`
- Test: `tests/retry.test.ts`

**Interfaces:**
- Produces: `PoolLike.connect(): Promise<PoolClientLike>`
- Produces: `PoolClientLike.query()`, `release()`
- Produces: `RetryOptions` with `maxAttempts`, `baseDelayMs`, `maxDelayMs`, `signal`, `sleep`, `random`, and `onRetry`
- Produces: `executeTx<T>(pool, operation, options?): Promise<T>`
- Produces: `AmbiguousResultError` with `cause`

- [ ] **Step 1: Define fakeable database contracts in the test**

Use a scripted fake client that records `BEGIN`, `COMMIT`, `ROLLBACK`, and `release`. The fake must allow callback or commit errors to be queued by attempt.

- [ ] **Step 2: Write failing success and serialization tests**

Test one successful attempt and a callback that throws `{ code: "40001" }` twice before succeeding. Assert three separate `BEGIN` operations, rollback after each failure, one final commit, one final release per acquired client, and two `onRetry` events.

- [ ] **Step 3: Write failing safety tests**

Cover:

- `40003` throws `AmbiguousResultError` after one attempt.
- A constraint error such as `23505` is not retried.
- Retry exhaustion preserves the last `40001` error.
- Abortion before the first attempt acquires no connection.
- Abortion during backoff prevents the next attempt.
- A rollback failure does not replace the original callback error.
- A commit-time `40001` retries the complete callback.

- [ ] **Step 4: Run the retry tests and confirm failure**

Run: `npm test -- tests/retry.test.ts`

Expected: failure because retry implementation files do not exist.

- [ ] **Step 5: Implement minimal retry classification and errors**

```ts
export function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export function isRetryableSerialization(error: unknown): boolean {
  return sqlState(error) === "40001";
}
```

`AmbiguousResultError` must use `Error`'s `cause` option and a stable message that does not include SQL or credentials.

- [ ] **Step 6: Implement `executeTx`**

For each attempt: acquire, `BEGIN`, invoke the callback, and `COMMIT`. Roll back when the transaction has begun and callback or commit fails. Release in `finally`. For `40001`, call `onRetry`, sleep with full jitter, and rerun the complete operation. Throw `AmbiguousResultError` for `40003` before retry classification.

- [ ] **Step 7: Verify retry behavior**

Run: `npm test -- tests/retry.test.ts && npm run typecheck`

Expected: all retry tests pass without real timers or a database.

- [ ] **Step 8: Commit**

```bash
git add src/db/contracts.ts src/db/errors.ts src/db/retry.ts tests/retry.test.ts
git commit -m "feat: add CockroachDB transaction retry executor"
```

### Task 3: Pool, migration, and idempotent reservation service

**Files:**
- Create: `src/db/pool.ts`
- Create: `src/reservations/types.ts`
- Create: `src/reservations/service.ts`
- Create: `migrations/001_init.sql`
- Create: `scripts/migrate.ts`
- Test: `tests/reservations.test.ts`

**Interfaces:**
- Consumes: `executeTx<T>()`
- Produces: `createPool(config: AppConfig): Pool`
- Produces: `ReservationService.createSeat(input)`
- Produces: `ReservationService.reserve(input)`
- Produces: `ReservationService.get(operationId)`
- Produces: `SeatOccupiedError` and `ReservationNotFoundError`

- [ ] **Step 1: Write failing reservation tests using a scripted transaction client**

Cover:

- A new operation locks the seat, inserts the reservation, and marks the seat reserved.
- An existing operation ID returns the recorded reservation without updating the seat again.
- A new operation against an occupied seat throws `SeatOccupiedError`.
- A missing seat throws `ReservationNotFoundError`.
- SQL values are passed as parameters rather than interpolated.

- [ ] **Step 2: Run the service tests and confirm failure**

Run: `npm test -- tests/reservations.test.ts`

Expected: failure because the reservation service does not exist.

- [ ] **Step 3: Create the migration**

Use UUID primary keys and timestamp columns. The reservation operation ID is the reservation primary key. Add a unique partial constraint or equivalent invariant that prevents more than one active reservation per seat.

- [ ] **Step 4: Implement the pool and migration runner**

Create one `Pool` with `max: config.poolMax`, a five-second connection timeout, a thirty-second idle timeout, and `application_name=replit-cockroachdb-poc`. The migration runner reads `migrations/001_init.sql`, executes it through the pool, and always closes the pool.

- [ ] **Step 5: Implement the reservation service**

Inside `executeTx`, query by operation ID first. If present, return it. Otherwise select the seat `FOR UPDATE`, reject missing or occupied seats, insert the reservation, update the seat, and return the reservation. Keep all queries parameterized.

- [ ] **Step 6: Verify the reservation layer**

Run: `npm test -- tests/reservations.test.ts && npm run typecheck`

Expected: all service tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/db/pool.ts src/reservations migrations scripts tests/reservations.test.ts
git commit -m "feat: add idempotent reservation workflow"
```

### Task 4: HTTP API and process lifecycle

**Files:**
- Create: `src/http/app.ts`
- Create: `src/http/validation.ts`
- Create: `src/server.ts`
- Test: `tests/http.test.ts`

**Interfaces:**
- Consumes: `ReservationService`
- Produces: `createApp(dependencies): Express`
- Produces: process entry point that closes the pool on `SIGINT` and `SIGTERM`

- [ ] **Step 1: Write failing HTTP tests**

Test `GET /health`, valid and invalid seat creation, valid reservation creation, duplicate idempotent reservation behavior, occupied-seat conflict, unknown reservation, and sanitized unexpected errors. Use an injected fake service rather than a live database.

- [ ] **Step 2: Run the HTTP tests and confirm failure**

Run: `npm test -- tests/http.test.ts`

Expected: failure because the HTTP application does not exist.

- [ ] **Step 3: Implement request validation**

Use Zod schemas. Require UUID values for `operationId`, `seatId`, and `userId`. Require a non-empty seat label of at most 100 characters.

- [ ] **Step 4: Implement routes and error mapping**

Return JSON only. Map validation to 400, occupied seats to 409, missing records to 404, and unexpected errors to a generic 500 response. Do not return raw driver errors, SQL strings, or environment values.

- [ ] **Step 5: Implement process startup and shutdown**

Load configuration, create the pool and service, start on `0.0.0.0`, and close the HTTP server and database pool on termination signals.

- [ ] **Step 6: Verify the API**

Run: `npm test -- tests/http.test.ts && npm run typecheck && npm run build`

Expected: HTTP tests pass and the production build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/http src/server.ts tests/http.test.ts
git commit -m "feat: expose reservation HTTP API"
```

### Task 5: Live integration test and Replit documentation

**Files:**
- Create: `tests/integration/database.test.ts`
- Create: `README.md`
- Create: `replit.md`
- Create: `docs/setup.md`
- Create: `docs/findings.md`

**Interfaces:**
- Consumes: `DATABASE_URL`, migration runner, pool, and reservation service
- Produces: repeatable import, setup, MCP-test, and deployment instructions

- [ ] **Step 1: Write the optional live integration test**

Skip the suite when `DATABASE_URL` is absent. When present, run the migration, create a UUID seat, reserve it, repeat the same operation ID, assert the same reservation is returned, and assert a new operation ID receives an occupied-seat error.

- [ ] **Step 2: Run unit tests and confirm the live suite skips cleanly**

Run: `npm test`

Expected: unit tests pass and the live database suite is marked skipped when no URL is configured.

- [ ] **Step 3: Write README and setup instructions**

Document local and Replit import steps, required Secrets, migration command, run command, API examples, retry rules, and the separation between Agent MCP access and application SQL access.

- [ ] **Step 4: Write Replit Agent guidance**

`replit.md` must instruct Agent to reuse the existing pool, route every multi-statement write through `executeTx`, never automatically retry `40003`, preserve TLS, avoid browser-side credentials, and keep side effects outside transaction callbacks.

- [ ] **Step 5: Create the MCP findings worksheet**

Include fields for authentication method, Replit scanner result, discovered tool names, read/write behavior, `40001` behavior, `40003` behavior, headers, rate limits, egress observations, deployment result, Continuum result, and questions for the Cloud and Replit teams.

- [ ] **Step 6: Run final local verification**

Run: `npm test && npm run typecheck && npm run build`

Expected: every local test passes, the optional live suite skips without credentials, and the build succeeds.

- [ ] **Step 7: Run live verification when a test URL is supplied**

Run: `npm run migrate && npm run test:integration`

Expected: migration succeeds and the live reservation workflow passes.

- [ ] **Step 8: Inspect secret hygiene**

Run: `git status --short && git grep -nE 'postgres(ql)?://[^ ]+:[^ ]+@|BEGIN (RSA|OPENSSH|PRIVATE) KEY|Bearer [A-Za-z0-9_-]{16,}' -- . ':!package-lock.json'`

Expected: only intended source files are uncommitted and the secret scan returns no matches.

- [ ] **Step 9: Commit**

```bash
git add README.md replit.md docs/setup.md docs/findings.md tests/integration/database.test.ts
git commit -m "docs: add Replit setup and POC verification"
```

### Task 6: Final review and handoff

**Files:**
- Modify only files that fail review.

**Interfaces:**
- Consumes: the complete repository
- Produces: a clean commit history and verified importable POC

- [ ] **Step 1: Review the implementation against the design**

Check every success criterion in `docs/superpowers/specs/2026-09-22-replit-cockroachdb-poc-design.md` and record any unavailable live checks in `docs/findings.md`.

- [ ] **Step 2: Run the complete verification command**

Run: `npm test && npm run typecheck && npm run build && git status --short`

Expected: tests, type checking, and build pass; the working tree is clean after documentation updates are committed.

- [ ] **Step 3: Record the handoff commands**

The handoff must state how to import the repository into Replit, where to add `DATABASE_URL`, how to add `https://cockroachlabs.cloud/mcp`, and which live MCP and deployment tests still require user credentials.
