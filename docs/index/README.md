# Eki documentation index

Last updated: 2026-10-06 15:32 IST (UTC+05:30).

## New to the project

1. Read [getting started](../GETTING_STARTED.md) for setup, roles and workflows.
2. Fill environment files using [configuration](../CONFIGURATION.md).
3. Read the [architecture summary](../design/ARCHITECTURE.md).
4. Open the frontend/backend/hardware guide for the component you are changing.
5. Use [test strategy](../testing/TEST_STRATEGY.md) and [contributing](../../CONTRIBUTING.md)
   before opening a PR against the intended branch.

The guides describe current `testing` software. Evidence pages retain actual
run revisions, dates and measurements. Verify deployed availability separately.

## Current technical references

| Document | Covers |
|---|---|
| [HTTP contract and compatibility checks](../api/HTTP_CONTRACT.md) | OpenAPI validation and compatibility |
| [Operation resources (#194)](../api/OPERATION_RESOURCES.md) | Bounded execution, progress, paginated discovery and audited operator recovery |
| [Ride-session migration (#193)](../api/RIDE_SESSION_CONTRACT.md) | Versioned ride-session lifecycle and idempotency |
| [Firebase Firestore and RTDB data model](../data/FIREBASE_DATA_MODEL.md) | Firestore/RTDB fields, access and relationships |
| [Storage architecture summary](../data/STORAGE_ARCHITECTURE.md) | Storage responsibilities and retention overview |
| [Architecture and lifecycle summary](../design/ARCHITECTURE.md) | Architecture and ride lifecycle summary |
| [High-level design (HLD)](../design/HIGH_LEVEL_DESIGN.md) | System boundaries and design decisions |
| [Low-level design (LLD)](../design/LOW_LEVEL_DESIGN.md) | Source modules and runtime behavior |
| [Realtime transport decision (#195)](../design/REALTIME_TRANSPORT_DECISION.md) | Firebase transport decision and measurement gates |
| [RTDB region latency decision](../design/RTDB_REGION_LATENCY_DECISION.md) | Recorded region comparison and cutover gate |
| [Telemetry state partition decision](../design/TELEMETRY_STATE_PARTITION_DECISION.md) | State partition decision and measurement gate |
| [Cold power-loss recovery](../hardware/COLD_POWER_RECOVERY.md) | Flash checkpoint limits and legacy-board procedure |
| [Hardware telemetry, latency and failure design](../hardware/HARDWARE_TELEMETRY.md) | Capture, queue, timing and failure handling |
| [Telemetry HTTPS response reuse](../hardware/HTTPS_RESPONSE_REUSE.md) | Safe telemetry connection reuse |

## Operations

| Document | Covers |
|---|---|
| [Versioned telemetry route catalog](../operations/ROUTE_CATALOG.md) | Shared watcher data, freshness and edit/deletion fencing |
| [RTDB browser reconnect recovery](../operations/RTDB_RECONNECT_RECOVERY.md) | Suspension/disconnection gates, debounce, jitter and snapshot readiness |
| [Privacy deletion queue and recovery](../operations/PRIVACY_DELETION.md) | Fair bounded cleanup, backoff, resubmission and stopped-executor recovery |
| [Architecture risk register](../operations/ARCHITECTURE_RISK_REGISTER.md) | Risk status and closure evidence |
| [CI, deployment, and release guide](../operations/CI_CD_AND_RELEASES.md) | CI checks, branch deployment gates and rollback |
| [Eki Web App DNS & Domain Setup Guide](../operations/DNS_AND_DOMAINS.md) | Hosting/Auth domains, DNS and certificates |
| [ESP32 fleet security and provisioning](../operations/HARDWARE_SECURITY_PROVISIONING.md) | Witnessed signing, first boot and fleet security |
| [My live bus demo runbook](../operations/LIVE_DEMO_RUNBOOK.md) | Demo preparation and recovery checklist |
| [Local web, phone and ESP32 testing](../operations/LOCAL_TESTING.md) | Laptop, phone and ESP32 test handoff/cleanup |
| [Stable ngrok tunnel for ESP32 bench testing](../operations/NGROK_TUNNEL.md) | Stable backend tunnel and TLS trust |
| [Production readiness audit](../operations/PRODUCTION_READINESS_AUDIT.md) | Historical audit; current gates are linked at the top |
| [Realtime transport measurement runbook](../operations/REALTIME_TRANSPORT_MEASUREMENTS.md) | Watch, payload, reconnect and chat measurement |
| [RTDB legacy and geometry retention](../operations/RTDB_RETENTION.md) | Dry-run inventory, legacy retirement and geometry cleanup |
| [Telemetry ingestion load test](../operations/TELEMETRY_INGESTION_LOAD_TEST.md) | Staging load and limiter contention procedure |
| [Telemetry latency baseline](../operations/TELEMETRY_LATENCY_BASELINE.md) | GNSS-to-marker measurement procedure |
| [University handover checklist](../operations/UNIVERSITY_DEPLOYMENT_CHECKLIST.md) | Release ownership and production acceptance |

## Testing and evidence

The [current A–Z execution ledger](../testing/WEBAPP_A_Z_AB_TESTING.md) records
actual browser outcomes, R01–R15 software scope and all 351 pending/partial
feature cases. The [full plan](../testing/WEBAPP_A_Z_AB_TESTING_PLAN.md) retains
the supplied historical control/API/race inventories with current overrides.

Start with [the testing index](../testing/README.md). It catalogs every dated
report, distinguishes stationary/synthetic/physical evidence, and points to
the remaining acceptance gates. [Test strategy](../testing/TEST_STRATEGY.md)
owns current commands; historical test counts apply only to their recorded run.

## Package and repository entry points

| Area | Documents |
|---|---|
| Repository | [Overview](../../README.md), [contributing](../../CONTRIBUTING.md), [security](../../SECURITY.md), [code of conduct](../../CODE_OF_CONDUCT.md) |
| Backend | [Setup](../../backend/README.md), [API](../../backend/API.md), [resource migration](../../backend/API_RESOURCE_MIGRATION.md), [OpenAPI JSON](../../backend/openapi.json) |
| Frontend | [Setup and runtime behavior](../../frontend/README.md) |
| Hardware | [Setup](../../hardware/README.md), [headers](../../hardware/include/README), [native tests](../../hardware/test/README), [key custody](../../hardware/keys/README.md) |
| Browser fixtures | [Admin access](../../e2e/admin-access/README.md), [passenger/responsive](../../e2e/fixtures/README.md), [motion](../../e2e/motion/README.md) |
| Lint adapter | [Purpose and upgrade checks](../../tools/next-lint-glob/README.md) |
| GitHub templates | [PR](../../.github/PULL_REQUEST_TEMPLATE.md), [bug report](../../.github/ISSUE_TEMPLATE/bug_report.md), [feature request](../../.github/ISSUE_TEMPLATE/feature_request.md) |

## Which copy to edit

- Documents authored inside `docs/` are maintained there.
- Every tracked Markdown/README outside `docs/` has a required mirror inside
  `docs/`. Edit the original, then run `npm run docs:sync`; the mirror test
  checks content and adjusted relative links.
- Completed UI implementation plans/debug notes have been consolidated into
  onboarding, frontend, API and local-testing guides. Distinct dated evidence
  and architectural decisions remain available.
- Update the top date/time when editing. Keep original evidence timestamps,
  commit references and measurements intact. See [contributing](../../CONTRIBUTING.md).

- [Bounded reconciliation and continuation](../operations/RECONCILIATION.md): durable page cursors, all-record fleet/device guards, bounded Auth/session work and stranded mutation recovery.

- [Read-only passenger geometry and bounded admin repair](../operations/ROUTE_GEOMETRY_READS.md) — cache, independent quotas and explicit versioned repair.
