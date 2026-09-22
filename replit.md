# Guidance for Replit Agent

This repository is the CockroachDB Replit integration reference app.

## Database rules

- Read `DATABASE_URL` only from Replit Secrets. Never print it, return it in an error, place it in browser code, or commit it.
- Preserve the URL's TLS settings. Never replace `sslmode=verify-full` with a weaker mode for CockroachDB Cloud.
- Reuse the process-wide pool created by `src/db/pool.ts`. Do not create a pool per request.
- Keep pool and retry settings configurable through `src/config.ts`.
- Use parameterized SQL for every value.
- Run schema changes through versioned files in `migrations/`.

## Transaction rules

- Put every multi-statement atomic write inside `executeTx` from `src/db/retry.ts`.
- The callback must contain the complete read/decide/write unit because a `40001` reruns it from the beginning.
- Do not add email, HTTP calls, payments, queues, file writes, or other external side effects inside the callback.
- Retry SQLSTATE `40001` only. Do not broaden retry classification without a specific idempotency and ambiguous-commit design.
- Never automatically retry SQLSTATE `40003`. Return an operation ID and reconcile it through a read.
- Keep caller-supplied operation IDs unique and persist them in the same transaction as the write.

## MCP rules

- Treat the CockroachDB Cloud MCP connection as Agent tooling, not as the application's database driver.
- Start with read-only MCP consent and least-privilege Cloud RBAC.
- Ask before using a write-enabled MCP tool or making a destructive schema change.
- Do not copy MCP tokens or service-account keys into repository files or application environment variables.

## Required checks

After a change, run the smallest relevant test first. Before handing off, run:

```bash
npm run check:secrets
npm run test:unit
npm run typecheck
npm run build
```

When `DATABASE_URL` points to a disposable test database, also run:

```bash
npm run migrate
npm run test:integration
npm run test:e2e
```
