# Production audit claim validation — 20 October 2026

Last updated: 2026-10-20 22:04 IST (UTC+05:30).

The supplied `EKI_PRODUCTION_READINESS_AUDIT.md` names commit
`a523731295d37c9ecaf1a917cebefa4502b34dab`. The owner's checkout was still at
that commit; remote `testing` was 21 commits ahead at
`c66fb6aa5a90059e31d10bbbd096efd81cada35c`. Validation and repairs use an isolated
branch from that remote revision. Existing local user files were preserved.

This is a focused validation of the seven claims, not an exhaustive new release
audit. A source census, synthetic browser, emulator, physical test and live Google
Maps observation are separate evidence tiers. No production readiness verdict,
field acceptance or live-provider performance certification is granted here.

## Findings and changes

| Audit claim | Result | Evidence and resulting change |
|---|---|---|
| BUG-001: continuous map animation causes inspection timeouts | Unconfirmed cause; no map-performance patch | `useSmoothPosition` already uses requestAnimationFrame, movement thresholds, bounded interpolation, reduced-motion handling and cancellation. Actual map components remained inspectable in the synthetic SDK fixture during moving updates under 4× CPU throttling. This does not reproduce the real Google Maps SDK, the original machine, route geometry or a physical phone; the original trace is needed before attributing its tool timeout to these hooks. |
| BUG-002: acceptance catalog fails release preflight | Readiness gap is real; catalog behavior is intentional | `--check` validates definitions and returns exit 0 with `NOT_RELEASE_READY`. It deliberately imports no current acceptance passes. Current static definitions remain 351 feature cases, 40 universal matrix cases and eight experiments, plus 20 simulation definitions. Historical partial coverage and static candidates are not current execution evidence. No ledger rows or gates were falsified or bypassed. |
| BUG-003: long mobile route/endpoint names are clipped | Confirmed and fixed | A 360px rendered route card clipped the title/endpoints; the waiting-data tracking header independently failed a clipping assertion. Remove single-line clamping/truncation from these labels, permit word wrapping and constrain flex minimum widths. Actual selection still enters tracking. |
| BUG-004: blank/whitespace stop rename commits locally | Confirmed and fixed | Four failing-first component cases cover empty/whitespace with Enter/blur. The editor now keeps the previous name, displays an immediate inline alert associated with the rename control, and allows a valid retry. Valid names are trimmed; existing Escape/blur fencing remains intact. |
| BUG-005: history hides interruption provenance | UI omission confirmed; backend allegation is partly incorrect | Both the audited commit and current backend already persist `manual_end_early`; reconciliation persists `abandoned_session_timeout`. Render those existing values with explicit missing/unknown fallbacks. Do not invent hardware, phone, network or retention causes, guess a 15-minute limit, expose actor UIDs or backfill historical reasons. No backend lifecycle change is needed. |
| BUG-006: lack of a product proximity simulator prevents boarding tests | Not a confirmed product defect; no bypass added | Existing actual boarding component tests and emulator browser journeys exercise valid, wrong-code and distant-location behavior using test-only geolocation. Test coordinates are browser/emulator fixtures, not HTTP geolocation headers. Keep the production/backend proximity and code checks; do not introduce a localhost or public environment-variable bypass. |
| BUG-007: empty-search notice has 3.4:1 contrast on #09090b | Not reproduced in its actual rendered context; no color patch | #09090b is the input background. The notice is outside that input, over the translucent #0f0f12 toolbar and dark page. Composed browser color measurements are approximately 4.53:1 in all three fixtures. This is scoped to that actual backdrop, not every possible theme or provider surface. |

