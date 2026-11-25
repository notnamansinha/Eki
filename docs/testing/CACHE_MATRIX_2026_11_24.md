# Hosting Cache Matrix: 24 November 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-065 | 1.0 | Historical | 2026-11-24 |

First runs of the [Hosting cache and CDN matrix](../../qa/CACHE_MATRIX.md) for [issue #520](https://github.com/notnamansinha/Eki/issues/520): two loopback replays of a local static export and two read-only live runs against the staging Hosting site. The live site served the release of commit `6c47e727`. Invalidation after a deploy was not observed, because no Hosting release happened during the runs (Section 7).

## 1. Setup

| Item | Value |
|---|---|
| Harness commit | `512934e9` on branch `feat/520-cdn-cache-matrix`, `dirty: false` for runs L-A, L-B and V-2 |
| Host | Windows 11 Home 10.0.26200, Node v26.13.1 (CI uses Node 24) |
| Export | `npm run build:production` with the placeholder variables of the CI `Strict production build` step, at the frontend of `a35e6d6c`; build ID `5b871a889e98b51df9f1e0b765ed8064`. `git checkout -- firebase.json` after each build |
| Build workaround | The worktree's `node_modules` is a link to another checkout, which Turbopack refuses; both builds set `NEXT_PRIVATE_OUTPUT_TRACE_ROOT=C:\Users` |
| Live origins | `https://bustrack-be165.web.app` (primary), `https://bustrack-be165.firebaseapp.com` (alias) |
| Live bounds | GET only, 63 requests a run (bound 80), at least 300 ms apart, `User-Agent: Eki-QA-cache-matrix/1.0 (read-only GET; issue 520)`, no credentials other than the dummies |
| Point of presence | `X-Served-By` named only `cache-bom-*` nodes (Mumbai) in both live runs |

## 2. Live revision

The revision was named with the method of PR #548: the `Last-Modified` of `/` against the Deploy workflow runs.

| Reading | Value |
|---|---|
| `Last-Modified` of `/` | `Fri, 20 Nov 2026 11:59:57 GMT`, the same on all 57 responses of run V-2 that carried one |
| Deploy run | [44731924203](https://github.com/notnamansinha/Eki/actions/runs/44731924203), head `6c47e727`, conclusion success. Its `Deploy to staging (hosting + rules)` step ran from 11:59:48Z to 11:59:57Z |
| Previous Hosting release | Run 44731052957 (also `6c47e727`), Hosting step completed 11:53:17Z |
| Head of `main` | `a35e6d6c`; its Deploy runs were skipped, so it is not live |
| Build ID served | `92a2baf73b636ae20b054dc5a0ca539d` |
| `sw.js` SHA-256 served | `c0a0f1550dc0d7365c68b446cd53ce708801806b0e82cffa1214630d8787673e` |
| `firebase.json` | Identical at `6c47e727` and `a35e6d6c` (`git diff 6c47e727 a35e6d6c -- firebase.json` is empty), so the expectations derived from the harness checkout apply to the live release |

## 3. Runs

| Run | Mode | Commit, dirty | Started (UTC) | Requests | Verdict |
|---|---|---|---|---|---|
| V-1 | Live | `a35e6d6c` with the uncommitted harness, `true` | 2026-11-23 19:26:19 | 63 | `FAIL` with the evaluator of that moment |
| L-A | Local, first export | `512934e9`, `false` | 2026-11-23 19:35:26 | 27 | `PASS`, 4 findings |
| V-2 | Live | `512934e9`, `false` | 2026-11-23 19:35:34 to 19:36:11 | 63 | `PASS`, 5 findings |
| L-B | Local, export rebuilt from an empty `frontend/out` and `frontend/.next` | `512934e9`, `false` | 2026-11-23 19:38:24 | 27 | `PASS`, 4 findings |

Run V-1 failed every row on the `Strict-Transport-Security` value and failed `conditional` on `/`. Both are recorded as findings F1 and F3. The harness was changed before commit `512934e9`: a different value of a configured header other than `Cache-Control` is now a finding (a missing one still fails), and a 200 answer to a conditional request is a finding when the response is `no-store`. Evaluated with the committed code, V-1's observations give `PASS` with the same findings as V-2. In total the live runs sent 126 GET requests.

## 4. Live matrix (run V-2)

| Path | Class | Status | `Cache-Control` served | Expected, from | `X-Cache` (hits) first, repeat | Result |
|---|---|---|---|---|---|---|
| `/` | document | 200 | `no-cache, no-store, must-revalidate` | Same, `firebase.json` | MISS (0), MISS (0) | PASS |
| `/admin` | document | 200 | `no-cache, no-store, must-revalidate` | Same, `firebase.json` | MISS (0), MISS (0) | PASS |
| `/feedback` | document | 200 | `no-cache, no-store, must-revalidate` | Same, `firebase.json` | MISS (0), MISS (0) | PASS |
| `/install` | document | 200 | `no-cache, no-store, must-revalidate` | Same, `firebase.json` | MISS (0), MISS (0) | PASS |
| `/passenger` | document | 200 | `no-cache, no-store, must-revalidate` | Same, `firebase.json` | MISS (0), MISS (0) | PASS |
| `/_next/static/chunks/3fywkcelkvqsx.js` | next-static | 200 | `public, max-age=31536000, immutable` | Same, `firebase.json` | HIT (0), HIT (1) | PASS |
| `/_next/static/chunks/3o5j1433uzyyz.css` | next-static | 200 | `public, max-age=31536000, immutable` | Same, `firebase.json` | HIT (0), HIT (1) | PASS |
| `/_next/static/media/9d036f80216c14ee-s.p.3u4lli0-axodc.woff2` | next-static | 200 | `public, max-age=31536000, immutable` | Same, `firebase.json` | HIT (0), HIT (1) | PASS |
| `/icon.png` | image | 200 | `public, max-age=2592000, stale-while-revalidate=86400` | Same, `firebase.json` | HIT (0), HIT (1) | PASS |
| `/images/bus-background-landscape-trees-1672.webp` | image | 200 | `public, max-age=2592000, stale-while-revalidate=86400` | Same, `firebase.json` | HIT (0), HIT (1) | PASS |
| `/google-g.svg` | image | 200 | `public, max-age=2592000, stale-while-revalidate=86400` | Same, `firebase.json` | HIT (0), HIT (1) | PASS |
| `/images/hero-background.jpg` | image | 200 | `public, max-age=2592000, stale-while-revalidate=86400` | Same, `firebase.json` | HIT (0), HIT (1) | PASS |
| `/sw.js` | service-worker | 200 | `no-cache, no-store, must-revalidate` | Same, `firebase.json` | MISS (0), MISS (0) | PASS |
| `/manifest.webmanifest` | manifest | 200 | `max-age=3600` | Same, Hosting default | HIT (0), HIT (1) | PASS |
| `/robots.txt` | robots | 200 | `max-age=3600` | Same, Hosting default | HIT (0), HIT (1) | PASS |
| `/sitemap.xml` | sitemap | 200 | `max-age=3600` | Same, Hosting default | HIT (0), HIT (1) | PASS |
| `/index.txt` | rsc-payload | 200 | `max-age=3600` | Same, Hosting default | HIT (0), HIT (1) | PASS |
| `/404` | internal-document | 200 | `max-age=3600` | Same, Hosting default | HIT (0), HIT (1) | WARN (F2) |
| `/_not-found` | internal-document | 200 | `max-age=3600` | Same, Hosting default | HIT (0), HIT (1) | WARN (F2) |
| `/eki-cache-matrix-no-such-page` | not-found | 404 | `no-cache, no-store, must-revalidate` | Same, `firebase.json` rule `/404.html` | MISS (0), MISS (0) | PASS |
| `/admin.html` | redirect | 301 to `/admin` | `no-cache, no-store, must-revalidate` | 301 to `/admin` (`cleanUrls`) | MISS (0) | PASS |
| `/admin/` | redirect | 301 to `/admin` | `no-cache, no-store, must-revalidate` | 301 to `/admin` (`trailingSlash: false`) | MISS (0) | PASS |

The cacheable assets were already `HIT` on their first request of V-2, nine minutes after V-1 had requested them. `/robots.txt` and `/sitemap.xml` were `HIT` on their first request of V-1.

| Check | V-2 result |
|---|---|
| `cache-policy-by-class` | PASS for 18 paths; WARN for `/404` and `/_not-found` (F2) |
| `configured-headers` | WARN: all 20 content paths carry a different HSTS value (F1); every other header that `firebase.json` sets is present with its value, and the CSP is present |
| `not-found` | PASS: 404 with `no-cache, no-store, must-revalidate` on both hosts, body identical to `/404` |
| `redirects` | PASS |
| `no-set-cookie` | PASS: none of the 63 responses set a cookie |
| `auth-invariance` | PASS: Section 5 |
| `build-consistency` | PASS: 17 document responses, one build ID |
| `conditional` | WARN (F3). `If-None-Match` and `If-Modified-Since` returned 304 for the JavaScript chunk and for `/icon.png` (4 of 4); both returned 200 for `/` |
| `range` | PASS: `Range: bytes=0-99` on the chunk returned 206, 100 bytes, `Content-Range: bytes 0-99/14218` |
| `compression` | PASS. `/`: identity 15853 B, `br` 3871 B, `gzip` 4628 B. Chunk: identity 14218 B, `br` 3403 B, `gzip` 3922 B. Each decoded body equals the identity body; every response has `Vary: x-fh-requested-host, accept-encoding` |
| `cdn-cache` | PASS: the 5 documents, `sw.js` and the 404 were `MISS` on both requests; 7 of 7 repeated requests for cacheable classes were `HIT` |
| `alias` | PASS: `/`, `/sw.js`, the chunk and the 404 match the primary host in status and `Cache-Control`, and the three 200 bodies match. The 404 bodies also had the same SHA-256 (read from the report; the check compares 200 bodies only) |

No response of either live run carried an `Age` header. `X-Cache` and `X-Cache-Hits` were the only cache signals (F5).

## 5. Per-user isolation

| Premise ([runbook Section 3.4](../../qa/CACHE_MATRIX.md#34-per-user-isolation)) | Observation |
|---|---|
| No redirect or backend rewrite matches a document path | `firebase.json` has no `redirects` and no `rewrites` |
| Documents are the same with and without credentials | The 5 documents on `web.app` and `/` on `firebaseapp.com`, requested with `Authorization: Bearer eki-cache-matrix-dummy` and `Cookie: __session=eki-cache-matrix-dummy`, had the same status and the same body SHA-256 as without them, in V-1 and V-2 |
| No document sets a cookie or varies on credentials | No `Set-Cookie`; `Vary` was `x-fh-requested-host, accept-encoding` on every document |

The CDN also did not hold any document: every document request in both runs was `MISS`. No response that one user could receive depends on who asked, so no cached HTML can disclose another user's data on this release. Two signed-in sessions were not used.

## 6. Local matrix (runs L-A and L-B)

Both local runs requested the same 22 rows as the live matrix, plus the document requests with dummy credentials; the chunk, stylesheet and font paths came from the local export, whose file names differ from the live build. Every row had the status, `Cache-Control` and result of the live row. The replay sends no `ETag`, `X-Cache` or `Age`, and serves the configured HSTS value, so `configured-headers` passed. L-B rebuilt the export from empty folders and gave the same build ID, the same `sw.js` SHA-256 (`5ca0a5bb2ca49baea68a1f8d4a87cd7ee3a6368d8db1a1042753d7d9dc2cdec0`) and the same rows as L-A. The replay derives the redirect headers from `firebase.json`: `max-age=3600` for `/admin.html`, which no rule matches, and `no-cache, no-store, must-revalidate` for `/admin/`; the redirect headers are not compared. `conditional`, `range`, `compression`, `cdn-cache` and `alias` reported `LIVE_ONLY`.

`export-coverage` classified 132 of the 187 exported files (the 55 source maps are not classified): 5 documents, 19 images, 2 internal documents, 1 manifest, 78 `/_next/static` files, 1 `robots.txt`, 24 flight data files, 1 `sw.js`, 1 `sitemap.xml`. No page or `sw.js` missed its requirement. Findings F2 and F4 came from this check.

## 7. Findings

| ID | Finding | Effect | Suggested action |
|---|---|---|---|
| F1 | Hosting serves `Strict-Transport-Security: max-age=31556926; includeSubDomains; preload` on its 200, 206 and 404 responses instead of the configured `max-age=31536000; includeSubDomains`. The two 301 redirects carry the configured value; 304 responses carry none | None for caching. The served policy is longer and preloaded | Read it again on a custom domain, where the configured value may apply |
| F2 | `/404` and `/_not-found` serve the 404 page HTML with status 200 and the Hosting default `max-age=3600`, and the CDN serves them as `HIT` | Low. A browser that opens these URLs directly may keep HTML that names one build's chunks for up to an hour after a release | Add `404` and `_not-found` to the document `no-store` rule, or accept |
| F3 | `/` serves an `ETag` and a `Last-Modified` but answers 200 to `If-None-Match` and `If-Modified-Since` | None. The response is `no-store`, so a browser never stores it and never revalidates it | None |
| F4 | `/_next/static/media/icon.*.png` and `apple-icon.*.png` match both `/_next/static/**` and the later image rule, which wins, so they would get 30 days instead of a year and `immutable` | None today: no page references them; the pages reference `/icon.png` and `/apple-icon.png` | Put the image rule before `/_next/static/**` if these files become referenced |
| F5 | Hosting sends no `Age` header | The after-deploy comparison uses the release stamp in `Last-Modified` instead of `Age` | Implemented in `age-reset` |
| F6 | `gzip` responses carry the same strong `ETag` as the identity response; `br` responses append `-br` | None observed: both decode to the same bytes | None |

## 8. Not done

- **Invalidation after a deploy.** `npm run qa:cache:compare` and its checks are implemented and tested on fixtures, but no Hosting release happened between the runs. Comparing V-1 with V-2 returned `NOT_A_NEW_RELEASE`, as expected for one release. The procedure is in [runbook Section 4.3](../../qa/CACHE_MATRIX.md#43-after-a-deploy); it needs a release that changes a frontend build input (issue #504).
- **Other points of presence.** Only Mumbai nodes answered.
- **Two signed-in users.** Isolation rests on the premises in Section 5.
