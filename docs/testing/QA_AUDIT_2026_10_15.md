# Eki Transit — Comprehensive QA Audit Report

**Date**: 2026-10-15
**Branch**: `codex/passenger-account-deletion`
**URL**: `localhost:3000`

## Remediation — 2026-10-15

All 25 findings reviewed against the source:

- **1–7, 9–13, 15, 18–20, 22, 24–25:** fixed profile accessibility, stale deletion errors, feedback validation and guest access, sign-in readiness/fallback, navigation, overflow, unused swipe API, tracking spacing, boarding-code guidance, data-gap recovery, styling, compact cards, reconnect stacking, and redirect recovery.
- **8:** completion now returns tracking to Routes after the existing 10-second feedback delay; browsing Profile is preserved. The previous delay cleared completion state without navigating away.
- **14:** the shared bottom sheet already leaves a 56px header and drag handle visible above navigation. Made the collapsed CSS calculation explicit and retained keyboard access.
- **16:** already protected: `PASSENGER_BUS_START_TIME` trims the environment value and defaults to `8:00 am`.
- **17:** the fallback button already had `type="button"`; added it to the primary sign-in and account action buttons as well.
- **21:** added the root viewport export with `viewportFit: "cover"`.
- **23:** `transition-colors` already covers inline color changes; used explicit `transition-[color]` and the warning color token for clarity.

Regression coverage includes sign-in fallback and stalled redirects, stale deletion errors, guest feedback access, empty ride feedback, repeated Routes taps, Back with chat open, live-data recovery, completion dismissal, and pasting formatted boarding codes.

---

## 🔴 Critical Issues

### 1. Profile image container has no accessible label

**File**: `frontend/src/components/passenger/AccountTab.tsx` (lines 72–87)

The profile photo renders with `alt=""` and `aria-hidden="true"`. The fallback `<CircleUserRound>` icon that replaces it on error also has no label. The parent container has no `aria-label`, so screen readers get zero indication this is the user's profile picture.

**Fix**: Add `aria-label="Profile photo"` to the outer `w-20 h-20` container div.

---

### 2. Stale deletion error message persists after re-opening the delete modal

**File**: `frontend/src/components/passenger/AccountTab.tsx` (lines 156–170)

If the deletion API call fails, `deletionStatus` is set to an error string. Closing and re-opening the Delete Account modal shows the old error because `setDeletionStatus("")` is never called when the modal is re-opened.

**Reproduction**: Trigger a failed deletion → close modal → re-open Delete modal → stale error is still rendered below the action list.

**Fix**: Call `setDeletionStatus("")` inside the Delete Account button's `onClick` handler.

---

### 3. Ride feedback submit silently fails with no user-facing error

**File**: `frontend/src/components/shared/FeedbackModal.tsx` (line 93)

```ts
if (!comment.trim() && rating === 0 && busId) return;
```

For ride feedback with no comment AND no rating, `handleSubmit` silently returns. The user clicks "Submit Feedback" and nothing happens — no error, no animation.

**Fix**: Replace the silent `return` with:
```ts
setError("Please add a rating or comment before submitting.");
return;
```

---

## 🟠 High Priority Issues

### 4. "Continue with full-page Google sign-in" link always visible after Firebase loads

**File**: `frontend/src/app/page.tsx` (lines 129–137)

The redirect fallback link renders whenever `loginReady` is true, which happens ~1–2 seconds after page load. Every user sees two sign-in options by default. The intent was to show it only after a popup failure.

`AccountTab.tsx` correctly gates this on `loginFallbackAvailable` — the landing page does not.

**Fix**: Change:
```tsx
{loginReady && (
```
to:
```tsx
{loginReady && loginFallbackAvailable && (
```

---

### 5. Sign In button grayed out for several seconds on first load

**File**: `frontend/src/app/page.tsx` (line 122)

```tsx
disabled={loginLoading || loading || !loginReady}
```

The `loading` flag stays `true` until Firebase auth fully resolves (up to 8 seconds). This keeps the button visually inactive longer than needed. The `!loginReady` guard already prevents premature clicks.

**Fix**: Remove `loading` from the disabled condition:
```tsx
disabled={loginLoading || !loginReady}
```

---

### 6. Back button while messaging panel is open navigates away instead of dismissing the panel

**File**: `frontend/src/components/passenger/PassengerWorkspace.tsx` (lines 542–552)

The back arrow calls `setCurrentView("home")` unconditionally. If `isMessagingOpen` is true, the expected UX is for the chat panel to close first — not the entire tracking view to disappear.