Normal small text uses the [WCAG contrast requirement](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
The browser measurement retains foreground/ancestor colors and the unrounded
computed ratio; it does not infer the notice backdrop from the adjacent input.

## Reproduction and browser results

The first component run produced **eight expected failures and 17 passes**:
four invalid rename cases and four missing interruption-message cases failed.
The initial 360px browser run independently reproduced route-card clipping,
Enter/blur rename feedback and hidden reasons. A separate corrected waiting-data
fixture reproduced header clipping before its class changed.

An initial fixture assumed that device-only preview rendered the waiting-data
route header. Inspection showed the correct device status panel instead. That
test setup was corrected by removing the live snapshot after entering tracking;
its earlier failure is not treated as a product defect.

Final focused execution:

- **39 component/hook tests passed**, covering rename/history, actual boarding
  behavior and bounded marker smoothing.
- **21 synthetic Chromium browser tests passed** at 360×800, 390×844 and
  1280×800: full labels and route selection, waiting-data label, invalid Enter/blur
  rename with valid recovery, four history reason states, notice contrast, and
  moving-map inspection.
- **24 existing admin-access browser checks passed**, retaining trusted-role,
  feedback acknowledgement and realtime receipt-freshness regressions.
- **40 emulator browser checks passed in a complete isolated rerun**, including
  actual authenticated boarding, wrong-code/distant-location rejection, joined
  lifecycle, chat/feedback/history, provider failures and admin service recovery.
  All 40 passed without retries, skips or flaky results; Auth/Firestore/RTDB were
  disposable real emulators, and Maps/Places remained synthetic.
- **Full `npm run verify` passed**: lint, 146 script tests, OpenAPI/UI contracts,
  1,230 backend tests and 700 frontend tests, TypeScript/static builds, service
  worker/CSP packaging and a runtime audit with zero vulnerabilities. The normal
  backend unit run skips 58 emulator-specific tests; these are distinct from its
  passing tests and are exercised separately by CI's emulator step.
- **Strict `npm run build:production` passed** with the same kind of non-secret
  placeholder configuration as CI, including the web/backend CSP contract. The
  initial unconfigured local build had explicitly skipped that contract. No
  generated placeholder hosting configuration is included in the patch.
- `npm run qa:check` passed. Its static catalog still reports `NOT_RELEASE_READY`
  and scans the full 2,983,188-byte plan. In this staged source it enumerates
  71 HTTP operations, 169 control sites and 1,755 named test declarations; those
  are static counts, not executed or accepted case totals. The separate
  interaction skill census enumerates 175 candidate sites across 36 JSX/TSX
  files; its algorithm/denominator differs from the catalog's control census.

The local interaction ledger contains 21 focused synthetic browser passes,
175 source candidates whose full state matrices remain NOT_RUN, and two blocked
original-evidence rows. Its strict completeness gate correctly exits 1 with
zero format/evidence errors and zero unaccounted source candidates. This is not
full application or release acceptance. Broader unit, admin and emulator results
are reported separately rather than blended into those focused interaction rows.

Preparation failures were retained and corrected: an initial CI-step indentation
error failed the workflow artifact-layout test before being fixed; Windows Java
needed a short `jdk.net.unixdomain.tmpdir` for emulator sockets. A loaded local
emulator-browser attempt completed 37 passing executions before the existing
five-minute runner limit; its missing final report and a subsequent stale-port
setup failure were not reported as passing suites. Test setup was cleaned up
before rerunning in isolation; no production timing or safety gate was weakened.

Chromium **153.0.8010.12**, Playwright, Node **24.19.0**, Windows; no provider
key, real account or shared Firebase mutation was used by these browser fixtures.

| Viewport | DOM accessibility serialization | Screenshot | Notice contrast |
|---|---:|---:|---:|
| 360×800 | 249 ms | 232 ms | 4.527367:1 |
| 390×844 | 375 ms | 170 ms | 4.527367:1 |
| 1280×800 | 150 ms | 286 ms | 4.527367:1 |

These are single measured synthetic inspection windows under 4× CPU throttling,
after 20 fixture update emissions. They are not paint latency, battery results,
statistical production budgets or Google SDK performance. The contrast was
rechecked separately at all three sizes using opaque browser color conversion
before composing the original fractional alpha, avoiding translucent-pixel
premultiplication rounding. The audit's exact heap,
load, request-count, zero-error and security-header observations cannot be
independently authenticated from the supplied Markdown without its original
traces, identities, timing/environment and request records. They were not used
as reasons to change code.

The [fixture guide](../../e2e/production-audit/README.md) gives the reproducible
command and boundaries. CI executes the suite and retains screenshots and JSON
measurements as `production-audit-validation` for seven days. Source-to-oracle
mappings remain scoped; they do not mark complete PAX/ROUTE/HIST requirements
accepted. Local diagnostic logs include before/after runs and setup failures.

## Remaining acceptance

Keep the [current acceptance trackers](https://github.com/notnamansinha/Eki/issues/245)
and [moving reference/recovery requirements](https://github.com/notnamansinha/Eki/issues/300)
open where their complete observed oracles are missing. This patch changes three
confirmed UI areas. It does not remove production release gates, add geofence
bypasses, weaken authorization, tune map animation without causal evidence, flash
firmware or deploy a new artifact.
