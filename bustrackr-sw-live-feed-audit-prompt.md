# BusTrackr — Service Worker & Live-Feed Integrity Audit

## Role
You are auditing the service worker implementation of BusTrackr, a real-time GPS bus tracking PWA (Next.js frontend, Firebase backend, ESP32/GNSS hardware feed). Do not assume the SW is correctly configured just because it registers. The failure mode that matters most here is silent: the SW serves a cached response for a "live" bus, the UI renders it with no visual distinction from real-time data, and the user boards or waits based on stale information. Flag anything that could produce this, even if it's an edge case.

## Objective
Determine whether the service worker is (a) actually active and controlling the page, and (b) configured so that no live-tracking data path can be served from cache without the UI clearly indicating staleness.

## Scope

### 1. Registration & Lifecycle Sanity Check
- Confirm SW registers successfully in production build (not just dev) — check `navigator.serviceWorker.register()` call site, scope, and that it's not silently failing (wrapped in try/catch that swallows errors).
- Confirm registration file is actually served (correct MIME type, correct path relative to scope — a SW at `/sw.js` cannot control paths outside root scope).
- Check activation: `skipWaiting()` and `clients.claim()` — are they present? If absent, confirm this is intentional (old SW controls tab until reload) and not an oversight.
- Confirm HTTPS is enforced in all environments where SW is expected to run (SW silently no-ops on non-secure origins other than localhost).

### 2. Caching Strategy Segmentation — CRITICAL
List every route/pattern the SW's fetch handler intercepts, and classify each as one of:
- **Static/immutable assets** (JS/CSS/fonts/icons) — cache-first is fine.
- **App shell / HTML** — stale-while-revalidate or network-first, acceptable.
- **Live bus position/status API or Firebase REST/RTDB calls** — must be **network-only** or **network-first with a very short/no fallback cache**. Flag any instance where these are cache-first, stale-while-revalidate with no expiry, or accidentally caught by a catch-all pattern (e.g., a wildcard `/api/*` cache rule that unintentionally includes `/api/live-position`).
- Report the exact matching pattern (regex/URL match) for each cached route and which strategy applies. If using Workbox, dump the `runtimeCaching` config verbatim and annotate each entry.
- Explicitly check for a catch-all `NetworkOnly` vs `NetworkFirst` distinction on any endpoint whose name suggests live/real-time/position/status/eta.

### 3. Firebase Realtime Interaction
- Firebase RTDB/Firestore listeners typically use WebSocket or long-polling, which service workers cannot meaningfully cache — confirm this is actually how live data reaches the client, not a periodic REST poll that could be intercepted.
- If there IS a REST fallback (e.g., for ESP32 device status polling), confirm the SW's fetch handler does not intercept it, or if it does, confirm strategy is network-only.
- Check for any `postMessage` or `BroadcastChannel` usage between SW and client that could be relaying data — verify no live payload is being cached in an `IndexedDB`/Cache Storage layer used by the SW.

### 4. Offline / Degraded State UX
- When network is unavailable, what does the "live bus" screen actually render? Reproduce this: throttle network to offline in DevTools, observe behavior.
- Is there an explicit UI state for "no live data available" vs silently showing the last-known cached position as if current? This is the single most important check — a cached pin with no "last updated Xm ago" or "connection lost" indicator is a correctness bug, not just a caching nitpick.
- Confirm timestamps are attached to any position data currently rendered, and that the UI compares timestamp freshness before labeling something "Live."
- **Flaky/degraded connection is a required test, not an optional one.** Full "Offline" throttling and a dead network are not the same failure mode as a slow/lossy one. Any route with a `networkTimeoutSeconds` fallback is specifically vulnerable to connections that are alive but slow — that's the scenario most likely to actually trigger a stale-cache serve in production. Test with DevTools "Slow 3G" and a custom profile with added latency/packet loss, not just Offline. Report this as a separate repro entry, distinct from the full-offline test — do not substitute one for the other.
- Does the app flicker between live and stale states cleanly, or get stuck showing outdated data with a "Live" badge still active during reconnect?

