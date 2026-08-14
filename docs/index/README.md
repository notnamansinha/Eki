# Eki documentation map

Repository-wide documentation refresh: 2026-08-14. Technical contracts below
are maintained against the current source, rules, workflows, and configuration
templates. Historical decision records remain immutable except for links to
the current source of truth.

Start with [Getting started and operating guide](../GETTING_STARTED.md) if you
are new to the project. It explains the roles, local setup, ride lifecycle,
common workflows, verification commands, troubleshooting, and the public-safe
documentation boundary.

Read these technical references in order when onboarding:

1. [High-level design](../design/HIGH_LEVEL_DESIGN.md) — system boundaries, decisions, trust and end-to-end flows.
2. [Environment and configuration](../CONFIGURATION.md) — all supported variables, environment separation, and secret handling.
3. [Low-level design](../design/LOW_LEVEL_DESIGN.md) — backend/frontend/firmware internals and module catalog.
4. [Firebase data model](../data/FIREBASE_DATA_MODEL.md) — every Firestore collection, RTDB path, field and relationship.
5. [Hardware telemetry](../hardware/HARDWARE_TELEMETRY.md) — wiring, firmware state machine, timing, latency and failure handling.
6. [Backend overview](../backend/README.md) — local setup, configuration, verification and device provisioning.
7. [Backend API](../backend/API.md) — endpoints, authentication, bodies, responses and status codes.
8. [Test strategy](../testing/TEST_STRATEGY.md) — automated suites, simulations and physical acceptance matrix.
9. [Production readiness audit](../operations/PRODUCTION_READINESS_AUDIT.md) — verified outcome, fixes and residual risks.
10. [Architecture risk register](../operations/ARCHITECTURE_RISK_REGISTER.md) — active source, firmware and deployment risks with closure criteria.

Operational documents:

- [Live demo runbook](../operations/LIVE_DEMO_RUNBOOK.md)
- [University deployment checklist](../operations/UNIVERSITY_DEPLOYMENT_CHECKLIST.md)
- [CI, deployment, and release guide](../operations/CI_CD_AND_RELEASES.md)
- [Storage architecture summary](../data/STORAGE_ARCHITECTURE.md)
- [Security policy](../repository/SECURITY.md)

Mirrored package and repository documents:

- Repository: [overview](../repository/README.md), [contributing](../repository/CONTRIBUTING.md), [code of conduct](../repository/CODE_OF_CONDUCT.md), [security](../repository/SECURITY.md)
- Backend: [overview](../backend/README.md), [API](../backend/API.md)
- Frontend: [overview](../frontend/README.md)
- Hardware: [overview](../hardware/README.md), [include guidance](../hardware/include/README), [library guidance](../hardware/lib/README), [test guidance](../hardware/test/README)
- GitHub workflow templates: [pull request](../github/PULL_REQUEST_TEMPLATE.md), [bug report](../github/ISSUE_TEMPLATE/bug_report.md), [feature request](../github/ISSUE_TEMPLATE/feature_request.md)

Historical implementation records (kept for decision traceability):

- [Ride-history clarity change](../history/admin-ride-history-clarity.md)
- [In-app ride-history confirmation change](../history/admin-ride-history-in-app-confirmation.md)

`design/ARCHITECTURE.md` is the short operational architecture reference; the HLD and LLD are authoritative when more detail is needed.

Every project-owned Markdown/README document outside `docs/` has a matching copy in the appropriate subfolder here. `backend/src/docsMirror.test.ts` discovers tracked documentation repository-wide and fails if a mirror is missing or stale; expected relative links are adjusted for the mirrored location.

Documents under `docs/` are maintained directly. Before publishing a new
document, review it for credentials, private infrastructure details, personal
data, and unredacted operational logs.