**Fix**: Add before the view change:
```ts
if (isMessagingOpen) {
  setIsMessagingOpen(false);
  return;
}
```

---

### 7. Routes nav tab button has confusing toggle behavior

**File**: `frontend/src/components/passenger/PassengerWorkspace.tsx` (lines 749–770)

- On **tracking view** → goes to home ✅
- On **home view** → goes to tracking if `activeRoute` exists 🔴 (unexpected)

A user on the home route list who taps "Routes" again expects to stay on home (or scroll to top) — not be taken to the tracking view.

---

### 8. "Route ended" screen has no auto-dismiss — user can be stuck indefinitely

**File**: `frontend/src/components/passenger/PassengerWorkspace.tsx` (lines 693–723)

The "Route ended / Waiting for next bus" overlay persists until the user manually taps "Return to Routes". There is no timeout. A user who pockets their phone remains on this blank screen indefinitely.

**Fix**: Add an auto-dismiss timer (e.g., 30–60 seconds) that calls `setCurrentView("home")`.

---

### 9. Guest users can open Feedback modal, write a message, then fail to submit

**File**: `frontend/src/components/passenger/AccountTab.tsx` (lines 121–137)

"Send Feedback" is visible and clickable for unauthenticated guests. The modal only throws `"User must be logged in"` at submission time — after the user has already composed their message.

**Fix**: Either:
- Hide the button when `!user`, or
- Show an inline sign-in prompt at the top of the modal when the user is not authenticated.

---

## 🟡 Medium Priority Issues

### 10. Announcement banner has no overflow protection on narrow screens

**File**: `frontend/src/components/passenger/PassengerWorkspace.tsx` (lines 486–495)

Long announcement text (`font-black tracking-wider uppercase`) has no `line-clamp` or max-length enforcement. On 320px screens it can wrap awkwardly.

**Fix**: Add `line-clamp-3` to the announcement `<p>` element.

---

### 11. `onSwipe` prop in RouteCarousel is declared but never used

**File**: `frontend/src/components/passenger/ui/RouteCarousel.tsx` (line 11)

```ts
onSwipe?: (id: string) => void;
```

This prop is destructured and never used. The component also has no swipe behavior — it's a vertical list. The name "Carousel" is a misnomer.

---

### 12. Tracking view top bar double-stacks safe area padding on notched phones

**File**: `frontend/src/components/passenger/PassengerWorkspace.tsx` (line 541)

The tracking top bar container uses `pt-12` (48px) inside a parent that already applies `pt-safe`. On notched devices this stacks on top of the safe-area inset and pushes content too far down.

---

### 13. Boarding code input has no format hint and silently strips spaces/hyphens

**File**: `frontend/src/components/passenger/PassengerBoardingView.tsx` (lines 258–272)

`normalizeCode` strips spaces and hyphens silently. If a driver shows the code as `ABCD-EFGH`, pasting it yields the correct `ABCDEFGH`, but users see no indication this is happening.

**Fix**: Update placeholder from `"DRIVER CODE"` to `"8-CHAR CODE"` and add a helper text below the input.

---

### 14. Route Timeline bottom sheet — not discoverable on first tracking entry

**File**: `frontend/src/components/passenger/RouteTimelineSheet.tsx` (lines 31–39)

The sheet starts fully closed with no visible drag handle or peeking content. First-time users will miss the route timeline entirely.

---

### 15. Tracking view silently snaps back to home on momentary bus data loss

**File**: `frontend/src/components/passenger/PassengerWorkspace.tsx` (lines 325–326)

```ts
const visibleView = currentView === "tracking" && !activeBusOnRouteId && !endedMessage ? "home" : currentView;
```

If the active bus momentarily disappears from RTDB (network blip), `activeBusOnRouteId` goes falsy and the user's tracking view silently switches to home. This can feel like the app crashed.

---

### 16. Empty state fallback text `"Service starts at {time}"` could render literally

**File**: `frontend/src/components/passenger/PassengerWorkspace.tsx` (line 526)

```ts
(settings.noBusesSubMessage || "Service starts at {time}").replace("{time}", settings.serviceStartTime || PASSENGER_BUS_START_TIME)
```

If `PASSENGER_BUS_START_TIME` is an empty string or undefined, users see the literal placeholder `{time}`. Verify the constant has a fallback value.

---

## 🟢 Low Priority / Nitpicks

### 17. Missing `type="button"` on "Continue with full-page sign-in" link

