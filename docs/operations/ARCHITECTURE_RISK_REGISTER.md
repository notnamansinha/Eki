# Architecture risk register

Last source verification: 2026-08-14.

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

- **Severity/status:** High / Closed by PR #53.
- **Evidence:** PR #53 routes chat, feedback, profile bootstrap,
  feedback review status and global settings writes through authenticated
  endpoints, while Firestore rules deny every corresponding browser write.
  Identity is server-derived; chat membership/rate state and feedback
  eligibility/cooldown state are transactionally rechecked.
- **Impact:** bypassed UI logic can weaken rate limits and validation; duplicated
  client/rules logic can drift; multi-document operations can become partially
  applied.
- **Remediation:** [PR #53](https://github.com/notnamansinha/Eki/pull/53).
- **Closure evidence:** source search finds no unauthorized client write path;
  emulator tests deny every migrated write; endpoint tests cover authorization,
  validation, atomicity, exact hourly boundaries, idempotent retries, legacy
  rate data and request-ID conflicts; admin-only feedback status changes use a
  dedicated endpoint and preserve other fields. Default-branch workflow run
  [31300104926](https://github.com/notnamansinha/Eki/actions/runs/31300104926)
  passed web, emulator and firmware acceptance on PR #53 merge commit `cc147ba`;
  integrated workflow run
  [31301262140](https://github.com/notnamansinha/Eki/actions/runs/31301262140)
  passed again after the firmware HTTP follow-up on merge commit `163e687`.

### FW-01: asynchronous store-and-forward requires physical recovery evidence

- **Severity/status:** High / External gate (code mitigation complete; field validation pending).
- **Evidence:** `hardware/src/main.cpp::publisherTask` owns Wi-Fi, NTP, TLS and
  `HTTPClient::POST` on core 0 while the Arduino loop on core 1 continuously
  drains GNSS UART. A 120-sample, 5,808-byte RTC no-init ring uses newest-first
  recovery, oldest-drop overflow, a device/backend identity tag and a 55-second
  freshness safety margin. Thirty-second health output exposes ring high-water,
  overflow/stale drops, TinyGPSPlus checksum failures and HardwareSerial
  buffer/FIFO overflow events.
- **Impact:** bounded store-and-forward now covers at least six minutes at the
  maximum one-second moving capture rate and survives software/watchdog resets. The
  backend's 60-second timestamp contract intentionally prevents stale replay;
  older entries are counted and removed rather than submitted as current data.
- **Repository evidence:** the native suite covers newest-first ordering,
  in-flight retry retention, arbitrary acknowledgement, wraparound,
  oldest-drop overflow, stale compaction and RTC configuration identity. HTTP
  policy tests cover transport errors, latched 401/403, 429/`Retry-After` and
  5xx. Separate pure policies cover strict GNSS UTC calendar conversion,
  bounded clock discipline, Wi-Fi exponential retry and a three-pulse
  credential-fault LED code. Wi-Fi, device identity/secret, backend origin, and
  CA are compiled into a device-specific image and validated before networking;
  no local configuration service or NVS/Preferences-backed configuration and
  recovery store exists. The RTC no-init telemetry queue remains the bounded
  store-and-forward mechanism. The authenticated diagnostics channel reports
  bounded health and hardware-security state every five minutes. Both
  development and signed fleet targets compile within their regular RAM, RTC,
  and flash limits.
- **Remaining closure evidence:** complete a physical dead-zone/backend-outage
  and recovery run on the target board, confirming zero UART/FIFO overflow and
  acceptable queue high-water/reset recovery under real GNSS and TLS load.
  Also prove GNSS-established TLS with NTP blocked, NTP cross-check behavior,
  the credential-fault LED/radio shutdown and device-specific signed reflash on
  a real device. Confirm authenticated diagnostics and full credential rotation.

### FW-02: field updates and physical key protection need physical proof

- **Severity/status:** High / Partially mitigated; physical/update gate remains.
- **Evidence:** `esp32dev-secure` requires an ignored RSA-3072 key, builds signed
  Secure Boot V2 firmware with release-mode flash encryption and a
  bootloader-safe partition table, and halts at runtime unless both protections
  are active. The repository includes a two-operator spare-board procedure and
  remote security-state evidence. The secure profile now adds dual signed OTA
  slots, authenticated active-ride gating, exact size/SHA-256 verification,
  strictly increasing release sequences and backend-health rollback. Irreversible
  first boot, key custody, hostile-image rejection and fleet rotation remain
  physical/deployment evidence rather than repository-testable claims.
- **Impact:** configuration/credential/CA changes still require controlled
  reflashing, and a captured unit may expose credentials unless hardware
  security is physically provisioned.
- **Closure evidence:** execute the committed procedure on spare ECO3-or-newer
  boards and retain first-boot/tampered-image/rotation evidence; establish real
  signing-key custody, immutable artifact hosting and backend release metadata.
  Prove active-ride withholding, staged update and automatic rollback before
  routine fleet deployment.

### OPS-01: runtime availability and perimeter controls are not evidenced here

- **Severity/status:** High / External gate (repo-side enablers merged for
  issue #28 via [PR #125](https://github.com/notnamansinha/Eki/pull/125); live
  deployment evidence still required).
- **Evidence:** the Firestore lease makes the background state worker safe for
  any number of API replicas. Issue #28 added the horizontal-scale enablers:
  every in-memory rate limiter divides its budget by `RATE_LIMIT_SHARD_FACTOR`
  (default 1) so N replicas enforce the same aggregate budget as one instance
  instead of multiplying it by N; `GET /health` returns 200 only while both
  Firestore and RTDB probes pass, and the process drains cleanly within the
  platform grace period. CI now builds and smoke-boots the exact
  `backend/Dockerfile` image on every push, asserting the degraded health body
  a load balancer consumes. What the repository cannot prove: the deployed
  replica count, load-balancer health behavior, WAF/global limits, alerting,
  backups, or restore procedure.
- **Impact:** a single deployed instance or missing perimeter controls can stop
  ingestion or permit abuse even when application code is correct.
- **Closure evidence:** run at least two API replicas; demonstrate health-based
  failover without duplicate lifecycle transitions; configure edge/global rate
  limits (and set `RATE_LIMIT_SHARD_FACTOR` to the replica count on every
  instance); alert on health, rejection rate, latency, stale telemetry and
  lease ownership; archive backup-and-restore and incident-drill evidence.

## Maintenance rule

Every pull request that changes an item above must update its status and attach
fresh evidence. Do not mark a risk closed merely because code exists on a branch;
closure requires the acceptance condition on the default branch.

The current source/docs verification confirms the software-side mitigations and
does not close the external firmware, deployment, privacy, backup, monitoring,
or institutional acceptance gates. Keep those gates open until evidence is
recorded in the deployment checklist and release evidence package.
