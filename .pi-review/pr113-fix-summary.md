## Audit #113 findings addressed — rebased onto post-PR-#111 main

Rebased onto `16c0c17` (Merge PR #111) and reworked per the audit + CodeRabbit:

**Rules (firestore.rules)**
- Removed the `passenger_requests` client surface entirely (merged removal from #111 preserved on rebase).
- Every client-facing `allow` now evaluates `isAppChecked()` FIRST, before auth and any session lookup.
- `isSessionOperator` / `isSessionPassenger` short-circuit authentication before `sessionDoc()` — a denied unauthenticated read never evaluates the billable `get()`. Exactly one `get()` remains (the shared helper); no `getAfter()`.
- Multi-branch allows are parenthesized (no `&&`/`||` precedence bypass).

**Tests (securityConfig.test.ts)**
- Universal scan: every non-`false` allow predicate must start with `isAppChecked() && `.
- Precedence scan rejects any top-level `||` after the gate.
- Rule-ordering assertions (auth before `sessionDoc`) and exact one-`get()` / no-`getAfter()` cost guards.
- Deploy workflow assertions for the hardened gating.

**Emulator rules flow**
- `scripts/rules-for-emulator.mjs` writes App Check-free copies + a temp `firebase.json` into a fresh OS temp dir; committed rule files are never rewritten.
- New `scripts/run-rules-emulator.mjs` runs `emulators:exec` against the temp config (cross-platform spawn; Windows spawns node + npm's npx CLI so the quoted script arg survives). `test:rules` and the CI step both use it.

**deploy.yml hardening (CodeRabbit)**
- `workflow_run` deploys require `conclusion == 'success'` AND `event == 'push'` AND `head_branch == 'main'` AND same-repository.
- Checkout uses `workflow_run.head_sha` for workflow_run events.
- Manual staging and production dispatches both require `github.ref == 'refs/heads/main'`.

**Verification run (local)**
- `node --test scripts/*.test.mjs`: 10/10 pass
- Backend: 201 passed, 7 skipped
- Frontend: 98 passed
- Lint: clean (root + workspaces)
- `npm run build`: success (strict build + CSP regeneration)
- Emulator rules suite: runner verified up to emulator boot (needs Java — not installed locally; CI runs it)

Note: staging/production Firebase projects, secrets, App Check attestation keys, and the protected `production` environment still need to be configured in the repo settings before any deploy job can pass — that is repo-level setup, not code.
