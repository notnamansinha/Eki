# Browser Reconnect and Access Recovery

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-021 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This document describes how the web app recovers its live RTDB data after a tab was hidden or the network dropped, how it spaces listener retries, and how it retries role verification after a transient outage. The rules limit forced reconnects without changing telemetry cadence, authorization or ride state.

## 2. Scope

The document covers the `useRTDBResume` hook, live-fleet listener retries in the shared live bus store, and access verification retries in `AuthProvider`. The Firebase SDK keeps its own automatic connection recovery [1]; the manual handshake described here is an addition, not a replacement. How passengers see a silent bus is described in the [browser telemetry trace](BROWSER_TELEMETRY_TRACE.md).

## 3. Behaviour

### 3.1 When a manual reconnect is scheduled

| Event | Effect |
|---|---|
| Tab hidden for less than 30 s, connection healthy | Nothing. The fleet cache and subscriptions are kept. |
| Tab hidden for 30 s or more (measured with `performance.now()`) | A manual reconnect is scheduled when the tab becomes visible. |
| `.info/connected` changes from `true` to `false`, or the browser fires `offline` | Data readiness closes and the live bus cache is invalidated once. A reconnect is scheduled; after `offline`, it is scheduled when the browser fires `online`. |
| First `.info/connected` value is `false` | Treated as initial connection, not a failure. Nothing is forced, and other subscribers keep their cache. |
| Browser fires `online` while the connection is healthy | Nothing. |

A reconnect is only scheduled while the page is visible and the browser reports online. Hiding the tab or going offline cancels a queued reconnect.

### 3.2 Manual handshake

A scheduled reconnect waits 1,000 to 1,500 ms (500 ms plus a 500 to 1,000 ms jittered delay); each new event restarts that wait. If the SDK reconnects on its own first, a handshake queued after a disconnection is cancelled; one queued after a 30 s suspension still runs. The handshake clears the live bus cache, increments the resume generation and calls `goOffline` then `goOnline` once. A 5 s cooldown follows: events inside the cooldown leave recovery to the SDK and do not queue another handshake for later. SDK connection callbacks still advance readiness during the cooldown.

The recovering state clears only when the connection is confirmed and an authoritative fleet snapshot has arrived. On unmount the hook detaches its observer, cancels its timers and ignores late callbacks.

### 3.3 Listener retry delays

Live-fleet listener retries use equal jitter: a random delay between half and all of an exponential ceiling that starts at 1 s and is capped at 30 s. The first retry waits 500 to 1,000 ms; from the sixth retry on, 15,000 to 30,000 ms. Each client draws independently. An invalid attempt count is treated as the first attempt, and an invalid random value uses the midpoint or is clamped. A delay is never zero and never above 30 s. An authoritative snapshot resets the attempt count, and the last subscriber leaving cancels the retry.

Browser timer throttling can delay any of these timers. Every callback rechecks visibility, online state and whether recovery is still needed before acting.

### 3.4 Access verification retries

`AuthProvider` verifies the signed-in user's role with fresh token claims, with a 10 s deadline. When verification fails with `auth/network-request-failed`, Firestore `unavailable` or `deadline-exceeded`, or the deadline, the identity and data-readiness gates stay closed and the provider retries after 1, 2, 4, 8, 16 and 30 s: at most six automatic retries per burst. Retries pause while the browser is offline or the tab is hidden. The next `online` or `visibilitychange` event to a visible page starts a fresh burst. A verified session does not reverify on these events. The **Try again** button stays available.

Manual and automatic retries share the current verification attempt and always force fresh trusted claims; a cached role, the Firestore profile or the bootstrap response alone never authorizes a driver or administrator. Permission denial, disabled or expired accounts and missing privileged claims are not retried. Account change, sign-out and unmount cancel queued work, and a late result from a timed-out attempt cannot restore an older role. The deadline cannot cancel the underlying Firebase promise; the finite retry burst bounds how many such calls are outstanding.

## 4. Configuration

None of these values is configurable at run time.

| Item | Value | Source |
|---|---|---|
| Minimum hidden time for a forced reconnect | 30 s | `frontend/src/hooks/useRTDBResume.ts:14` |
| Reconnect debounce | 500 ms plus the first retry delay | `frontend/src/hooks/useRTDBResume.ts:15`, `frontend/src/hooks/useRTDBResume.ts:73` |
| Handshake cooldown | 5 s | `frontend/src/hooks/useRTDBResume.ts:16` |
| Retry ceiling start and cap | 1 s, 30 s | `frontend/src/lib/liveBusRetry.ts:1`, `frontend/src/lib/liveBusRetry.ts:2` |
| Equal jitter | 50 % to 100 % of the ceiling | `frontend/src/lib/liveBusRetry.ts:14` |
| Role verification deadline | 10 s | `frontend/src/hooks/useAuth.ts:18` |
| Access retry delays | 1, 2, 4, 8, 16, 30 s | `frontend/src/hooks/useAuth.ts:20` |
| Transient error codes | `auth/network-request-failed`, `unavailable`, `deadline-exceeded`, deadline | `frontend/src/hooks/useAuth.ts:22` |

## 5. Failure modes and recovery

| Symptom | Cause | Action |
|---|---|---|
| Live data stays in the recovering state | No authoritative snapshot after reconnect, for example RTDB unreachable or rules denying the read | Check the browser console and network. The SDK keeps retrying; reload the page if the network is healthy. |
| "We could not verify your access" after an outage | Six automatic retries used up while the network was still down | Select **Try again**, or return to the tab once online. |
| "Your account is not permitted to verify this workspace" | Permission denied; not retried | Check the account's role and claims with an administrator. |

These are browser recovery bounds, not fleet capacity or latency targets.

## 6. Verification

| Behaviour | Tests |
|---|---|
| Suspension threshold, debounce, cooldown, network flaps, hidden and offline suppression, cleanup | `frontend/src/hooks/useRTDBResume.test.tsx`, `frontend/src/hooks/rtdbResumeState.test.ts` |
| Retry bounds and jitter, including 1,000 simulated clients | `frontend/src/lib/liveBusRetry.test.ts` |
| Store recovery and snapshot readiness | `frontend/src/lib/liveBusStoreRecovery.test.ts` |
| Access retries, fencing and fresh claims | `frontend/src/hooks/useAuth.test.tsx` |
| Long suspension with one debounced handshake, a ten-minute offline access failure recovered on `online` without protected reads or reload, offline and online flapping | `e2e/admin-access.spec.ts`, `e2e/admin-access/resilience.spec.ts` (`npm run test:e2e:admin`) |

The browser suites replace Firebase with a synthetic adapter. Real provider outages, deployed token revocation, phone suspension, installed-app behaviour and same-window connection and byte measurements need field evidence; the procedure is in [realtime transport measurements](REALTIME_TRANSPORT_MEASUREMENTS.md).

## 7. References

[1] Google, "Firebase JavaScript API reference: database, goOffline and goOnline," firebase.google.com/docs/reference/js/database. Accessed: 2026-10-30.
