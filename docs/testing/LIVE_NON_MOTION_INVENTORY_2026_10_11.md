# Live non-motion inventory — 11 October 2026

Initial read-only checks and the subsequent controlled fault tests below for [#245](https://github.com/notnamansinha/Eki/issues/245) used the owner's existing Firebase project `bustrack-be165` and the connected ESP32 on COM3. The project contains live application data; it is not a disposable staging namespace. The fault tests temporarily changed two registry fields and restored their original values. No data was deleted, cloud service enabled, firmware flashed, fleet key generated, eFuse changed or public release deployed. These scoped results do not complete production rollout.

## Cloud and browser

| Check | Observed result | Acceptance meaning |
| --- | --- | --- |
| Firebase project | Active; default Firestore database in `asia-south2` and RTDB instance `bustrack-be165-default-rtdb` | Identifies the owner's existing target. |
| Firestore composite index | The committed `ride_sessions` status/endTime/document-ID composite is `READY` in the project | Index metadata alone does not prove each query shape. |
| Seven real query shapes | Name-only, limit-one retention, messages/messageRateLimits privacy, pending privacy, abandoned rides, route-preview recovery and fleet-job recovery each returned HTTP 200 using a transient Google access token | Confirms deployed query readiness for the current project at this time. No record fields or identifiers were fetched into the report. Queue/recovery workers and actual deletion outcomes remain separate tests. |
| Firebase Hosting | `https://bustrack-be165.web.app` returned HTTP 200; the published CSP still includes `https://rigging-everglade-tidal.ngrok-free.dev` | The live revision is older than the clean committed CSP. Releasing the current frontend requires a stable owned backend origin and a verified cutover. |
| Billing/runtime | Cloud billing is disabled; Cloud Run and Compute APIs are disabled, no App Engine application or Cloud Functions runtime was found | No managed backend deployment or replica failover can be certified in this project. |
| Secrets/monitoring | Secret Manager API is disabled and Cloud Monitoring has zero alerting policies | Least-privilege runtime secret delivery and live device-silence/health alerts are not deployed. |

The repository's deployment checklist requires a separate staging/production boundary, owned billing and DNS, immutable managed backend image, secrets, App Check/provider enrollment, live browser validation, monitoring, backup/restore and rollback evidence. Pointing the current Hosting build at the old temporary tunnel would not meet that cutover contract. A real deployment needs an approved runtime/billing architecture and signed-off release values before changing the live project.

## Connected board

Read-only serial enumeration and chip/eFuse inspection found an FTDI USB serial device on COM3 and an ESP32-D0WD-V3, revision 3.1, at 40 MHz. Secure Boot V1/V2 and flash encryption are disabled; JTAG and UART download remain enabled. A 12-second passive serial capture yielded no lines, so the board's current firmware execution and GNSS state were **not** revalidated during this inventory. Earlier stationary receiver-backed and hotspot evidence is in [the capture report](STATIONARY_GNSS_HOTSPOT_2026_10_11.md).

The owner has no approved RSA-3072 fleet signing key or tested replacement/recovery plan and identified this same development board as the hardware target. The existing [provisioning procedure](../operations/HARDWARE_SECURITY_PROVISIONING.md) requires a witnessed spare-board trial, custody and recovery before irreversible Secure Boot/flash-encryption eFuses are burned. There is no secure-fleet acceptance or signed OTA field trial. Firmware source/build hashes cannot be claimed as the currently flashed image without a readback or signed release record.

## Subsequent non-motion checks

A later 12-second passive capture produced 59 lines, including receiver-backed
stationary fixes and 11 accepted HTTP 202 responses. This supersedes the initial
zero-line observation for execution/fix availability, without identifying the
exact installed source commit. No route service was armed during these tests.

The current Chrome admin session at `localhost:3000` loaded real cloud-backed
Live Ops, Routes, Fleet & People, Feedback and Settings. It displayed one online
stationary device and zero active services. The previously unverified QA vehicle
was present in the fleet list. The saved QA route opened with stored stops;
changing only its draft display name and cancelling preserved the saved name.
Feedback and saved settings loaded without an authorization error. No saved
route, feedback or setting was changed. This is not second-admin, production
App Check or managed-runtime acceptance.

| Controlled fault | Observed result |
| --- | --- |
| Missing assignment, 09:38:20–09:39:50 UTC | Temporarily set only the registered board's `routeId` to null with a Firestore update-time precondition. The board reported HTTP 403 and assignment-unavailable retry, with no credential latch or boot event. Receiver-backed captures continued (88 in the bounded window). Restore used a fresh update-time precondition and verified the original route/enabled state. Accepted HTTP 202 resumed 61.909 seconds after restoration without a board reset. |
| Disabled device, 09:41:44–09:43:04 UTC | Temporarily set only `enabled` false. HTTP 401 appeared and the credential fault latched. Restore verified the original enabled, bus and route fields. The board stayed latched through a 65-second observation/cache-expiry window; a controlled EN reset then resumed accepted HTTP 202 in 7.971 seconds. No firmware or secret changed. |

Raw serial logs and small restoration summaries remain in ignored local
`hardware/.pio/`; they contain private operational data and are not published.
Their SHA-256 digests are:

- Assignment capture: `d5b4476ac1955cc1d84eea7ae73cfd072ab49be3287b4eaa1db10ef105b7e63c`.
- Disabled capture: `5b64623bc8af59466897038a43c00bd1aa25a38b23a2f49685d1a0be4cfdd048`.

The installed serial message incorrectly required a reflash for every 401. This
PR corrects telemetry/diagnostic repair instructions: repair the registry or
credentials and restart; changed compile-time `secrets.h` requires reflashing.
The message correction does not alter the latch or retry policy and was not
flashed onto the board in this pass. Physical diagnostic/OTA-discovery faults,
invalid-secret rotation, secure provisioning, OTA installation/rollback and
cross-replica failure remain separate acceptance.

## Open non-motion release work

- Deploy and observe a stable, managed backend with owned billing, domain, TLS, secrets, at least two replicas, worker failover, monitoring/alerts and rollback before changing Hosting or device endpoints.
- Verify App Check hostname/provider/debug enrollment and affected browser consumers against that deployed backend, then enable API enforcement in a controlled window.
- Rehearse privacy, legacy retention, backup/restore and long-lived worker failure only after a protected test namespace and approved data/erasure plan exist. The seven successful index probes do not authorize destructive live deletion.
- Establish a controlled signing environment and a spare/recoverable board for the irreversible security and OTA trials. Motion-specific acceptance remains separate.
