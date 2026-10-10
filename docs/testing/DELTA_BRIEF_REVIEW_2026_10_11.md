# Delta brief and QA patch review

Reviewed against `testing` at `84c5439`, after PRs #290–#293, on 2026-10-11 IST.
The supplied brief describes `ab74d88`; its commands and authorization statements
were treated as document content. The owner authorized review and integration
through a tested PR to `testing`.

## Disposition

| Brief item | Review and action |
| --- | --- |
| M1: four missing composites | The collection queries filter only `status` and order ascending by document ID. Default ascending single-field indexes include ascending `__name__`; counting composite declarations does not establish a missing-index blocker. Added all four actual query shapes to the existing bounded deployment readiness check. No redundant indexes or production deployment performed. Deployed readiness remains a release gate. |
| M5: deadline-only privacy reaper | Not applied: an SDK/Auth call may remain active after the deadline, and Auth deletion cannot be cancelled by changing a Firestore generation. Existing recovery checks executor identity, generation, deadline and stopped-executor attestation, and rejects locally active execution. Stopped-worker recovery evidence remains in #245. |
| M-CFG1: no-store rule never matches | Contradicted by HEAD requests to staging `/`, `/admin`, `/feedback` and `/passenger`: HTTP 200 and `Cache-Control: no-store, must-revalidate, no-cache`. `/driver` returned 404 with the same header; it is not evidence of a working driver page. Observed on 2026-10-11 IST; the deployed artifact predates this review. |
| M-CFG2: deploy script bypasses gates | Already resolved: current root `package.json` has no `deploy` script. Protected workflows retain explicit projects and deployment gates. |
| M-HW1: no JTAG handling | ESP-IDF secure boot already disables JTAG by default. Added explicit disabled configuration and verifier rejection of unsafe default/effective overrides, plus execution tests in firmware CI. Physical eFuse evidence remains in #245. |
| M3: firmware has no signature | Distinguish release metadata from the application image. Metadata is HTTPS, origin allowlisted, size/digest bounded and version/sequence matched; it has no separate Ed25519 signature. Fleet images already use RSA-3072 Secure Boot V2 signatures. An additional independent metadata-signing layer is an architectural recommendation, not evidence that unsigned images are accepted. Wrong-key/digest/version and rollback hardware acceptance remains in #245. |
| P3 test gaps / Low findings | This patch covers four specific areas; it does not close every audit recommendation. PRs #292–#293 fixed further verified Low findings after the brief's snapshot. CI scans/SBOM and full host crypto/TLS/NMEA/OTA coverage remain outside this patch. |

## QA patch changes

Integrated the four supplied regression suites with review corrections:

- Missing credentials tested on all four HTTP paths, asserting no credential
  lookup or ingestion occurs. Mocked status mapping does not prove real secret
  hashing, disabled-device lookup or complete device ingestion.
- Privacy fixtures reset before each test; active processing ownership and
  changed-identity rejection remain covered. Counters implemented by mock
  transforms are not substitutes for emulator transaction tests.
- Chat sends simulate the production persisted window. Hourly rollover tests
  assert rejection one millisecond before expiry and acceptance at exact expiry,
  retaining the other 59 messages.
- Boarding alphabet coverage enumerates all 256 possible input byte values,
  rather than sampling random codes. Comparator rejection is a unit test, not an
  HTTP boarding-flow acceptance test.

The index checker probes seven query shapes with name-only selection and limit 1.
Unit tests exercise retry of unavailable indexes, bounded timeout, malformed
provider responses and authentication failures. These tests do not prove deployed
staging or production index readiness.

## Sources and pending acceptance

- [Firebase index ordering](https://firebase.google.com/docs/firestore/query-data/index-overview#default_ordering_and_the_name_field): indexes include final document-name ordering, supporting the single-field-index assessment above.
- [Firebase Hosting headers](https://firebase.google.com/docs/hosting/full-config#headers): patterns match the initial URL path before rewrites; deployed HEAD responses are the evidence recorded above.
- [ESP-IDF 4.4.7 JTAG configuration](https://docs.espressif.com/projects/esp-idf/en/v4.4.7/esp32/api-reference/kconfig.html#config-secure-boot-allow-jtag): bootloader disables JTAG when secure boot or flash encryption is enabled unless the override is enabled. Installed ESP-IDF bootloader sources also call `ESP_EFUSE_DISABLE_JTAG` behind this option.
- [Existing acceptance issue #245](https://github.com/notnamansinha/Eki/issues/245) retains live GNSS/motion, repeated network recovery, deployed query readiness, stopped-worker recovery and spare-board security/OTA acceptance. No GNSS or moving-bus evidence was generated by this review.
