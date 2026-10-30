# Reviewed HTTP policy sub-oracles

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-TST-010 | 1.0 | Historical | 2026-10-12 |

The reviewed L1 family now includes real loopback Express routes with contract-
checked HTTP responses, controlled clocks and mocked authentication/datastores.
`qa/http-unit-test-map.mjs` records twenty-five limited case scopes. They merge
with previous scopes without turning mocked storage into emulator evidence.

Seven new literal regressions establish independent boundary vectors:

- Feedback cooldown: 24 hours minus/exact/plus one millisecond; rejected feedback
  leaves the prior cooldown and records unchanged, with a bounded retry hint.
- Ride ratings: 1/5 accepted without comment; 0/6/fraction/string and no rating
  with an empty comment rejected without mutation.
- General feedback: 199/200/201 words and 1999/2000/2001 characters, with rejected
  submissions leaving feedback/cooldown unchanged.
- Both settings aliases: 64/200/300/500 text limits below/exact/above, required
  nonblank strings and allowed blank announcement. Existing string preservation
  policy remains intact; the tests do not introduce trimming.
- Both settings aliases: strict true/false values; strings, numbers and null
  rejected without changing the saved fields.
- Chat helper: literal three-second, ten-per-minute and sixty-per-hour window
  boundaries at one millisecond adjacency, including retry timing.
- Both chat aliases: 201 create, 200 identical replay and 409 changed payload;
  new sends after completion rejected while exact previous replay stays stable.
  No second message or rate write occurs in the mocked transaction.

Existing reviewed tests supply narrow bootstrap/claim protection, immutable
membership/status responses, feedback projection/status updates, privacy queue
acceptance/recovery, and frozen independent moderation examples. Parameterized
observations are retained by position; ambiguous names stay unclaimed.

These checks do not prove real concurrent Firestore serialization, revocation
propagation, deployed App Check, cross-replica quotas, mounted listener recovery
or cloud privacy deletion. They remain L1 PARTIAL, alongside separate L2 emulator
and L3 Chromium observations. HTTP response checks use real handlers and the
published contract; authentication/datastore mocks are explicit in every link.

On 12 October 2026, the expanded local selection passed 315/315 assertions across
thirteen backend and ten frontend files, with no skipped/blocked observations.
The targeted new-test files passed 69/69. A temporary cooldown comparison change
from `<` to `<=` produced 21 passes and the new exact-boundary failure across 22
feedback tests. The original source was restored and all 22 passed again. No
production behavior change is committed. Clean hosted evidence remains required.

Run `npm ci` followed by `npm run qa:unit:reviewed`. The existing two sequential
workspace deadlines (120 seconds each), one worker, exact file census and Node
socket/DNS guard remain in force. Reports are retained under
`artifacts/qa/reviewedUnit-*`; no real accounts, provider requests or GNSS hardware
are used.
