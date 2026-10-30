# Testing acceptance follow-up: 3 October 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-055 | 1.0 | Historical | 2026-10-04 |

> Historical evidence: original run dates, commits, measurements and limits below remain authoritative for that run. This documentation update does not rerun the test. See [current testing gates](README.md).

This follow-up supersedes pending claims in the earlier dated audit reports;
their original measurements remain historical evidence. Target: `testing`.
No production hosting, rules, backend deployment, or security fuses were changed.

## Verified code and deployment

- PR #226 is merged at `c001840`; its merged testing CI passed.
- PR #236 is merged at `90bdf44`; final-head and merged testing CI passed.
  The complete dependency audit, including development tools, reports zero
  vulnerabilities. The scoped Next lint adapter retains the actual plugin's
  root-directory behavior, including Windows path aliases.
- PR #238's code at `b443940` passed web, backend-container and all firmware
  build checks. CI exercised 356 frontend tests, the backend and script suites,
  seven Firebase authorization cases in emulators, 62 native firmware cases,
  and strict production export/CSP checks. These are tested scenarios, not a
  guarantee that every possible vulnerability or edge case is absent.
- Only a temporary Firebase Hosting testing preview was deployed. Sign-in is
  blocked by the existing Firebase browser API key's website-referrer restriction
  for that exact preview URL. The Auth authorized-domain list already includes
  it. Keep the key's API restrictions and other allowed referrers; unrestricted
  keys are not a fix. Authenticated preview acceptance remains pending.

## Real phone-width passenger map

At 390 × 844 CSS pixels, the authenticated localhost passenger page rendered
the real Google Maps road tiles, configured stops and stationary device together.
The route opened through its accessible Track control. Configured-route details,
destination selection, Center on bus, back navigation and Routes/Profile were
exercised. No horizontal overflow or timeline/navigation overlap was observed.
Saved screenshots and control bounds are private because they reveal location.

Browser-tool pointer input timed out; accessible keyboard activation succeeded.
The later browser recheck again encountered `ERR_BLOCKED_BY_CLIENT` on the RTDB
address. This environment block currently prevents sustained live browser
acceptance, despite the independent device/backend continuing to communicate.
Neither the earlier successful map render nor simulated tests certify every
touch interaction, mobile-network condition or continuous reconnect behavior.

## Actual board installation and power recovery

The original development board has app0 at `0x10000`, size `0x300000`, and a
64 KiB coredump partition at `0x3f0000`. The stock Arduino SDK enables flash
core dumps, so the collision guard correctly refused checkpoint storage there.
PR #238 adds a separate IDF-rebuilt development journal environment with flash
dumps disabled and guards against accidental security provisioning. Signed
fleet defaults retain their protections.

The original 3 MiB app and existing crash dump were backed up and validated
privately. Only the new app image was installed at app0 and its flash digest
verified. The partition table remains byte-for-byte identical; read-only
security checks show unchanged development-board flags. No fuse was burned.
The installed app uses the real AES-GCM codec and reports a ready journal.

| Capture | Valid HTTP records | Accepted 202 | Transport timeouts (-11) | Valid checkpoint writes | Write failures |
| --- | ---: | ---: | ---: | ---: | ---: |
| Journal baseline | 36 | 34 | 2 | 5 | 0 |
| Ten-second RTC-loss simulation | 35 | 34 | 1 | 4 | 0 |
| 65-second RTC-loss simulation | 34 | 33 | 1 | 4 | 0 |
| Physical short-cut recorder | 535 | 535 | 0 | 54 | 0 |
| Physical long-cut recorder | 456 | 452 | 4 | 52 | 0 |

The simulations clear the queue's RTC magic and delay boot; electrical power
remains connected. The 65-second simulation directly logged stale-queue removal.
The native suite also checks the 55-second freshness horizon and warm-RTC priority.

The user disconnected all power in the physical tests. Short-cut USB absence was
14.481 seconds; checkpoint sequence 566 was followed by 567 after reconnect.
Combining the first recorder's second disconnect with the long recorder's first
USB return gives a 122.168-second physical outage. A further 1.688-second USB
interruption occurred during return. Saved sequence 937 was followed by fresh
checkpoint 938, and clean journal-ready/recovered messages were captured.
Every valid post-return HTTP sample had a fresh capture timestamp; the expired
saved location was not observed being resent. Fresh GNSS replaced that recovered
fix before publication, so the physical capture does not directly log the
stale-drop branch. The native/RTC-loss tests provide that branch evidence.

Startup UART contains garbled/repeated fragments. Raw counts would inflate HTTP
and readiness totals; this report accepts only anchored, valid complete records.
Raw output is retained alongside readable telemetry/GNSS/checkpoint CSVs and
SHA-256 references. Isolated HTTP timeouts recovered; they are included above.

This is latest-committed-fix recovery. Samples after the last successful flash
checkpoint can still be lost during complete power loss. The first-fix/ten-second
schedule and flash wear limits are documented in the hardware runbook. No actual
service was armed for this stationary bench test; durable crossed-stop/history
recovery is covered by backend transactional fault tests, not a physical drive.

## Latency and retention

Fifteen successful health probes per endpoint measured localhost p50/p95
2.15/95.72 ms and tunnel p50/p95 225.23/610.04 ms. These are health round trips,
not GPS-to-marker latency. A phone-width loopback run delivered 144 synthetic
samples through the real selection/smoothing/trace hooks across 12 scenarios.
Frame-gap p95 remained about one second, limiting arrival correlation. Keep the
250 ms production smoothing default; this throttled run does not justify tuning.
It measures neither Google Maps compositor paint nor a physical moving bus.

Read-only 180-day Firestore and RTDB inventories found no eligible old ride,
feedback, trip, legacy or geometry records. The safe RTDB apply deleted zero
records. Legacy cleanup stays gated until legacy consumers are declared retired.
Development's scheduled retention worker remains disabled; the production
startup contract requires its explicit activation. A testing frontend preview
does not deploy or activate a backend retention worker.

## Remaining gates

Issues #191/#192/#194/#195 must be assessed against their original acceptance
criteria. Real moving/weak-network browser and chat distributions, matched
Firebase/Google usage, and authenticated preview rollout are not established
by this bench evidence. Keep unmet acceptance items open with precise evidence
and linked implementation PRs. Do not close them solely because code merged.

Private evidence is archived under ignored
`temp/remaining-acceptance-2026-10-03` in the primary checkout. Firmware images,
credential configuration and account authentication state are excluded from
the shared report and general evidence bundle.
