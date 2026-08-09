# Architecture risk register

Last source verification: 2026-08-09.

This register tracks material risks that remain after the verified fixes in the
[production readiness audit](PRODUCTION_READINESS_AUDIT.md). It is intentionally
limited to risks with source evidence and a pass/fail closure condition. It is
not a substitute for the physical and institutional acceptance work in the
[test strategy](../testing/TEST_STRATEGY.md) and
[deployment checklist](UNIVERSITY_DEPLOYMENT_CHECKLIST.md).

## Status definitions

- **Open**: the repository or deployment still exposes the risk.
- **In review**: a linked pull request contains a candidate remediation, but it
  is not relied on until merged and verified.
- **External gate**: closure requires deployment, hardware, or institutional
  evidence outside this repository.
- **Closed**: the remediation and its acceptance evidence are present on the
  default branch.

## Active risks

### SEC-01: passengers can self-enrol in an unrelated ride session

- **Severity/status:** High / Closed by PR #23.
- **Evidence:** `firestore.rules` denies every client write to
  `ride_sessions/{sessionId}`. The assigned driver obtains a random,
  session-scoped boarding code through an authenticated API; the code is absent
  from passenger-readable RTDB. The join endpoint requires that code and also
  checks a fresh hardware projection plus browser proximity as defense in depth.
- **Impact:** a user can obtain session-member privileges, including access to
  session chat and ride-scoped feedback, without proof that they are near or on
  the bus.
- **Closure evidence:** emulator tests deny client manifest mutations; policy
  tests cover code normalization/comparison, route-order validation, exact live
  session binding, stale/future/uncertain fixes and location accuracy. The final
  Firestore transaction rechecks session state and code, derives identity from
  the token/profile and can update only the authenticated UID's manifest entry.
  Default-branch workflow run
  [31298772567](https://github.com/notnamansinha/Eki/actions/runs/31298772567)
  passed web, emulator and firmware acceptance on merge commit `df3c1d3`.

### SEC-02: anti-abuse and privileged writes remain client-authoritative

- **Severity/status:** High / In review.
- **Evidence:** candidate PR #53 routes chat, feedback, profile bootstrap,
  feedback review status and global settings writes through authenticated
  endpoints, while Firestore rules deny every corresponding browser write.
  Identity is server-derived; chat membership/rate state and feedback
  eligibility/cooldown state are transactionally rechecked.
- **Impact:** bypassed UI logic can weaken rate limits and validation; duplicated
  client/rules logic can drift; multi-document operations can become partially
  applied.
- **Candidate remediation:** [PR #53](https://github.com/notnamansinha/Eki/pull/53).
- **Closure evidence:** source search finds no unauthorized client write path;
  emulator tests deny every migrated write; endpoint tests cover authorization,
  validation, atomicity, exact hourly boundaries, idempotent retries, legacy
  rate data and request-ID conflicts; admin-only feedback status changes use a
  dedicated endpoint and preserve other fields.

### FW-01: synchronous HTTPS and a single telemetry retry slot can lose fixes

- **Severity/status:** High / Open.
- **Evidence:** `hardware/src/main.cpp::publishFix` executes `HTTPClient::POST`
  in the main GNSS loop. Failed delivery retains only one `bufferedFix`, and a
  newer publish candidate replaces it. The buffered fix is discarded near the
  backend's 60-second freshness limit.
- **Impact:** a connection or TLS stall can delay NMEA consumption; a longer
  Wi-Fi outage permanently loses intermediate samples and reduces ride-history
  fidelity. The current 8 KiB UART buffer and watchdog bound some failure modes
  but do not provide store-and-forward delivery.
- **Closure evidence:** move network delivery off the GNSS-consumption path;
  use a bounded, observable queue with an explicit overflow policy; preserve
  backend timestamp/freshness rules; test queue ordering, wraparound, outage,
  retry, 401, 429/`Retry-After`, 5xx, TLS, and reconnect behavior; complete a
  physical dead-zone and recovery run without UART overflow.

### FW-02: field updates and physical key protection are not production-proven

- **Severity/status:** High / External gate.
- **Evidence:** the firmware build defines `DISABLE_OTA` and uses the
  `huge_app.csv` partition layout. Secure Boot V2, flash encryption, key custody,
  signed update, rollback, and fleet rotation evidence are not repository-testable.
- **Impact:** deployed devices require physical reflashing, and a captured unit
  may expose Wi-Fi/device credentials unless hardware security is provisioned.
- **Closure evidence:** adopt an OTA-capable partition, signed images and rollback;
  prove staged update/recovery on spare devices; document signing-key custody and
  rotation; then provision and verify Secure Boot V2 and flash encryption under
  an approved irreversible eFuse procedure.

### OPS-01: runtime availability and perimeter controls are not evidenced here

- **Severity/status:** High / External gate.
- **Evidence:** the Firestore lease makes the background state worker safe for
  multiple API replicas, but the repository cannot prove the deployed replica
  count, load-balancer health behavior, WAF/global limits, alerting, backups, or
  restore procedure.
- **Impact:** a single deployed instance or missing perimeter controls can stop
  ingestion or permit abuse even when application code is correct.
- **Closure evidence:** run at least two API replicas; demonstrate health-based
  failover without duplicate lifecycle transitions; configure edge/global rate
  limits; alert on health, rejection rate, latency, stale telemetry and lease
  ownership; archive backup-and-restore and incident-drill evidence.

## Maintenance rule

Every pull request that changes an item above must update its status and attach
fresh evidence. Do not mark a risk closed merely because code exists on a branch;
closure requires the acceptance condition on the default branch.
