# Live non-motion inventory — 11 October 2026

Read-only checks for [#245](https://github.com/notnamansinha/Eki/issues/245) used the owner's existing Firebase project `bustrack-be165` and the connected ESP32 on COM3. The project contains live application data; it is not a disposable staging namespace. No data was deleted, cloud service enabled, firmware flashed, key generated, eFuse changed or public release deployed. Results are an inventory, not a completed production rollout.

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

The owner has no approved RSA-3072 fleet signing key or tested replacement/recovery plan and identified this same development board as the hardware target. The existing [provisioning procedure](../operations/HARDWARE_SECURITY_PROVISIONING.md) requires a witnessed spare-board trial, custody and recovery before irreversible Secure Boot/flash-encryption eFuses are burned. This board was inspected only; there is no secure-fleet acceptance or signed OTA field trial. Firmware source/build hashes cannot be claimed as the currently flashed image without a readback or signed release record.

## Open non-motion release work

- Deploy and observe a stable, managed backend with owned billing, domain, TLS, secrets, at least two replicas, worker failover, monitoring/alerts and rollback before changing Hosting or device endpoints.
- Verify App Check hostname/provider/debug enrollment and affected browser consumers against that deployed backend, then enable API enforcement in a controlled window.
- Rehearse privacy, legacy retention, backup/restore and long-lived worker failure only after a protected test namespace and approved data/erasure plan exist. The seven successful index probes do not authorize destructive live deletion.
- Establish a controlled signing environment and a spare/recoverable board for the irreversible security and OTA trials. Motion-specific acceptance remains separate.
