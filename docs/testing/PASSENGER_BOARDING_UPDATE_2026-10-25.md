# Passenger boarding and CodeRabbit follow-up — 25 October 2026

Passenger boarding no longer displays, requests or validates an eight-character driver code. A passenger chooses boarding and destination stops, then presses Board. Verified identity/profile, ordered route-owned stops, fresh session-bound bus position, location accuracy and the existing 150 m first-boarding limit remain enforced. Existing members can correct stops without acquiring location again; session changes and membership removal still invalidate that exception. Browser location remains client supplied, rather than independent proof of physical presence.

Both the legacy join and v2 passenger endpoint accept requests without a code. OpenAPI reflects that contract. The private operator code endpoint remains for compatibility with older clients; those codes are no longer passenger boarding credentials. The former wrong-code browser oracle was removed from the current acceptance mapping rather than claimed as passing under the new policy.

CodeRabbit's unresolved [confirmed-progress finding](https://github.com/notnamansinha/Eki/pull/381#discussion_r4371260109) was reproduced independently. Missing, NaN, infinite, negative or out-of-leg match distances no longer erase a previously confirmed partial leg. Retained sections remain visible during uncertainty and subsequent detours. Authoritative next-stop changes, session changes and geometry changes still replace or clear that retained state. This is one bounded cache per route renderer.

Validation:

- Red tests reproduced code-required HTTP 400 responses for both API variants, the passenger code field, and lost confirmed progress. They passed after implementation.
- Full primary suite: 159 script, 1,275 backend and 788 frontend tests, totaling 2,222 passed. A subsequent 82-test focused group covers the completed progress-retention change and passenger/map regressions.
- Actual Auth/Firestore/RTDB emulator browser suite: 44 passed, including code-free request bodies, one durable passenger membership, distant-location rejection and reload restoration. Protected HTTP suite: eight passed.
- Passenger progress: ten passed, including a confident partial leg followed by uncertainty, pending detour, ready detour and configured rejoin in both viewports. The test waits for the initial confident match before recording its baseline.
- Phone layout: nine passed. Lint, 71-operation OpenAPI verification, acceptance mappings, changed-source coverage budget and strict production build with service worker/CSP verification passed.

These are software checks in controlled fixtures. This update does not merge or deploy the PR, replace real GNSS coordinates, or close the road-test and broader release gates recorded in the historical movement audit. Local evidence is retained under `artifacts/qa/boarding-code-removal/` in the isolated audit worktree.
