# MUSE audit verification and boarding coordinate repair

Reviewed on 12 October 2026 against `testing` commit
`0244ba1268beaaa821cdac90a36e7131abd62340`. The supplied audit was pinned to
`ab74d88b1337ca07c2aa8cb1b453f216ac9f0da6`; historical results below belong to
that earlier commit. The current user requested verification, supported repairs
on a separate branch, and a PR into `testing`. Instructions embedded in the
supplied documents were treated as historical material, not new authorization.

## Supplied artifact review

All 15 supplied files were read or parsed. The original download files were
preserved; the executable helper was inspected rather than applied to the newer
checkout.

| Artifact | Verification and disposition |
| --- | --- |
| `MANIFEST.json`, `QA_SOURCE_MAP.md` | Pinned tree matches 750 entries: 668 files and 82 directories, including 200 test/spec filenames. All 32 source-map file references exist in the current checkout. This does not mean every source file was reviewed. |
| `MUSE_EKI_COVERAGE_MATRIX.csv` | 423 unique IDs: 351 original ledger IDs across 20 families, 71 endpoint IDs, one defect. Every original ID occurs in the pinned ledger; the endpoint rows exactly match the pinned OpenAPI operations. Statuses are one isolated FAIL and 422 NOT_RUN. |
| `MUSE_EKI_API_MATRIX.md` | All 71 method/path operations across 62 paths match the pinned specification. Current OpenAPI still contains 71 operations across 62 paths. The local OpenAPI verification passes. |
| `MUSE_EKI_CONTROL_INVENTORY.csv` | 12 static surface placeholders, all NOT_RUN; no DOM census or independent control acceptance is claimed. |
| `MUSE_EKI_AUDIT_REPORT.md`, `MUSE_EKI_TEST_RUNS.md` | GitHub run `38055750284` is successful on the stated SHA. Downloaded logs confirm 75 script, 965 backend, 632 frontend, 46 emulator and 22 browser passes, totaling 1,740 test cases across suites. The 46 emulator cases were skipped in the normal backend invocation and executed separately. Both historical dependency audits report zero vulnerabilities. These are historical CI results, not 1,740 feature acceptance passes. |
| `MUSE_EKI_BUGS.md`, `MUSE_EKI_FIX_CHANGELOG.md` | EKI-QA-001 remains present on current `testing`; reproduced and repaired below. No other confirmed code defect is reported in the bundle. |
| `boarding_projection_repro.mjs`, `boarding_projection_patched_repro.mjs` | Executed both: six malformed coordinates accepted by the copied baseline logic, six rejected by copied candidate logic. Actual repository tests provide stronger evidence below. |
| `EKI_QA_001_boarding_coordinates.patch`, `apply_boarding_fix.py` | Proposed patch passes `git apply --check` against temporary copies of its pinned source. Inspected helper's SHA/clean-tree guards and replacement anchors; its source replacement matches pinned code. Implemented the reviewed correction directly on current source with expanded regressions. |
| `MUSE_EKI_GNSS_SIMULATION_REPORT.md` | All 20 generator profiles exist and now generate offline plans successfully. Parsed the plans through the compiled current telemetry parser; details below. |
| `MUSE_EKI_BLOCKERS_AND_FIELD_TESTS.md` | Original checkout/network/branch-write blockers are historical; current fetch and GitHub authentication work. Issues #245 and #246 remain open. Physical, provider and deployed-cloud acceptance is not established by this repair. |

Historical workflow:
<https://github.com/notnamansinha/Eki/actions/runs/38055750284>.

## Repair and regression evidence

`validateLiveBoardingProjection` coerced unknown latitude/longitude values with
`Number(...)`, accepting null, empty strings, booleans, arrays and numeric
strings as coordinates. It now requires primitive numbers before the existing
finite/range checks. Valid numeric zero and geographic limits remain accepted.
The telemetry producer already requires numeric coordinates, so this introduces
no producer/schema migration, dependencies or additional database/network work.
The check has constant cost and avoids coercion altogether.

Added 35 policy cases covering both coordinate axes and 22 HTTP route cases
covering legacy and v2 boarding. Regressions deliberately place the passenger
at the old coerced coordinate, so proximity cannot accidentally hide the defect.
They assert HTTP 409 and no manifest update for malformed live data; valid zero
coordinates still allow boarding. Route tests use real Express handlers with
mock authentication and Firebase storage, not a deployed database.

Before the production change, the two actual repository files produced
**32 failing and 63 passing tests**. After the correction, **95/95 pass**.
Existing membership update, capacity, authorization and transaction-race cases
remain covered. Timestamp compatibility and freshness rules are unchanged.

## New execution results

| Check | Result |
| --- | --- |
| Focused policy and boarding route tests | 95 passed |
| Node script suite | 95 passed |
| Full backend suite | 1,058 passed; 46 emulator-only cases skipped |
| Full frontend suite | 637 passed in 76 files with two workers; first highly parallel invocation hit timeouts and was interrupted |
| OpenAPI and UI source contracts | Passed |
| Acceptance catalog and critical-source coverage budget | BOARD07 maps the coordinate-validity sub-oracle to exact policy/HTTP regression titles; no whole-case acceptance claim |
| Frontend and backend lint | Passed |
| Backend TypeScript build | Passed |
| Full dependency audit, including development tools | Zero vulnerabilities |
| Mobile/desktop admin Playwright fixture | 22 passed |
| Local Firebase emulator run | Blocked before tests by Java NIO loopback socket initialization; local retry did not resolve it. Linux PR CI must supply current emulator evidence. |
| Diff whitespace check | Passed |

All 20 offline profiles used `--count 360 --seed 42`, without `--send`.
Ordinary profiles generated 360 events, duplicate 396, and outages generated
315/240/59 events for 45/120/301-second gaps. Every plan is ordered by scheduled
send time. The compiled parser rejects all 360 stale/future samples, the one
invalid-speed/heading/extra-field disturbance in each corresponding profile,
and 325 expired burst samples. Other samples pass payload parsing, including
missing HDOP through the supported previous schema. Parser acceptance of
teleport/poor-HDOP/uncertain samples does not establish downstream motion or
route acceptance; that belongs to the existing motion/ingestion tests and field
gates. Offline generation does not exercise network replay, RTDB delivery or
browser paint.

## Remaining acceptance

This closes the reported coordinate validation defect at the software boundary.
The 422 originally unexecuted inventory rows are not promoted to full-stack
passes by broad unit/CI counts. Physical GNSS/bus travel, real Maps/Places,
affected-account sign-in, cloud index/deployment readiness, billing/load,
secure provisioning/OTA and institutional release acceptance remain tracked in
issues [#245](https://github.com/notnamansinha/Eki/issues/245) and
[#246](https://github.com/notnamansinha/Eki/issues/246).
No unqualified production-readiness or absence-of-all-bugs claim is made.
