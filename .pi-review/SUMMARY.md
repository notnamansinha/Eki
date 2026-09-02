# Eki — 14-PR Parallel Review Summary

Reviewed by 14 independent reviewer agents (one per PR, fresh context, read-only) against `main`.
Diffs/descriptions: `.pi-review/pr-<n>.diff` / `.pi-review/pr-<n>.body.md`. Full reports are in the review transcript.

## Verdicts

| PR | Title | Verdict | Top issues |
|----|-------|---------|------------|
| 91 | fail closed on role verification | ✅ APPROVE | MINOR: no verification timeout (infinite spinner offline); dead-end error screen (no sign-out); zero tests |
| 92 | centralize API timeouts and errors | 💬 COMMENT | **MAJOR: `AbortSignal.any` breaks Safari <17.4/Chrome <116 — every migrated call throws**; missing error-path tests; 8 call sites still on raw fetch |
| 93 | defer service worker activation during shifts | ❌ REQUEST CHANGES | **MAJOR x3: multi-tab last-writer-wins can reload a live shift; stuck `checking` state blocks updates forever; zero tests** |
| 94 | throttle smooth marker renders | ✅ APPROVE | MINOR: no tests; `durationMs < 50` jumps to final; pre-existing rAF cleanup race |
| 95 | hard-gate fleet security configuration | ❌ REQUEST CHANGES | **MAJOR: preflight validates only `sdkconfig.defaults`; compile gate backstops only 4 of 9 protections → 5 can silently weaken via effective-config drift** |
| 96 | remove unsafe polish fallbacks | ❌ REQUEST CHANGES | **MAJOR: `targetStop!` can be null after fallback removal → tracking view crashes on geometry-less routes (no error boundary)**; speed-only glitch rejects whole fix; ArduinoJson 7.4.3-dependent truncation guards |
| 97 | remove cross-core TinyGPSPlus race | ✅ APPROVE | Race structurally eliminated; NIT: ownership enforced by comment only; snapshot untested |
| 98 | protect RTC telemetry queue integrity | ✅ APPROVE | Checksum commit order airtight; MINOR: only one corruption point tested, test count claim 23 vs 22 found |
| 99 | reject stale GNSS quality fields | ❌ REQUEST CHANGES | **MAJOR: zero test coverage — native tests don't even compile main.cpp**; whole-fix rejection cascades into "fix lost" path on stale speed/course |
| 100 | recover terminal live bus listener errors | ❌ REQUEST CHANGES | **MAJOR x2: retry unbounded in attempts (contradicts "bounded" claim); store-level recovery logic entirely untested** |
| 101 | retry failed remote diagnostics | ✅ APPROVE | Correct 2xx-only recording + 5–60s backoff, 401/403 latch preserved; NIT: no jitter (fleet-synchronized retry waves), no circuit breaker |
| 102 | align retry retention with freshness | ✅ APPROVE | Freshness math verified (all-ms, int64-safe, strict `<`); MINOR: future-timestamp samples dropped though backend accepts +10s |
| 103 | preserve telemetry time beyond 2038 | ✅ APPROVE | Wrap math verified by hand; MINOR: 49.7-day projection ambiguity with no fresh GNSS reference; TLS post-2038 limit documented |
| 104 | make dev script cross-platform | ✅ APPROVE | Minimal, correct; lockfile clean; NIT: no CI smoke for both shells |

**Tally: 8 APPROVE · 1 COMMENT · 5 REQUEST CHANGES**

## Cross-cutting observations

- **Testing gap is the recurring theme**: PRs 91, 94, 97, 99, 100 ship security- or timing-critical logic with no tests; several hardware PRs change `main.cpp` which the native test env (`test_build_src = no`) never compiles — CI passing does not validate the changed lines.
- **Merge-conflict cluster**: 8 PRs touch `hardware/src/main.cpp` (95, 96, 97, 98, 99, 101, 102, 103); PRs 96/98/101/102/103 touch `telemetry_policy.h`/`test_telemetry_policy`. Expect mechanical conflicts; re-verify after each merge.
- **Working-tree noise**: local `backend/package.json` + `package-lock.json` are modified but belong to no reviewed PR.
- Two reviewers independently flagged the same semantics question on hardware (99 & 96): rejecting a whole fix on a speed-only glitch routes through the "GPS signal lost" path and emits speed-0 uncertain samples downstream.

## Suggested merge order (deps/conflict-aware)

1. 104, 94, 97, 101, 102, 103, 98 (approve-clean, low risk)
2. 91 (approve; consider the timeout/sign-out minors first)
3. 92 (fix `AbortSignal.any` baseline or accept + document)
4. 99, 100, 95, 96, 93 (REQUEST CHANGES — resolve majors before merge)