**File**: `frontend/src/app/page.tsx` (lines 130–136)
Low risk but good practice — add `type="button"` to all `<button>` elements that aren't form submits.

---

### 18. Role badge hardcodes blue instead of using the orange accent design token

**File**: `frontend/src/components/passenger/AccountTab.tsx` (lines 97–99)

```tsx
background: "rgba(59, 130, 246, 0.10)",
color: "#60A5FA",
```

Brand accent is `--accent: #FA5D29` (warm orange). The hardcoded blue is inconsistent.

---

### 19. "Send Feedback" has a `<ChevronRight>` — Sign Out / Delete Account do not

**File**: `frontend/src/components/passenger/AccountTab.tsx` (lines 135–136)

All three action rows should have consistent right-side affordances. Currently "Send Feedback" implies navigation (chevron), while the more destructive actions do not.

---

### 20. Footer `uppercase` + `tracking-widest` on `©` symbol looks slightly off

**File**: `frontend/src/app/page.tsx` (line 146)

`© 2026 Eki Transit` renders as `© 2026 EKI TRANSIT`. AccountTab shows `Eki Transit · v3.0` in mixed case. Minor brand inconsistency.

---

### 21. `pt-safe` has no effect without `viewport-fit=cover` in the meta viewport

**File**: `frontend/src/components/passenger/AccountTab.tsx` (line 65)

`env(safe-area-inset-top)` resolves to `0` without `viewport-fit=cover` in the root `<meta>` tag. Verify the root layout includes this.

---

### 22. Route cards fixed at `min-h-[170px]` — heavy scrolling with 5+ routes

**File**: `frontend/src/components/passenger/ui/RouteCarousel.tsx` (line 56)

170px × 5 routes = 850px minimum scroll. Consider reducing to 130–140px or making height adaptive based on content.

---

### 23. Word counter color transition may not animate — `transition-colors` vs `transition-[color]`

**File**: `frontend/src/components/shared/FeedbackModal.tsx` (line 311)

The ghost → amber color change at word limit uses `className="transition-colors"`. Depending on the Tailwind version, this may not animate inline `style` color changes. Use CSS variable colors instead.

---

### 24. Reconnection banner at `z-50` — hidden behind modals at `z-[999]`

**File**: `frontend/src/components/passenger/PassengerWorkspace.tsx` (lines 411–419)

"Reconnecting to live bus data..." is a critical status indicator. At `z-50`, it's invisible when FeedbackModal (`z-[999]`) or ConfirmModal is open.

**Fix**: Bump the reconnection banner to `z-[9999]`.

---

### 25. "Opening your workspace…" spinner has no escape hatch if redirect hangs

**File**: `frontend/src/app/page.tsx` (lines 55–63)

If `router.replace()` stalls (e.g., network issue in a PWA), users are stuck indefinitely on the loading spinner with no way out.

**Fix**: Add a 10-second timeout with a "Try reloading" link.

---

## ✅ What Looks Great

| Area | Notes |
|------|-------|
| Auth error handling | Covers App Check, role claim sync, permission-denied, and timeouts — each with actionable messages |
| Offline resilience | WifiOff banner, visibility + online/offline event listeners, abort controllers everywhere |
| Race condition prevention | Auth generation tracking, `isCurrentAuth()` guards, `boardingRevisionRef` |
| FeedbackModal | Client + server-side cooldown, idempotency via `requestId`, word limit with auto-trim |
| Ride recovery | `joinedRidePointer` survives page refreshes; session mismatch detection clears stale pointers |
| Profile image fallback | `onError` + `useEffect` reset on `photoURL` change is clean and correct |
| `prefers-reduced-motion` | Fully honored in `globals.css` |
| Focus ring | `focus-visible` ring with accent color — keyboard navigation works |
| `pb-32` bottom padding | Correctly accounts for bottom nav height in all scrollable areas |
| Post-ride feedback delay | 10-second delay before prompting gives users time to settle |

---

## 🐛 Expected Console Messages (unauthenticated)

| Message | Cause |
|---------|-------|
| Firebase auth restoration timed out (8s warning) | Normal if emulators not running |
| App Check token failure | ReCaptcha not configured for localhost |
| `NEXT_PUBLIC_BACKEND_URL` missing | Backend calls skipped silently |
| Google popup blocked | Browser popup blocker on sign-in click |

---

## 📋 Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 3 |
| 🟠 High | 6 |
| 🟡 Medium | 7 |
| 🟢 Low / Nitpick | 9 |
| **Total** | **25** |