### 4b. Threshold & Cross-Surface Consistency
- If multiple UI elements independently decide "is this data stale" (e.g. a per-item "signal lost" banner vs. a global "Live" badge vs. a connection-status indicator), confirm they read from the **same defined constant/threshold**, not separately hardcoded magic numbers in different files. Two independently-tuned staleness checks can silently drift out of sync, creating a window where one part of the UI says "live" and another says "lost."
- Enumerate every surface in the app that consumes the same live-data source (passenger view, driver/operator view, admin/ops dashboard, any embed or public status page). Confirm the caching and staleness-indication audit above was applied to **each one**, not just the primary user-facing page — a fix applied to one view does not imply the others are safe.

### 5. Update & Version Skew
- Confirm the app detects and prompts for new SW versions rather than silently running stale app logic against a changed API contract (this was flagged as prior work — verify it's actually wired end-to-end, not just implemented and never triggered).
- Check `updateViaCache` setting on registration — should not be `'all'` if the SW script itself needs to be re-fetched reliably.
- Verify cache versioning: old cache names are purged on activate (`caches.keys()` + delete stale versions), so a deployed fix to live-data caching logic can't be undermined by a lingering old cache still being read.

### 6. Manifest & Installability (secondary, but relevant to PWA scoring)
- Confirm `manifest.json` is linked, valid, and Lighthouse PWA installability checks pass.
- Not the priority for this audit — only flag if broken.

## Required Output Format
Produce a findings table:

| # | Area | Finding | Severity (Critical/High/Med/Low) | Evidence (file:line) | Fix |
|---|------|---------|-----------------------------------|------------------------|-----|

Severity guide specific to this app:
- **Critical — currently exploitable**: any path where stale bus position/status CAN and DOES render indistinguishable from live data under a realistic, reproducible condition today.
- **Critical — latent**: the logic is wrong and would produce the same outcome as above, but current behavior happens to be masked by something else (e.g. a second condition that always evaluates true in practice). State explicitly why it's currently masked and what change would unmask it. Do not merge this with the tier above — a reader triaging under time pressure needs to know which bugs are live now versus one dependency change away from live.
- **High**: SW update mechanism broken (users stuck on old logic indefinitely), OR a connectivity-loss state with zero user-facing indication (even if it doesn't show *incorrect* data, showing *no signal that data is missing* is close to equally bad for a live-tracking app — weigh frequency of occurrence, not just theoretical severity, when choosing between High and Critical).
- **Medium**: offline state exists but UX doesn't clearly communicate staleness.
- **Low**: manifest/installability/Lighthouse cosmetic issues.

When a proposed fix modifies a matcher/condition that other findings also touch (e.g. two findings both point at the same route-matching logic), do not describe the fix in prose only — provide the actual diff for that block once, covering all findings against it together. Precedence and matcher bugs are exactly the kind of thing that get re-broken by a fix described but not shown.

Then include a short **Reproduction Log** section: for each Critical/High finding, the exact steps you took to trigger it (network throttle settings, route hit, observed response), so it can be re-verified after a fix without re-deriving your reasoning. Full-offline and degraded/flaky-network repro steps are not interchangeable — include both where §4 applies.

Do not mark anything "resolved" or "not an issue" without stating what you checked to reach that conclusion — assume the previous auditor's assumptions were wrong at least once.

## Post-Fix Verification Pass
When this prompt is run again after fixes have been applied, do not re-derive findings from scratch. Instead:
1. Re-run the exact reproduction steps from the prior audit's Reproduction Log for every Critical/High finding.
2. Report pass/fail against each one specifically, quoting the prior finding number.
3. Confirm the fix for one finding didn't reintroduce or shift risk into an adjacent one (e.g. tightening a route matcher can change which requests fall into the catch-all default handler — re-check §2's full route table, not just the changed line).
4. Only after all prior findings are confirmed fixed, proceed to a fresh pass of the full scope for anything new.
