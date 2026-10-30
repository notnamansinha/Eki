# PR #323 interaction and retirement review

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-040 | 1.0 | Historical | 2026-10-15 |

Reviewed on 14 October 2026, Asia/Kolkata. Original PR head:
`c5a3c820d87f6c2ddbb64189400d43d75d20df1c`; base/audit revision:
`454a69631826ba6e371f2b3eca6820dfc91bc774`. Fixes and the testing skill are part
of this PR. Validation ran against the working diff; source hashes and the final
commit association are retained in `artifacts/qa/pr-323/` in the review worktree.

## Inputs and review scope

The supplied `Eki-Interaction-Audit-2026-10-13-454a696.zip` has 577 files, all
byte-identical to the earlier local audit, with no extra or changed files. It
provides the same evidence set, not an independent Antigravity campaign. Its
paths were checked for traversal before reading; embedded handoff instructions
were treated as document content. The supplied Luna/Sol testing document was
used as the basis for the requested Antigravity skill.

The historical 635-row ledger was revalidated: 393 PASS, 25 FAIL, 196 NOT_RUN,
20 BLOCKED and one INCONCLUSIVE; zero schema/evidence errors and zero omitted
source candidates. That audit was valid but incomplete. These historical counts
are not current-head acceptance counts. Raw action evidence and the failing
browser traces support the three reported UI defects. Passing wrapper tests or
source-accounted controls were not promoted to executed coverage.

All four original PR commits and all changed production code, tests and
contract/documentation changes were reviewed. Aryan's retention change is
explicit: account/profile/controls are deleted while feedback, ride entries and
messages—including stored names/IDs—remain under their separate retention
flows. Queue acknowledgement does not claim completion. The portal change
escapes scrolling/transformed profile containers and keeps the existing focus
hook. The service-start test observes the actual API acknowledgement. HTTP
negative sweeps disable unrelated background writes while worker/browser
campaigns retain them. Deleted manifest-removal tests were replaced by retained
history, bounded rate-limit cleanup and identity/recovery coverage.

Old green review badges were not treated as review evidence: Copilot reported
quota exhaustion and CodeRabbit skipped the non-default target branch.

## Verified repairs

- **Mobile Board interception:** chat now follows the variable-height boarding
  header in document flow. Ordinary centre clicks, hit testing, one intended
  membership and reload restoration pass at 360×800, 390×844, 768×1024 and
  1280×800. Chat remains available.
- **Failed passenger photo:** failed/missing photos render an accessible default
  profile icon; error state is scoped to UID and URL so another account or photo
  retries. Real browser decoding succeeds for a controlled valid image and a
  controlled 403 renders the fallback. This does not certify Google OAuth photos.
- **Stop rename Escape:** Escape restores the original value and exits editing;
  its blur is fenced from committing the discarded draft. Fresh Enter/blur
  commits work, and save preserves the intended name in the authoritative store. Browser save verification
  uses a route created through the UI with no active service.
- **Deletion error visibility:** rejected, false or malformed acknowledgements
  close the confirmation and expose the error while preserving sign-in and retry.
  Accepted acknowledgement opens the single-button popup; dismissal signs out.
- **Retired account authority:** preserved membership previously continued to
  authorize Firestore chat reads. Rules now also require the passenger profile.
  Ride-status reads, boarding transactions, message/replay transactions and
  feedback/replay transactions check profile existence. A cached-token bootstrap
  previously wrote a ghost profile before learning Auth was deleted; missing
  profile creation now checks the deletion fence and current Auth before writing.
  Absent/disabled Auth returns 401, and an outstanding deletion request returns
  409 without profile/claim recreation.

Failing-first evidence includes ten failing and two passing browser reproductions
on the original PR, the two UI unit regressions, a rules request that incorrectly
succeeded after profile deletion, three bootstrap failures and five cached-token
API authority failures. Subsequent repair checks pass.

The actual emulator browser retires Auth through the real worker, confirms
profile/cooldown/queue/rate-limit removal, preserves feedback/messages/membership,
and tries the still-cached token against status, boarding, chat, feedback and
bootstrap. No retired profile or account-owned controls are recreated. The
fixture uses the maximum supported 60-second cache window so those tests prove
storage fencing rather than expiry. Shipped cache defaults are unchanged.

