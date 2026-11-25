# Hosting Cache and CDN Matrix

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-TST-017 | 1.0 | Current | 2026-11-25 |

## 1. Purpose

`npm run qa:cache` and `npm run qa:cache:live` check how Firebase Hosting caches the web app: the `Cache-Control` each class of path receives, the 404 answer, redirects, cookies, conditional and range requests, compression, CDN hits and per-user isolation. `npm run qa:cache:compare` checks that a Hosting release replaced every cached copy of the previous one.

Every expected header value, status and redirect is derived from the `hosting` block of [`firebase.json`](../firebase.json) when the run starts: its header rules, redirects, rewrites, `cleanUrls` and `trailingSlash`. No expected value is copied into the harness. The path classes and their requirements (Section 3.1) are the harness's own definitions, deliberately independent of `firebase.json`, so a gap in `firebase.json` shows as a failure or a finding. [`scripts/qa/cache-matrix.mjs`](../scripts/qa/cache-matrix.mjs) holds the derivation, the plan, the evaluator and the before/after comparison; [`scripts/qa/run-cache-matrix.mjs`](../scripts/qa/run-cache-matrix.mjs) sends the requests and writes the reports.

| Mode | Command | Target |
|---|---|---|
| Local | `npm run qa:cache` | A loopback replay of the static export `frontend/out` on `127.0.0.1:20520` ([`scripts/qa/hosting-replay.mjs`](../scripts/qa/hosting-replay.mjs)) |
| Live | `npm run qa:cache:live` | The staging Hosting site `https://bustrack-be165.web.app` and its alias `https://bustrack-be165.firebaseapp.com`, read only |
| After deploy | `npm run qa:cache:compare -- <before.json> <after.json>` | Two live reports; sends nothing |

## 2. Prerequisites

| Item | Local | Live |
|---|---|---|
| Node | 24 (CI version) | 24 |
| Export | `frontend/out`, from `npm run build:production` with the placeholder variables of the `Strict production build` step in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), or from `npm run build` | Not needed |
| Checkout | Clean, so the report records `dirty: false`. The CSP hashes that the build writes into `firebase.json` do not count; the report lists them in `ignoredChanges` | Clean |
| Network | Loopback only | HTTPS to the two staging Hosting origins. No credentials, no backend, no Firebase API |

## 3. Scope

### 3.1 Path classes

A run requests one or more paths of each class. Documents come from the `page.tsx` files under `frontend/src/app`; assets come from the HTML of `/`, so a live run follows the release that is actually served.

| Class | Paths | Header rule in `firebase.json` today | Requirement independent of `firebase.json` |
|---|---|---|---|
| `document` | Every page route; today `/`, `/admin`, `/feedback`, `/install` and `/passenger` | `/{,admin,feedback,install,passenger}` | `no-store`: the HTML names the chunks of one build |
| `next-static` | The first JavaScript, CSS and `.woff2` file that `/` references | `/_next/static/**` | `public`, `immutable`, `max-age` of at least one year |
| `image` | One file per extension: those `/` references, then `frontend/public`. The class also covers `.gif` and `.avif`, which the rule omits, so such a file gets the Hosting default and is reported | `**/*.@(png\|jpg\|jpeg\|webp\|svg\|ico)` | `public` and a positive `max-age` |
| `service-worker` | `/sw.js` | `/sw.js` | `no-store` and `Service-Worker-Allowed: /` |
| `manifest`, `robots`, `sitemap` | `/manifest.webmanifest`, `/robots.txt`, `/sitemap.xml` | None: the Hosting default of one hour [1] | None |
| `rsc-payload` | `/index.txt`, the flight data that client navigation fetches | None: the Hosting default | None: the Next.js router performs a full page load when a payload names another build ID (`next/dist/client/components/router-reducer/fetch-server-response.js`) |
| `internal-document` | `/404` and `/_not-found`, which the export also serves with status 200 | None: the Hosting default | `no-store`, reported as a finding |
| `not-found` | `/eki-cache-matrix-no-such-page` | `/404.html`, then the requested path (Section 3.2) | Status 404 and `no-store` |
| `redirect` | `/admin.html` (`cleanUrls`), `/admin/` (`trailingSlash: false`) and every redirect with a literal `source` | Not compared | 301 to `/admin`, or the configured destination |

