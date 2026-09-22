# CockroachDB Replit App

This is a working integration reference app for CockroachDB and Replit. It shows the part that belongs in a generated or imported Replit application: a small connection pool, TLS-preserving configuration, full-transaction retries, idempotent writes, migrations, an HTTP API, and tests that create real serialization conflicts.

It is not the public CockroachDB card in Replit's integration catalog. That last step needs product work between Cockroach Labs and Replit. The app is the implementation and evidence package to take into that conversation.

## What it proves

- A Replit app can use CockroachDB through the PostgreSQL wire protocol with `pg`.
- A complete application transaction is replayed after SQLSTATE `40001`, with bounded exponential backoff and full jitter.
- SQLSTATE `40003` is never blindly retried. The API returns the operation ID and a lookup URL so the caller can reconcile the outcome.
- A caller-supplied operation ID makes repeated reservation requests idempotent.
- Pool size, timeouts, retry policy, listener address, port, and application name come from validated configuration.
- Unit, live integration, and built-process E2E tests exercise the same code that runs in Replit.
- CI starts a pinned CockroachDB release and requires every test layer to pass without a Cloud credential.

## The two connections

There are two separate identities and two separate jobs:

1. **Replit Agent to CockroachDB Cloud MCP.** Agent uses `https://cockroachlabs.cloud/mcp` to inspect schemas and perform authorized development work. CockroachDB Cloud OAuth/RBAC controls that access.
2. **The deployed app to CockroachDB SQL.** Node.js uses `DATABASE_URL` through `pg` for application traffic. The URL belongs in Replit Secrets and never in source code, browser code, MCP configuration, or logs.

MCP is a development control plane, not the application's data plane.

## Run locally

Requirements: Node.js 22 or newer and a reachable CockroachDB cluster.

```bash
npm ci
export DATABASE_URL='postgresql://root@127.0.0.1:26257/defaultdb?sslmode=disable'
npm run migrate
npm run dev
```

The example URL is only for an insecure local cluster. A CockroachDB Cloud URL must retain its TLS settings, normally `sslmode=verify-full`.

Create a seat and reserve it:

```bash
curl --fail-with-body http://127.0.0.1:3000/seats \
  --header 'content-type: application/json' \
  --data '{"id":"20000000-0000-4000-8000-000000000002","label":"A-1"}'

curl --fail-with-body http://127.0.0.1:3000/reservations \
  --header 'content-type: application/json' \
  --data '{"operationId":"10000000-0000-4000-8000-000000000001","seatId":"20000000-0000-4000-8000-000000000002","userId":"30000000-0000-4000-8000-000000000003"}'
```

Sending the second request again returns the same reservation. A different operation ID for the occupied seat returns HTTP 409.

## Import into Replit

1. Put this repository on GitHub and choose **Create Repl → Import from GitHub**, or import the local repository by your normal Replit workflow.
2. Add `DATABASE_URL` in Replit Secrets. Do not put it in `.env`, `replit.md`, or chat.
3. Run `npm run migrate` once.
4. Start the app. `.replit` runs `npm run dev`; deployments build and run the compiled server.
5. Check `/health` before testing writes.

All optional settings are listed in [.env.example](.env.example). Detailed setup and MCP instructions are in [docs/setup.md](docs/setup.md).

## Test commands

| Command | Purpose |
| --- | --- |
| `npm run check:secrets` | Fails on common committed credential patterns |
| `npm run test:unit` | Configuration, retry, service, and HTTP behavior with deterministic fakes |
| `npm run test:integration` | Migrations, idempotency, conflicts, and a real CockroachDB `40001` |
| `npm run test:e2e` | Builds and starts the real server, then drives the API over HTTP |
| `npm run typecheck` | Strict TypeScript checking for source and tests |
| `npm run build` | Clean production-only compilation |

Integration and E2E tests require `DATABASE_URL`. E2E is opt-in through its npm script. GitHub Actions supplies an ephemeral local cluster; it does not need a Cloud secret.

## Why this app does not depend on an ORM

An ORM is optional. TypeORM has a native `cockroachdb` data-source type and a `maxTransactionRetries` option, but its current driver retries by recording and replaying SQL statements. It does not rerun the surrounding JavaScript callback. If application code reads a value, makes a decision, and later receives `40001`, statement replay can preserve a stale application-side decision.

This reference app uses a small callback-level executor over `pg`, so the whole unit of work is recalculated. A TypeORM version should set its internal transaction retry count to zero and place the complete `DataSource.transaction(...)` callback inside an equivalent outer retry policy. ORMs remain useful for entities, mapping, and migrations; they should not obscure the retry boundary.

## Production readiness boundary

The code path is fully testable today. A first-class catalog integration still needs agreement on OAuth client registration, secret injection, provisioning APIs, stable egress/network policy, Continuum resource mapping, catalog review, support ownership, and launch operations. Those questions are tracked in [docs/findings.md](docs/findings.md).

## Security notes

- Rotate any database password that has been pasted into chat, an issue, or a terminal recording.
- Use a dedicated least-privilege SQL user for the deployed app.
- Keep Cloud TLS verification enabled.
- Begin MCP evaluation with read-only consent; enable writes only for a defined test.
- Never perform email, payment, webhook, or other external side effects inside a retryable transaction callback.