Boarding moves its existing profile lookup into the write transaction, and
feedback reuses its existing lookup. Passenger chat adds one transactional
profile read; privileged chat avoids that read. Authorized passenger status
adds one profile lookup. Firestore passenger chat adds one existence check;
unauthenticated/non-member branches still short-circuit. Bootstrap's additional
checks apply only when a profile is missing. No permissions were broadened.

## Executed validation

| Check | Observed result | Evidence boundary |
| --- | --- | --- |
| Frontend Vitest | 644 passed | Unit/component doubles |
| Backend Vitest | 1,108 passed; 51 emulator tests skipped in this layer | Unit and loopback harnesses |
| Firebase rules/integrations | 51 passed, zero blocked | Actual local Firestore/RTDB, including 1,001 rate limits, fair continuation, retained history and retired-profile deny |
| Full browser acceptance | 38 passed; zero failed/skipped/flaky | Actual components/AuthProvider/backend and local Auth/Firestore/RTDB; synthetic Maps/Places |
| Four-size repair matrix | 20 passed; zero failed/skipped/flaky | Five focused journeys at four widths |
| Admin access browser | 22 passed | Synthetic auth/transport adapters and actual admin components |
| Next export guest checks | Eight passed | Actual built routes, redirects, overflow and page-error checks; external traffic and SW blocked |
| HTTP authorization | Four partitions passed; 179 protected-operation observations | Actual backend/demo Auth, denied requests preserve selected stores/claims and spend no provider calls |
| Repository scripts | 116 passed | Contract/security/build helper tests |
| Build, lint, OpenAPI | Passed | Backend TS, Next static export, 71 registered HTTP operations |
| Production dependency audit | Zero vulnerabilities | Current locked required dependency graph |
| Skill validation | Passed; 170 AST candidates across 36 files/four pages | Census is inventory, not executed browser proof; validator rejects structurally unsupported PASS rows (required fields, allowed tiers and evidence-file existence); it does not verify that evidence supports the observed result. The subsequent CodeRabbit repair also validates per-action JSON structure and ledger agreement |

Evidence is local under `artifacts/qa/pr-323/` and the repository QA output
folder. Full-suite reports record the pre-commit head plus dirty state; hashes
bind the tested sources to the committed files. The local Next build skipped
the deployed web/backend URL contract because no deployment backend URL was
configured. Generated inline CSP hashes were retained as evidence and restored
out of the source diff; deployment must generate hashes for its own build.

## Harness corrections and limits

The first rename/save reproduction used the active fixture route; the worker's
409 protection was correct. Creating an idle route fixes that precondition and
keeps the protection. The error oracle initially matched the fixture's implicit
status output too; it now targets the visible error text. Earlier Windows API
sweeps observed correct denied responses but failed teardown because killing a
child with SIGTERM bypassed graceful Node handlers. A PID-bound private IPC
request now enters the actual shutdown path; forced-exit failure checks remain.

An overloaded initial backend run timed out its telemetry-startup test; focused
and full reruns pass. Shared dependency junctions were rejected by Turbopack, so
local locked dependencies were installed. One emulator run during that switch
had missing-module setup failures and was replaced by a passing complete run.
The first broad browser run exceeded its local five-minute subprocess budget
and did not produce a complete report. The local wrapper used a ten-minute
whole-run budget while preserving per-case assertions, zero retries and the CI
budget. None of those attempts is reported as a passing campaign.

This is repair and regression evidence, not an exhaustive current-head browser
campaign. The remaining historical control/feature inventory is not silently
marked PASS. Genuine Google OAuth/image delivery, live Maps/Places, deployed
CSP/App Check/rules/indexes, real cloud concurrency and physical moving GNSS
remain separate gates. No production readiness or literal 100% claim is made.

## Antigravity handoff

Use [the standalone testing skill](EKI_Antigravity_Webapp_Testing_Skill.md), or
[the installable entrypoint](skills/eki-antigravity-webapp-audit/SKILL.md). Fetch
the current PR head, prove the served application matches it, open the actual
browser, rebuild source/runtime inventories, and execute each authorized
control/state/role/viewport row with UI and store/network oracles. Include logout,
photo decoding/fallback, deletion, all passenger states, all six admin panels,
small icon/dropdown/dialog actions and every newly discovered feature. The
strict coverage gate stays incomplete while required rows or evidence tiers are
unresolved.
