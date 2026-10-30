# Reverification: 20 October 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-048 | 1.0 | Historical | 2026-10-20 |

The expanded recheck found and repaired three defects in PR [#338](https://github.com/notnamansinha/Eki/pull/338): archive checksum overwrite, false settings changes after undo, and silent incomplete raw-serial writes. The PR targets `testing` and remains unmerged for owner review. No cloud deployment or new physical drive was performed.

## Tested source and environment

The full six-family local campaign and 97 browser assertions ran on clean software commit `09bc57d3da4ed08653847cf4708d767417862f57`. The final raw-write guard was committed at `c76254e8e5ab1a2fbe2b443851764a2135aeff73` and separately rechecked with all 143 repository script tests, including 11 disposable Python fault cases. The later changes affect capture tooling, test assertions and documentation; production frontend/backend/firmware implementation files remain identical to the full-campaign commit. Hosted CI tracks the PR's latest commit separately.

Windows, Node 24.19.0, Python 3.11.9, Java 21.0.12.1, PlatformIO 6.2.0 and Playwright Chromium 153.0.8010.12. npm 11.17.0 and the installed npm 12.0.2 were recorded. The runtime used synthetic identities and loopback demo Auth/Firestore/RTDB. Genuine provider, live-cloud and physical results are separate evidence tiers. Interactive control of the user's Chrome session was disabled in Work settings; isolated Playwright processes exercised the rendered components and built guest shell.

## Observed checks

| Check | Result |
| --- | --- |
| Frontend/backend lint | Pass |
| Repository scripts | 143 pass; includes 11 Python capture/archive fault cases |
| Backend unit suite | 1,229 pass; 58 integration cases skipped here and separately exercised below |
| Full frontend suite | 690 pass with two workers |
| Firebase integration | 58 pass against real local emulators |
| Authorization API sweep | Eight test groups pass; 179 recorded HTTP observations; OpenAPI reconciles 71 published operations |
| Native firmware policies | 84 host assertions pass; no board flash or physical-device claim |
| GNSS/property harness | 15 pass, including bounded generated payload/motion/recovery/order properties |
| Reviewed unit sub-oracles | 375 pass; overlaps the broader unit suites and is not added as unique coverage |
| Emulator browser | 40 pass, mobile and desktop, zero skips/flaky results/retries |
| Synthetic admin browser | 22 pass, mobile and desktop |
| Extra passenger/settings browser | 24 pass at 360, 390, 768 and 1280 CSS pixels |
| Shared marker hooks browser | Two pass using the synthetic SDK |
| Strict-export browser smoke | Nine pass at 360, 390 and 1280 pixels |
| Selective mutation | 266 mutations: 257 killed, nine survived, zero timeout/no-coverage/errors; score 96.62%, configured threshold 90% |
| Bounded admission soak | Five independent trials pass; 1,250,000 synthetic submissions, FIFO and retained-memory assertions |
| Strict production packaging | Pass with CI placeholders; 26 precached files/1076 KB, six CSP script hashes, backend-origin contract |
| Dependency audits | Runtime and full/development audits both report zero vulnerabilities |
| Production dependency SBOM | CycloneDX generated and validated with 252 components using npm 12 |
| Official QA/changed-source budget | Pass against immutable testing base 8297c4fd8fa2ac9c22ec8e875f0a955be2113d04 |

The actual-component emulator browser covers boarding and reload restoration, wrong-code/distance rejection, chat lost-acknowledgement reconciliation, feedback persistence/cooldown, decoded/denied profile images, privacy recovery, route creation/provider failures, six admin panels with pointer/keyboard navigation, fleet/operator edits, stop arrival, terminal history, completion and a distinct return, and bounded service delay/interruption/restart. Provider responses are synthetic; these are not genuine Google Maps/Places/OAuth acceptance.

The production-export smoke serves the real built files on loopback with generated Hosting security headers. It verifies hydration and decoded images under CSP, responsive width, canonical URL semantics, guest admin redirection without protected panels, and a fresh guest-shell reload offline through the installed service worker. It does not prove real-device PWA suspension, deployed caching or sign-in credentials.

## Defects and reproducibility

1. Existing checksum sidecars could be overwritten. Existing-file and publication-race tests failed before repair; exclusive creation preserves prior data and raises on a conflict.
2. Reverting settings retained a false dirty state and submitted reverted fields. Two regression cases failed before repair; the panel now compares overrides with current persisted values and submits only actual changes. Responsive browser cases confirm unchanged state after undo.
3. A short raw file write could be counted as a full captured chunk. The fault test failed before repair; incomplete writes now raise and never publish a full-chunk event or masquerade as a serial disconnect.

Mutation review identified two missing fractional-sample-clock assertions. The validator already rejected these values; the test was strengthened at `87500ee820ea206e7dced9a3eb1168660ccf78cd`, with 31 focused assertions/tests and the 15-test GNSS harness passing. A repeat mutation run killed those two mutants, improving 95.86% (255/266) to 96.62% (257/266). The remaining nine remove type checks already implied by adjacent Number.isFinite, Number.isSafeInteger or membership in the string-only motion-state set. These equivalent guard mutations remain visible and are not suppressed. The selective score does not establish complete feature coverage. No product defect was inferred from intentional quota/deadline injections. Setup/harness failures are preserved: Windows Java socket startup required the existing short process-only socket directory; an early browser campaign reached its overall process budget and passed on a quieter rerun; mutation initially raced with emulator log removal and passed when run sequentially. Exploratory locators, an open fixture menu and equivalent canonical URL formatting were corrected in the harness. npm 11's SBOM validation rejected existing dependency overrides; the already installed npm 12 generated the valid SBOM without changing dependency policy. No application test deadline or Firebase rule was relaxed.

## Evidence custody and coverage limits

The ignored local artifact directory is `artifacts/qa/interaction-audit/2026-10-20-d67769a/`; its name preserves the starting run identity and its JSON records the tested commits. It contains the source inventory, journey graph, coverage CSV/summary, execution report, defect records, command logs, structured test reports, screenshots, SBOM and integrity results. These private artifacts are not published to GitHub.

The ledger has **97 passing named browser scenarios**, **175 source-control candidates still awaiting individual state/action reconciliation**, and **three grouped external gates blocked**. The strict coverage validator reports zero evidence/schema errors and incomplete coverage (exit 1). Scenario success is not treated as every control having been tested. The official six-family execution report passes its required harness scopes but retains **NOT_RELEASE_READY**: 135 partial cases, three not run, 261 not covered, zero complete feature cases across its 399 catalog entries (351 features + 40 universal matrix entries + eight experiment protocols).

Both existing private field archives retain their expected whole-ZIP SHA-256; CRC and every one of their 60/61 file digests were reverified. The original digest is `1244074ee9046b4fe398e21daed02f798bb93a0b6713f9f8510a45a0ca347cdb`. Raw travel locations, identities, tokens and device binaries remain private. A verified archive on this laptop is not an independent off-device backup.

## Remaining acceptance

Production readiness is not certified. Genuine OAuth/Maps/Places, deployed permissions/claims/index/retention/replica controls, physical phones/PWA suspension, fleet security/rollout and owner policy approvals remain pending in #245/#246/#300/#337. The 19 October drive had no armed ride session or independent GNSS truth. Its ordered stops, boarding/ETA/chat, completion/return and compound recovery remain unverified on the road. Emulator lifecycle evidence does not close those physical gates. See the [moving capture](MOVING_GNSS_CAPTURE_2026_10_19.md) and [field runbook](../operations/FIELD_CAPTURE.md).
