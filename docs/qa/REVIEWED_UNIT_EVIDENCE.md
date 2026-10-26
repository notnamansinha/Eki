# Reviewed unit sub-oracles

Last updated: 2026-10-21 11:47 IST (UTC+05:30).

`npm run qa:unit:reviewed` executes forty-five reviewed backend/frontend files and
records exact JSON/JUnit identities, source SHA, dirty state and timestamps. The
current selection includes 26 backend and 19 frontend files. Use the generated
report for exact assertion counts. Every assertion
must pass without skip/block; missing files or workspace reports block the scope.
The Node socket/DNS guard is preloaded before SDK imports. Unit dependencies are
pure, mocked, loopback Express or actual React/jsdom components/hooks; real OAuth/Firebase/provider/browser
behavior is not claimed.

Explicit feature mappings cover limited sub-oracles for auth cache and
readiness, legacy operator-code formatting and current boarding accuracy/trusted-fix/order, trip reducer/shutdown,
privacy queue recovery, passenger ride identity, directional views/cache,
feedback eligibility and history interaction. Each link was compared with its
source oracle and assertion body; titles alone do not establish applicability.
Parameterized observations are retained in the complete counts, while mappings
use reviewed literal identities. The earlier BOARD07 parameterized MUSE mappings
remain retained and distinct; this scope uses a new explicit clock/binding test
rather than guessing dynamic titles.

Vitest can retain a literal `%p` template on every parameter row. The collector
records each observed row's contiguous array position without inferring parameter
values. The ledger requires those positions and still rejects ambiguous title
matches for a case link. Initial hosted runs passed 114 tests but correctly blocked
aggregation because these repeated template titles were not unique. The positional
record preserves all observations while leaving unreviewed parameter rows unmapped.

The component selection adds actual AuthProvider/useAuth, PassengerBoardingView,
PassengerWorkspace restoration and FeedbackModal. Assertions exercise mounted
state, selectors, close/Escape, permission denial, late GPS/token/HTTP callbacks,
sign-out/account transitions, membership verification and stable feedback retry
IDs. SDK/Auth/App Check, HTTP and GPS are mocked. Workspace map and boarding
children are replaced; the boarding workflow file separately mounts the real
selector. The preparation-budget file substitutes a native select and controls
the clock. These are L1 component sub-oracles, not Chromium, real permissions,
durable membership or deployed provider acceptance.

The [reviewed HTTP policy selection](HTTP_UNIT_EVIDENCE.md) adds exact feedback,
settings and chat boundary regressions and scoped bootstrap/membership/privacy
route checks. Sixty-two case scopes combine all current reviewed-unit links.
Responses use actual Express handlers with mocked auth/storage; they retain L1
classification and do not certify real datastore transaction or provider behavior.

New boarding tests establish exact -60000/+10000 millisecond trust boundaries,
bus/route/session binding, offline/terminal refusal, accuracy 0..100 inclusive
and approved eight-character code normalization. They do not weaken production
behavior or replace server-side transactional checks.

The mock Auth verifier tests establish cache/coalescing/expiry/fresh privileged
verification policy, not deployed Firebase revocation propagation. Mock privacy
storage establishes bounded scheduling, recovery generations and refusal of
operator/changed identities, not cloud deletion outcomes. The native-like pure
trip reducer establishes ordered transitions, not worker persistence or field
progression. Pure frontend history/eligibility/cache helpers do not establish
mounted listener cleanup, real PWA/offline behavior or a complete UI control.

The selection joins the current-source ledger as a separate L1 family and the
nightly matrix as a sixth bounded shard. Existing full backend/frontend tests
still run in Production verification; their aggregate historical count is not
silently imported as acceptance for unmapped cases. Successful observations
remain PARTIAL and keep the remaining complete source oracle visible.

## Reproduce

```sh
npm ci
npm run qa:unit:reviewed
```

Node 24 and locked dependencies are required; no Java, browser or credentials
are needed for this narrow selection. Results are under
`artifacts/qa/reviewedUnit-*`. Each workspace child has a two-minute deadline,
one worker and no file parallelism. The combined runner refuses a mismatched
file census or absent assertion evidence.

The expanded local changed-checkout run on 12 October 2026 passed 315/315 assertions
with zero skips/blocks. That run verifies harness configuration and limited
oracles; a clean hosted commit is needed for current-source acceptance. Software
release and physical field deployment remain unverified.

The 21 October promotion review adds direct links for worker fencing,
retention/CLI/Firebase adapter, fleet cache/mutex, stop history, diagnostic
counters/SDK wiring, Auth initialization/domain, marker tracing, joined-status
transport and live-store expiry/recovery/normalization. These remain scoped L1
checks with SDK/datastore/RAF mocks. The initial changed-checkout selection passed
547 assertions; the contributor's merged selection records 549 observations.
Use the final clean hosted results for promotion.
