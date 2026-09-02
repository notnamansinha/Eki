## Audit #112 findings addressed — rebased onto current main

Rebased onto `16c0c17` (includes the merged `passenger_requests` removal from PR #111 — the branch keeps only the explanatory comment, no client rule block).

**The blocker — auth before the billable `get()`**
- `canReadSession()` no longer binds `let session = sessionDoc(sessionId)` eagerly. It now short-circuits: `isAdmin()` first, then `if (!isAuthenticated()) return false;`, and only then performs the single session fetch for authorized reads.
- `isSessionOperator()` already evaluated `isAuthenticated()` before its lookup — now asserted by a regression test too.
- Preserved: exactly one `get()` in the whole rules file (the shared `sessionDoc` helper), no `getAfter()`, no write-path gets, backend-authoritative write denials, and the explicit catch-all deny.

**Tests**
- New regression test `evaluates authentication before the session fetch (audit #112)`: asserts both read helpers place `isAuthenticated()` before any `sessionDoc()` and that the helper does not bind the session pre-auth.
- Existing cost-bound tests still pass unchanged (one `get()`, no `getAfter()`, ownership short-circuit before the session fetch for rate-limit reads).

**Verification run (local)**
- Backend: 204 passed, 7 skipped
- Lint: clean
- `npm run build`: success (strict build + CSP regeneration)

Note: App Check ordering (`isAppChecked()` before `sessionDoc()`) is enforced by PR #113's ruleset, which builds on top of this branch's single-fetch helpers; the conditional audit item ("if App Check is enforced in this change") does not apply to this branch, which does not introduce App Check.