### 3.2 Derivation rules

1. Hosting matches each header rule's `source` glob (with extglob) or `regex` against the requested path, and applies matching rules in file order [1]. A later rule replaces an earlier rule's value for the same header.
2. For the custom 404 page, rules that match `404.html` apply first and rules that match the requested path apply after them [1].
3. A path with no `Cache-Control` rule gets the Hosting default `max-age=3600` [1].
4. Routing follows the Hosting priority order: reserved `/__/` paths, redirects, exact static files (with `cleanUrls` and `trailingSlash`), rewrites, the custom 404 page [1].

`export-coverage` (local only) applies these rules to every file of the export, not only to the sampled paths. It fails when a page or `sw.js` misses its requirement, so a new page added without a `no-store` rule fails; every other miss is a finding. [`scripts/qa-cache-matrix.test.mjs`](../scripts/qa-cache-matrix.test.mjs) runs the same check for the page routes and sample assets in `npm test`, without a build.

### 3.3 Checks

| Check | Local | Live | Passes when |
|---|---|---|---|
| `cache-policy-by-class` | Yes | Yes | Status and `Cache-Control` directives equal the derived ones, and the class requirement holds |
| `configured-headers` | Yes | Yes | Every other header that `firebase.json` sets is present. A different value is a finding, because Hosting may replace a header on its own domains. The CSP changes with every build, so only its presence counts |
| `not-found` | Yes | Yes | The missing path answers 404 with `no-store` |
| `redirects` | Yes | Yes | Status 301 and the expected `Location` |
| `no-set-cookie` | Yes | Yes | No storable response (without `no-store` or `private`) sets a cookie |
| `auth-invariance` | Yes | Yes | Section 3.4 |
| `build-consistency` | Yes | Yes | Every document response carries the build ID of `/` |
| `conditional` | No (`LIVE_ONLY`) | Yes | `If-None-Match` and `If-Modified-Since` return 304 wherever a storable response serves an `ETag` or `Last-Modified`. A 200 for a `no-store` response is a finding: a browser does not store that response, so it never revalidates it [3] |
| `range` | No (`LIVE_ONLY`) | Yes | `Range: bytes=0-99` on a JavaScript chunk returns 206, 100 bytes and `Content-Range: bytes 0-99/<size>` |
| `compression` | No (`LIVE_ONLY`) | Yes | `Accept-Encoding: br` and `gzip` each return that `Content-Encoding`, `Vary` names `Accept-Encoding`, and the decoded body equals the uncompressed one (for `/` and a chunk) |
| `cdn-cache` | No (`LIVE_ONLY`) | Yes | No document, 404 or `sw.js` response shows `X-Cache: HIT` or a positive `Age`, on the first or the repeated request. Hits on repeated requests for cacheable classes are counted |
| `alias` | No (`LIVE_ONLY`) | Yes | The `firebaseapp.com` alias returns the same status and `Cache-Control` as the primary host for `/`, `/sw.js`, a chunk and the 404, and the same body for each 200 |
| `export-coverage` | Yes | No (`LOCAL_ONLY`) | Section 3.2 |

The loopback replay does not model the CDN or Hosting's validators: it sends no `ETag`, `Last-Modified`, `Age` or `X-Cache` and ignores `Range` and `Accept-Encoding`. Those checks report `LIVE_ONLY` locally instead of passing.

### 3.4 Per-user isolation

The claim is that the CDN cannot serve one user's HTML to another user, because no HTML response depends on who asked. It rests on three premises, each checked by `auth-invariance`:

