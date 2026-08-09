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

- **Severity/status:** High / In review.
- **Evidence:** `firestore.rules` currently permits an authenticated passenger
  to add their own entry to `ride_sessions/{sessionId}.passengers`. Authenticated
  users can read active bus data containing session identifiers, so knowing a
  session ID is sufficient to attempt enrolment.
- **Impact:** a user can obtain session-member privileges, including access to
  session chat and ride-scoped feedback, without proof that they are near or on
  the bus.
- **Candidate remediation:** [PR #23](https://github.com/notnamansinha/Eki/pull/23)
  moves enrolment behind a server endpoint that checks the hardware GNSS fix.
- **Closure evidence:** clients cannot create, update, or delete passenger
  manifests in emulator tests; the endpoint rejects unauthenticated, stale,
  non-boarding, missing-GNSS, and out-of-radius requests; an eligible nearby
  passenger can join; stop updates cannot be used to replace another passenger.

### SEC-02: anti-abuse and privileged writes remain client-authoritative

- **Severity/status:** High / In review.
- **Evidence:** the frontend still performs Firestore transactions or writes for
  session messages, message-rate documents, feedback, feedback cooldowns, user
  bootstrap, passenger manifests, and global settings. Firestore rules constrain
  several shapes, but client-side filters, clocks, and multi-document sequencing
  are not a trusted enforcement boundary.
- **Impact:** bypassed UI logic can weaken rate limits and validation; duplicated
  client/rules logic can drift; multi-document operations can become partially
  applied.
- **Candidate remediation:** [PR #53](https://github.com/notnamansinha/Eki/pull/53)
  moves the remaining writes behind authenticated Express endpoints and denies
  corresponding client writes.
- **Closure evidence:** source search finds no unauthorized client write path;
  emulator tests deny every migrated write; endpoint tests cover authorization,
  validation, atomicity, throttling, retries, and legacy data; admin-only feedback
  status changes remain possible without changing other fields.

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
