# Setup and verification

## 1. Choose a test database

Use a local or disposable CockroachDB database first. The migration creates `seats` and `reservations` in the selected database.

For a local insecure node:

```bash
export DATABASE_URL='postgresql://root@127.0.0.1:26257/defaultdb?sslmode=disable'
```

For CockroachDB Cloud, copy a fresh connection string from the Cloud Console into the environment or Replit Secrets. Do not write it to a file. Keep `sslmode=verify-full` intact. Use a dedicated SQL user with only the database privileges the app needs.

CockroachDB Cloud and CockroachDB Continuum use the same application-side PostgreSQL protocol and retry behavior. Differences should be isolated to provisioning, identity, resource discovery, and network setup rather than this runtime layer.

## 2. Install, migrate, and verify

```bash
npm ci
npm run check:secrets
npm run migrate
npm run test:unit
npm run test:integration
npm run test:e2e
npm run typecheck
```

The integration suite creates unique rows, proves idempotent replay, verifies occupied-seat behavior, and creates two concurrent serializable transactions so CockroachDB returns a real retry error. The E2E suite builds the app, selects an available local port, starts the compiled process, and drives the HTTP lifecycle.

## 3. Configure the app

Only `DATABASE_URL` is required. Every operational value has a validated default and can be overridden:

| Variable | Default | Meaning |
| --- | ---: | --- |
| `PORT` | `3000` | HTTP listener port |
| `HOST` | `0.0.0.0` | HTTP listener address |
| `DB_POOL_MAX` | `5` | Maximum SQL connections per process |
| `APPLICATION_NAME` | `cockroachdb-replit-app` | Name shown in SQL sessions and telemetry |
| `DB_CONNECTION_TIMEOUT_MS` | `5000` | Pool connection timeout |
| `DB_IDLE_TIMEOUT_MS` | `30000` | Pool idle timeout |
| `TX_MAX_ATTEMPTS` | `5` | Total transaction attempts, including the first |
| `TX_BASE_DELAY_MS` | `20` | First full-jitter ceiling |
| `TX_MAX_DELAY_MS` | `1000` | Maximum jitter ceiling |
| `NODE_ENV` | `development` | Runtime mode |

Do not raise the pool size simply because CockroachDB is distributed. Replit can create more than one application process, and the total connection count is the per-process pool size multiplied by the process count.

## 4. Import into Replit

1. Import the GitHub repository as a new Replit app.
2. Open **Secrets** and create `DATABASE_URL`.
3. Run `npm run migrate` in the Replit shell.
4. Press Run. The development command comes from `.replit`.
5. Confirm that `/health` returns `{"status":"ok"}`.
6. Exercise `POST /seats`, `POST /reservations`, and `GET /reservations/:operationId`.
7. Create a deployment and repeat the health and reservation checks against its public URL.

If Cloud rejects the connection, check the cluster network policy and Replit's effective egress address. Do not solve a networking problem by weakening TLS.

## 5. Connect Replit Agent to CockroachDB Cloud MCP

The MCP connection is separate from `DATABASE_URL`:

1. In CockroachDB Cloud, open the target cluster's **Connect** dialog, select the MCP option, and review the generated configuration.
2. In Replit, open **Integrations → MCP servers → Add MCP server**.
3. Set a clear display name such as `CockroachDB Cloud`.
4. Enter `https://cockroachlabs.cloud/mcp` and choose **Test & Save**.
5. Complete the OAuth flow. Start with read-only consent and the narrowest Cloud role that works.
6. Ask Agent to list the server's tools, then perform a read-only schema lookup.
7. Record the observed authentication, scanner, tools, and permissions in `docs/findings.md` before enabling writes.

Replit documents that custom MCP traffic passes through its security scanner and that OAuth DCR or custom headers may be used. CockroachDB's managed MCP supports OAuth for interactive use and service-account keys for autonomous use. The hands-on test determines whether the two current implementations interoperate without a pre-registered OAuth client.

References:

- [Replit MCP server overview](https://docs.replit.com/references/mcp/overview)
- [CockroachDB managed MCP architecture and authentication](https://www.cockroachlabs.com/blog/cockroachdb-ai-agents-managed-mcp-server/)
- [CockroachDB transaction guidance](https://www.cockroachlabs.com/docs/stable/transactions.html)

## 6. Cloud test

After local verification, create a fresh least-privilege Cloud credential and place it in `DATABASE_URL` for the current shell or Replit Secret. Run migration, integration, and E2E tests again. Remove or rotate the credential after the evaluation.

The CI workflow deliberately uses a local CockroachDB container. Cloud CI credentials are unnecessary for pull requests and would create avoidable secret and cost risk.