1. Hosting answers each document path from a static file of the release, and no redirect or backend rewrite in `firebase.json` matches a document path. Static files take priority over rewrites [1].
2. Hosting runs no code for static content and removes every cookie except `__session`, which only reaches backend rewrites [2]. The check requests every document with and without a dummy `Authorization: Bearer` header and a dummy `__session` cookie, on both hosts, and compares the decoded bodies byte for byte.
3. No document response sets a cookie or names `Cookie` or `Authorization` in `Vary`.

Personal data reaches the browser only through the Firebase SDKs and the backend API on its own origin, never through these paths. If all three premises hold, a cache entry keyed on a document URL holds the same bytes for every user, so sharing it discloses nothing. Separately, `cdn-cache` shows that the CDN does not hold documents at all. A future rewrite of a page to a backend, or a page that reads `__session`, breaks premise 1 or 2 and fails the check.

## 4. Procedure

### 4.1 Local run

Run from the repository root.

1. Build the export with the placeholder variables of the CI `Strict production build` step, then run `npm run build:production`, or run `npm run build`. Expected: `frontend/out/index.html` exists.
2. Run `git checkout -- firebase.json`. Expected: `git status --short` prints nothing.
3. Run `npm run qa:cache`. Expected: in about 1 s, `local cache matrix: WARN` and `artifacts/qa/cache-matrix-local-report.md`, exit code 0. With today's `firebase.json` the findings are `/404` and `/_not-found` (Hosting default) and the two `/_next/static/media` icons; a run without findings says `PASS`.

### 4.2 Live run

1. Run `npm run qa:cache:live`. Expected: in about 25 s, `live cache matrix: WARN` and `artifacts/qa/cache-matrix-live-report.md`, exit code 0. The findings of 23 November were the replaced HSTS value, `/404` and `/_not-found`, and the 200 answer to conditional requests for `/`.
2. Name the revision it measured. Read `Last-Modified of /` in the report, list the Deploy runs with `gh run list --workflow deploy.yml --repo notnamansinha/Eki --status success`, and read the Hosting step time of the candidate run with `gh run view <run-id> --repo notnamansinha/Eki --json jobs`. Expected: the `Deploy to staging (hosting + rules)` step of one run completed at that second; its head commit is the live revision.
3. Attach both report files to the tracking issue.

### 4.3 After a deploy

The comparison needs a Hosting release that changes a frontend build input. A deploy that changes only backend files keeps the same build ID, because `frontend/next.config.ts` derives the ID from the frontend inputs, and the comparison reports `NO_FRONTEND_CHANGE`.

1. Before the deploy, run `npm run qa:cache:live`, then `Copy-Item artifacts/qa/cache-matrix-live-report.json artifacts/qa/cache-matrix-before.json`.
2. Merge the change to `main` and wait until the Deploy run's `Deploy to staging (hosting + rules)` step has succeeded.
3. Run `npm run qa:cache:live` again.
4. Run `npm run qa:cache:compare -- artifacts/qa/cache-matrix-before.json artifacts/qa/cache-matrix-live-report.json`. Expected: verdict `INVALIDATED` in `artifacts/qa/cache-matrix-compare-report.md`.

| Comparison check | Passes when |
|---|---|
| `new-release` | The build ID changed, or `Last-Modified` of `/` is later than before. Neither gives `NOT_A_NEW_RELEASE` |
| `new-build-id` | The build ID changed; unchanged is a finding and gives `NO_FRONTEND_CHANGE` |
| `new-service-worker` | `sw.js` changed whenever the build ID changed |
| `no-stale-html` | No HTML response after the deploy, on any path, variant or host, carries the old build ID, and all carry one ID |
| `age-reset` | Never fails; reports findings. Every response is compared with the `Last-Modified` of `/`, and any `Age` with the time since that stamp. On the one release measured (23 November), all 57 stamped responses carried the second at which the Hosting deploy step completed, and Hosting sent no `Age`. That Hosting re-stamps every file at each release is not proven, so a different stamp is a finding until a measured deploy settles it. The verdict rests on `no-stale-html` and `new-service-worker` |

