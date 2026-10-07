# Passenger boarding request budgets

Last updated: 2026-10-06 00:35 IST (UTC+05:30).

R23 separates preparation from the HTTP request in the passenger boarding
view. First boarding acquires an Auth token and browser position in parallel,
each with a ten-second deadline. The join request then receives its own full
ten-second API budget. Nine seconds spent obtaining a position or token no
longer leave just one second for the backend to acknowledge the join.

Location permission denial, unavailable position, and acquisition timeout
produce distinct messages. Existing passengers may still correct their stops
without another GPS prompt. Backend boarding codes, accuracy, proximity,
freshness and stop-order rules are unchanged.

A ref prevents duplicate preparation from clicks batched before the disabled
button renders. Unmount and session changes cancel preparation and HTTP work;
late results cannot start a join, update state or announce success for a former
session. A different session resets remembered membership so first boarding
requires location again. The captured Auth User object and verification
generation are checked before request and result publication, including
same-UID sign-out/sign-in and access re-verification. Normal token refresh
retains its principal. Cancellation fences browser callbacks; the native geolocation
API and Firebase token promise cannot themselves be interrupted.

## Regression and acceptance checks

The initial focused run reproduced nine failures in ten new cases before the
fix; four additional same-UID principal/verification cases reproduced stale
publication during independent review. The resulting 26-case boarding suite
includes existing interaction tests
and new controlled-clock cases covering nine-second GPS/token acquisition,
the full HTTP budget, distinct location failures, never-settled preparation,
same-render duplicate clicks, unmount, session replacement, late HTTP replies
and GPS-free existing-member correction followed by fresh-session boarding,
same-UID principal replacement/re-verification and late preparation failures.
It uses synthetic SDK/HTTP transport and does not prove physical proximity or
the actual device/browser location quality.

For localhost acceptance, use a disposable armed test session and a valid
driver-issued code. Select boarding/destination stops, allow location, and
confirm **On board** only after the backend acknowledgement. Repeat with
location denied and with slow GPS or network independently; each failure
must identify its stage and allow another attempt. Switch sessions or close
the boarding view while checking, then confirm no old-session success appears.
Correct an existing member's destination and verify no second location prompt.
Moving-bus GNSS, fresh hardware proximity and road/stop correctness remain
live acceptance requirements in #245.
