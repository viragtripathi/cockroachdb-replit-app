# Integration findings and partner worksheet

This file separates verified behavior from work that needs Cockroach Cloud or Replit involvement. Add dates, screenshots, request IDs, and owner names as the live evaluation progresses. Never paste credentials or full connection strings here.

## Verified in the reference app

| Area | Result | Evidence |
| --- | --- | --- |
| PostgreSQL wire connection | Pass | `pg` pool and local v26.2.6 live tests |
| Schema migration | Pass | `migrations/001_init.sql` and integration test |
| Idempotent operation ID | Pass | Unit, integration, and E2E tests |
| Real serialization conflict | Pass | Concurrent live integration test causes callback replay |
| `40003` handling | Pass at unit/API layer | Never retried; sanitized reconciliation response |
| Configuration | Pass | All deployment-specific values are environment-backed and validated |
| Built process | Pass | E2E starts `dist/src/server.js` and drives HTTP |
| Secret hygiene | Pass locally | Automated pattern check and ignored environment files |
| Cloud SQL | Pending | Run the same migration/integration/E2E commands with a rotated test credential |
| Replit deployment | Pending | Import, Secret, migration, Run, deployment smoke test |

## Managed MCP live test

| Question | Observation | Status/owner |
| --- | --- | --- |
| Endpoint used | `https://cockroachlabs.cloud/mcp` | Known |
| Replit connection date and account tier |  | Pending |
| OAuth DCR completed without a registered client |  | Pending: Cockroach Cloud + Replit |
| OAuth scopes requested (`mcp:read`, `mcp:write`) |  | Pending |
| Cloud RBAC role used |  | Pending |
| Replit security scanner result |  | Pending: Replit |
| Tools returned by `tools/list` |  | Pending |
| Read-only schema query |  | Pending |
| Write consent and write tool behavior |  | Pending; test only in disposable database |
| Destructive operations blocked |  | Pending |
| Tool-level `40001` behavior |  | Pending: Cockroach Cloud |
| Tool-level `40003` behavior and reconciliation contract |  | Pending: Cockroach Cloud |
| Rate-limit headers and documented quotas |  | Pending: Cockroach Cloud |
| Audit/log records and identity attribution |  | Pending: Cockroach Cloud |
| Token expiry and refresh behavior |  | Pending: Cockroach Cloud + Replit |
| Reconnect/revocation behavior |  | Pending |

## Replit deployment test

| Question | Observation | Status/owner |
| --- | --- | --- |
| GitHub import succeeds |  | Pending |
| `DATABASE_URL` Secret is server-only |  | Pending |
| Migration succeeds from workspace |  | Pending |
| Development Run health check |  | Pending |
| Deployment health check |  | Pending |
| Cloud network allowlist accepts Replit traffic |  | Pending: Replit + Cockroach Cloud |
| Stable/fixed egress is available |  | Pending: Replit |
| Connection count under scale-out |  | Pending |
| Logs omit URLs, passwords, SQL, and tokens |  | Pending |

## CockroachDB Cloud and Continuum

The SQL driver, schema, transaction executor, idempotency contract, tests, and application API should remain identical. Confirm the following before claiming one catalog card supports both products:

| Question | Cloud | Continuum | Owner |
| --- | --- | --- | --- |
| Resource identifier format |  |  | Cockroach Cloud |
| Cluster/database discovery API |  |  | Cockroach Cloud |
| SQL credential creation and rotation API |  |  | Cockroach Cloud |
| Network authorization workflow |  |  | Cockroach Cloud |
| Managed MCP endpoint and tool parity |  |  | Cockroach Cloud |
| OAuth/RBAC scope parity |  |  | Cockroach Cloud |
| Provisioning lifecycle and billing handoff |  |  | Cockroach Cloud + Replit |

## Work that needs the Cockroach Cloud team

- Confirm Replit compatibility for OAuth discovery, PKCE, DCR, refresh, and revocation.
- Define whether the catalog connector provisions resources or only connects existing ones.
- Supply stable APIs for resource selection, credential lifecycle, and network policy.
- Document managed MCP retry, idempotency, ambiguous-result, rate-limit, and audit contracts.
- Confirm Continuum naming, identifiers, capabilities, and MCP parity.
- Review generated application guidance and own the CockroachDB-specific support path.

## Work that needs Replit

- Approve the public catalog listing, branding, security review, and support escalation path.
- Decide between DCR and a pre-registered Replit OAuth client.
- Provide a supported way to inject a newly issued SQL credential into a project Secret without exposing it to Agent chat or source.
- Define fixed egress or another least-privilege Cloud networking pattern.
- Confirm connector install links, analytics, versioning, deprecation, and launch requirements.

## Launch gate

Do not call the public integration complete until the MCP and deployment tables are filled in, the Cloud credential has been rotated, both teams have owners for every open item, and the reference app passes unchanged against local CockroachDB and the intended managed product.