## 5. Bounds and evidence

The live mode is the only part that leaves the machine. It does not run through the [safety preflight](README.md#5-safety-boundary), because it targets a deployed site.

| Bound | Value |
|---|---|
| Origins | `https://bustrack-be165.web.app` and `https://bustrack-be165.firebaseapp.com` only (`LIVE_ORIGINS`); `--origin` may pick which is primary |
| Requests | GET only, at most 80 a run (63 with the current export), at least 300 ms apart, 15 s timeout each |
| Identity | `User-Agent: Eki-QA-cache-matrix/1.0 (read-only GET; issue 520)`. No real credential: the only `Authorization` and cookie values are the dummies in `DUMMY_CREDENTIALS` |
| Cache busting | None: no query strings. Each content path is requested twice, the second time after the other probes |

| File | Content |
|---|---|
| `artifacts/qa/cache-matrix-<mode>-report.json` | Commit, dirty flag and `ignoredChanges`, `firebase.json` hash, target, bounds, plan, identity (build ID, `sw.js` SHA-256, `ETag` and `Last-Modified` of `/`, `X-Served-By` values), the matrix rows, checks and sanitized observations |
| `artifacts/qa/cache-matrix-<mode>-report.md` | The same as tables, with every failure and finding |

Observations keep a fixed list of response headers, cut to printable ASCII and 300 characters. Bodies are kept only as a length and a SHA-256 of the decoded bytes. `Set-Cookie` and CSP values are never stored, only their presence.

| Verdict | Exit code | Meaning |
|---|---|---|
| `PASS` | 0 | No check failed and none reported a finding |
| `WARN` | 0 | No check failed; at least one check reported findings, each listed in the report |
| `FAIL` | 1 | At least one check failed |
| `BLOCKED` | 1 | The run could not start or finish; `setupError` names the step |
| `INVALIDATED` | 0 | Comparison: a new release and build, and no stale copy |
| `STALE`, `NO_FRONTEND_CHANGE`, `NOT_A_NEW_RELEASE` | 1 | Comparison: Section 4.3 |

The first runs are recorded in [Hosting cache matrix, 24 November](../docs/testing/CACHE_MATRIX_2026_11_24.md).

## 6. Troubleshooting

| Symptom | Action |
|---|---|
| `frontend/out/index.html is missing` | Build the export (Section 4.1, step 1) |
| `listen EADDRINUSE` | Pick another loopback port from 20000 to 20999: `npm run qa:cache -- --port 20521` |
| `Could not find the Next.js package` during the build, in a Git worktree whose `node_modules` links to another checkout | Turbopack refuses files outside its root. Set `NEXT_PRIVATE_OUTPUT_TRACE_ROOT` to a folder that contains both checkouts for that build only |
| Live run `BLOCKED` with `GET / answered <status>` | The site is unavailable or redirects; check it in a browser and retry later |

## 7. Limits

- The local replay applies the same derivation that the checks use. A local pass shows that the export and `firebase.json` agree; it does not show what Hosting does.
- A live run sees the CDN point of presence that serves the runner's network, named in `X-Served-By`. Other points of presence are not observed, so one run is a matrix for one point of presence, not per point of presence.
- Isolation is shown with dummy credentials and the premises in Section 3.4, not with two signed-in users.
- The comparison needs a deploy (issue #504). Until one is measured, invalidation after a release is not shown.

## 8. References

[1] Firebase, "Configure Hosting behavior," firebase.google.com/docs/hosting/full-config. Accessed: 2026-11-24.

[2] Firebase, "Manage cache behavior," firebase.google.com/docs/hosting/manage-cache. Accessed: 2026-11-24.

[3] R. Fielding, M. Nottingham and J. Reschke, "HTTP Caching," RFC 9111, IETF, 2022.
