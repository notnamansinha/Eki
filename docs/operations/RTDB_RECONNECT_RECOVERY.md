# RTDB browser reconnect gates and retry jitter

Last updated: 2026-10-06 00:35 IST (UTC+05:30).

R15 controls manual browser recovery without changing telemetry cadence,
authorization or ride state. The Firebase SDK retains its automatic persistent
connection/recovery behavior; see the
[official connection API](https://firebase.google.com/docs/reference/js/database#gooffline).

## Recovery rules

`useRTDBResume` treats a hidden interval of at least **30 seconds**, measured
with `performance.now()`, as meaningful suspension. A healthy shorter tab
switch preserves the fleet cache and subscription generations. An unrelated
browser `online` notification cannot force a healthy connection to restart.

A true-to-false `.info/connected` transition or browser `offline` event closes
the data-readiness state and invalidates the fleet once. Initial `.info=false`
is restoration, so it does not force a handshake or discard another active
subscriber's cache. Confirmed disconnection or meaningful suspension schedules
manual recovery only while the page is visible and the browser is online.

Requests debounce for **1,000–1,500 ms** (500 ms plus first-retry jitter).
Further recovery events reset that debounce window. Natural SDK recovery
cancels a pending disconnection handshake. Manual handshakes have a **5-second
cooldown**, clear the fleet cache, increment the resume generation, and call
`goOffline`/`goOnline` once. Connection confirmation and an authoritative fleet
snapshot are both required to clear the recovering state. Hidden/offline
events cancel queued handshakes; unmount detaches the observer, cancels timers
and fences late callbacks.

Events inside the manual cooldown leave recovery to the SDK; they do not
queue another forced handshake at cooldown expiry. SDK connection callbacks
still advance snapshot readiness during that interval. This limits forced
reconnect churn while retaining the SDK's normal network recovery.

## Retry bounds

Live-fleet listener retries use equal jitter over half of each capped
exponential window, independently for each attempt/client. They begin at
**500–1,000 ms** and reach **15,000–30,000 ms** at the cap. Invalid attempt counts
normalize to the first window. A malformed random sample uses the midpoint or
clamps into range. Delays never reach zero or exceed 30 seconds. An authoritative
snapshot resets the attempt count; the final subscriber leaving cancels retry.

These are browser recovery bounds, not fleet-wide capacity or latency targets.
Browser timer throttling can delay execution; callbacks recheck visibility,
online state and whether recovery is still needed before issuing a handshake.

## Regression evidence and remaining acceptance

Three failing baseline cases reproduced the healthy short-tab reconnect,
unnecessary online-event reconnect and immediate un-debounced resume. The
focused hook/state/retry/store suite passes 25 cases, including natural SDK
recovery, network flaps, hidden/offline suppression, snapshot readiness and
cleanup. A deterministic 1,000-client scheduling fixture produces distinct
bounded delays; it does not measure 1,000 real sockets.

The actual resume hook, active-bus hook and shared fleet store also run in the
mobile/desktop browser suite against synthetic SDK transport. A short tab
switch keeps visible fleet data with unchanged read/handshake counts. A long
suspension issues one delayed handshake and receives a fresh fleet snapshot.
All 16 browser cases pass, including the existing admin permission recovery.

#245 retains real-network/PWA/long-suspension acceptance and same-window
connection/byte/latency measurements. Browser checks can be run stationary
without ESP32/GNSS. Actual GNSS-to-screen latency and moving-route acceptance
require appropriate live hardware; this software evidence cannot certify them.
