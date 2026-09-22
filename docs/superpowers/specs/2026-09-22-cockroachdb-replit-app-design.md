# CockroachDB Replit App design

## Purpose

Build a TypeScript integration reference app that can be imported into Replit and used to prove the application-runtime half of a CockroachDB integration. The app must also document how to connect Replit Agent to the existing managed MCP endpoint at `https://cockroachlabs.cloud/mcp` without storing MCP or SQL credentials in Git.

## Success criteria

The reference app is successful when:

1. A developer can import the repository into Replit, add `DATABASE_URL` through Replit Secrets, and run the application.
2. The application uses the normal PostgreSQL wire protocol through `pg`.
3. Multi-statement transactions retry the complete callback on SQLSTATE `40001` with bounded exponential backoff and full jitter.
4. SQLSTATE `40003` is surfaced as an ambiguous-result error and is never retried automatically.
5. Connection errors are not blindly replayed after a possibly committed write.
6. The sample reservation endpoint uses an idempotency key and demonstrates a contention-sensitive write transaction.
7. Unit tests validate retry, exhaustion, cancellation, rollback, and ambiguous-result behavior without requiring a live database.
8. Optional integration tests can run against any CockroachDB cluster supplied through `DATABASE_URL`.
9. Documentation separates the Replit Agent MCP identity from the deployed application's SQL identity.
10. No secrets, certificates, cluster identifiers, or customer data are committed.

## Scope

### Included

- A minimal HTTP API written in TypeScript.
- A reusable retrying transaction helper over `pg`.
- A reservation schema and migration.
- Health, seat creation, reservation creation, and reservation lookup endpoints.
- Idempotent reservation requests keyed by a caller-supplied UUID.
- Unit and optional live integration tests.
- Replit run configuration and Agent guidance in `replit.md`.
- Setup instructions for CockroachDB SQL and Replit custom MCP configuration.
- A findings document for recording MCP tool discovery, authentication, scanner, networking, and deployment results.

### Excluded

- Modifying `cockroachlabs.cloud/mcp`.
- OAuth DCR or Replit partner-listing work.
- Automatic CockroachDB provisioning.
- Automatic Replit secret injection.
- Private networking or fixed-egress implementation.
- A production-ready retry package published to npm.
- Python, Java, or Go runtime helpers.

## Architecture

The application has four runtime units:

1. `config.ts` validates environment configuration.
2. `db.ts` creates one bounded `pg.Pool` for each application process.
3. `retry.ts` owns retry classification, backoff, transaction lifecycle, and retry telemetry hooks.
4. `reservations.ts` implements idempotent reservation behavior without knowing how retries are scheduled.

`app.ts` builds the HTTP server, and `server.ts` is the process entry point. SQL lives in a versioned migration rather than application startup code.

## Retry contract

The public helper is:

```ts
executeTx<T>(pool: PoolLike, operation: (client: PoolClientLike) => Promise<T>, options?: RetryOptions): Promise<T>
```

Behavior:

- Begin a new transaction for each attempt.
- Commit only after the callback completes.
- Roll back after callback or commit failure when possible.
- Retry only SQLSTATE `40001` by default.
- Throw `AmbiguousResultError` for SQLSTATE `40003`.
- Preserve the original non-retryable error.
- Use a maximum of five attempts by default.
- Use exponential delay capped at 1,000 ms with full jitter.
- Accept an `AbortSignal` and stop before beginning another attempt when aborted.
- Expose an optional `onRetry` callback for structured telemetry.
- Never execute external side effects on behalf of the caller.

## Reservation model

The database contains `seats` and `reservations`.

- A seat has a UUID primary key, a human-readable label, and a nullable reservation owner.
- A reservation uses the request's UUID idempotency key as its primary key.
- The transaction first checks whether the idempotency key already exists.
- It locks the requested seat, verifies availability, records the reservation, and updates the seat.
- A repeated request with the same idempotency key returns the original reservation.
- A request using a new key for an occupied seat returns a conflict.

## HTTP behavior

- `GET /health` checks process health and database connectivity.
- `POST /seats` creates a seat from a UUID and label.
- `POST /reservations` requires `operationId`, `seatId`, and `userId` UUID values.
- `GET /reservations/:operationId` returns the recorded reservation.
- Validation errors return 400, occupied seats return 409, unknown reservations return 404, and unexpected errors return 500 without exposing credentials or SQL text.

## Replit behavior

The repository includes `.replit` with deterministic install and run commands. Replit users supply `DATABASE_URL` through Secrets. The repository does not contain MCP configuration because MCP connections are account/workspace state rather than application source.

`replit.md` instructs Agent to preserve TLS, use the retry helper for multi-statement writes, keep external side effects outside transaction callbacks, avoid automatic `40003` retries, and keep pool sizes small.

## Verification

Unit tests use fake pool and client objects to force transaction outcomes deterministically. Integration tests create isolated UUID data and skip when `DATABASE_URL` is absent. Verification includes TypeScript compilation, linting, unit tests, and, when credentials are available, migration plus integration tests.

## Deferred decisions for the Cloud and Replit teams

- OAuth DCR versus a pre-registered Replit OAuth client.
- Managed MCP tool retry and idempotency behavior.
- Continuum resource identifiers and tool coverage.
- Application SQL credential creation, rotation, and revocation APIs.
- Replit project-secret injection.
- Stable Replit egress and CockroachDB network authorization.
- Public catalog review, support ownership, and launch process.
