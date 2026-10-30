# Full feature QA: 3 October 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-012 | 1.0 | Historical | 2026-10-04 |

> Historical evidence: original run dates, commits, measurements and limits below remain authoritative for that run. This documentation update does not rerun the test. See [current testing gates](README.md).

Base: `testing` at `a12368f7cc19f1f3db77f09474dca5eb8e1cf1f2`. Fix branch: `codex/full-feature-qa`. Existing user edits and the original checkout were preserved. Tests use synthetic identities and coordinates; raw live observations remain in the ignored local audit folder.

## Confirmed findings

| Issue | Reproduction | Fix |
| --- | --- | --- |
| [216](https://github.com/notnamansinha/Eki/issues/216) | A visible live route card received no action because an opacity-hidden tracking overlay intercepted its pointer click. Chrome DOM hit-testing identified the overlay. Hidden views also exposed controls to keyboard/accessibility navigation. | Inactive home, tracking, map and profile subtrees are inert and aria-hidden. Chat unmounts when leaving tracking so a hidden dialog cannot retain its focus handlers. |
| [217](https://github.com/notnamansinha/Eki/issues/217) | Feedback reported Thank you and started a cooldown for an HTTP 200 HTML proxy page. Several writes omitted the ngrok header or a bounded timeout. | Shared transport for feedback/chat/boarding/settings/privacy/bootstrap; documented write acknowledgements; uncertain-response errors preserve retry semantics; message ID/status traces remain correlated. |
| [218](https://github.com/notnamansinha/Eki/issues/218) | Hardware availability was an enabled dead button. Route fields and colour controls, and feedback search, lacked accessible names or selection state. | Disable unarmed availability; associate labels and IDs; name colour controls with aria-pressed; label feedback search. |
| [219](https://github.com/notnamansinha/Eki/issues/219) | History deletion removed its focused trigger; Escape did not close its inline confirmation. Verified without deleting live data. | Shared confirmation dialog; persistent trigger for cancellation focus restoration; connected history-heading fallback after successful deletion; Cancel first; focus containment; Escape; in-flight dismissal protection. |
| [220](https://github.com/notnamansinha/Eki/issues/220) | Feedback status PATCH serialized JSON without its content-type header, causing the backend parser/handler to reject the update. | Explicit JSON content type and component regression with a server-equivalent header/body check. |
| [221](https://github.com/notnamansinha/Eki/issues/221) | Settings fields remained editable during a save; successful completion cleared later unsaved edits. | Lock the draft fields and announcement switch during the bounded save, then enable them again on success/failure. |

The branch also carries the existing [208](https://github.com/notnamansinha/Eki/issues/208) build prerequisite shared by PRs 210/215: FeedbackPanel is a reusable component and `/feedback` is a valid Next.js page wrapper. It does not introduce another retention implementation.

## Verification matrix

| Area | Local verification and limits |
| --- | --- |
| Passenger home/tracking/profile | Actual workspace/carousel/CSS in Chrome: pending and resolved direction, forward/reverse labels, two live buses and session selection, back navigation, informational hardware availability, empty service and completed service. Desktop and observed 391 × 844 CSS mobile viewport. Inactive controls absent from the accessibility tree. Regression tests cover active-view controls, switching sessions and unjoined completion. |
| Boarding | Actual component: incomplete fields, normalized code, chosen stations and synthetic GPS payload, location permission denied, missing/false/HTML acknowledgement and unmount abort. No real passenger boarding performed. |
| Chat | Actual component: malformed acknowledgements keep the draft; uncertain retry retains its ID; duplicate HTTP 200 preserves message tracing; repeated in-flight sends blocked; unavailable rides disabled; failed read Retry unsubscribes/reconnects. Existing server tests cover authenticated session membership, moderation, rate limits and idempotency. |
| Feedback | Actual modal: empty submission, close/Escape, invalid success body, confirmed submission, ngrok/auth headers, uncertain retries and authoritative cooldown. Admin panel: JSON status actions, rejection display, type/status/search filters and Reset. Chrome baseline filter/expand controls verified without changing live statuses. |
| Routes | Chrome baseline: editor opens, endpoint swap and cancellation preserve stored order, delete confirmation can cancel. Actual component tests: associated labels/colour selection, endpoint reorder/cancel, too few stops disable deployment, uncertain save reuses operation/version, delete Cancel. Existing route/geometry tests exercise conflicts, validation, canonical geometry and durable operation reconciliation. Real Google Maps search/drag and provider outage timing are not fully exercised by the fixture. |
| Fleet/personnel | Chrome baseline: empty vehicle validation, vehicle editor, delete confirmation/Cancel, live status. Actual component tests: empty operator/vehicle validation, both deletion cancellations, inline edit cancellation, saved-list expansion and server rejection retaining input. Existing backend tests cover assignment conflicts, protected roles and cleanup. |
| History | Chrome baseline: completed/interrupted records and persisted manifest/stop details expand. Actual component: expand/collapse, Cancel focus and keyboard containment, Escape restoration, in-flight duplicate/dismissal prevention, rejected delete retaining the record, active-ride protection and both history-query retries. |
| Settings | Actual settings form/CSS in isolated Chrome: edit/save, announcement switch/text, saved announcement and service time reflected on passenger home. Component tests cover unchanged/dirty Save state, successful save and draft retention/retry on failure. These browser writes exist only in fixture memory. |
| Auth/authorization | RoleGuard regression denies passenger/driver access to admin controls, redirects signed-out users, waits during verification and fails closed on role errors. Backend suites plus seven real Firebase emulator tests verify authorization rules. No Google login credentials or App Check settings changed. |
| API/security | 59 registered HTTP operations verified against OpenAPI; backend validation/auth/role/rate-limit/idempotency/concurrency tests passed. Production dependency audit reports zero known vulnerabilities. This is a bounded audit, not a proof that all vulnerabilities are absent. |
| Firmware/recovery | 52 local native cases cover corrupt RTC state, overflow/stale queue policy, retries, reset statistics, HTTP response/reuse and update policy. Earlier stationary serial/network/RTDB evidence is preserved separately. Physical cold power loss and real movement-to-map latency remain a distinct requested follow-up. |

The original localhost:3000 server stopped responding during the final browser pass. The isolated fixture was used for remaining passenger/settings checks; the final strict build uses CI placeholders and does not contact the live Firebase project.

## Results and reproduction

- 290 frontend tests, including 69 additional regression cases; 550 backend tests plus seven separate emulator rules tests; 50 script tests; 52 native firmware cases.
- Frontend/backend lint, TypeScript through the strict production build, static export, service worker generation and CSP/backend contract passed locally.
- `npm audit --omit=dev --omit=optional`: zero reported vulnerabilities.
- Browser fixture: `npx vite --config e2e/fixtures/vite.config.mts`. See [fixture instructions](../../e2e/fixtures/README.md).
- New interaction tests: `npm run test --workspace=frontend`. Backend/script checks: `npm test`. Rules: `npm run test:rules`. Firmware: `platformio test --project-dir hardware -e native`.
- On this Windows machine, emulator Java needed `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:/Users/Public/eki-emulator-sockets`. The first emulator run also timed out while other suites were consuming resources; rerunning with the socket-path workaround and lower contention passed all seven cases.

Private console outputs, screenshots and an evidence manifest are stored locally under `temp/live-audit-2026-10-02/validation/full-feature-qa/`. No raw identities, locations, credentials or live Firebase records are included in this report or GitHub issues.

## Method and references

Tests assert visible behavior and isolate third-party dependencies following [Playwright testing guidance](https://playwright.dev/docs/best-practices) and [Testing Library user-event guidance](https://testing-library.com/docs/user-event/intro/). Server coverage considers actor/resource/action authorization and repeated, reordered or concurrent workflows following [OWASP authorization regression guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Regression_Testing_Cheat_Sheet.html) and [OWASP business-logic guidance](https://cheatsheetseries.owasp.org/cheatsheets/Business_Logic_Security_Cheat_Sheet.html). Dialog checks use [WAI-ARIA dialog keyboard guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/); authorization rules run with [Firebase rules unit-testing tools](https://firebase.google.com/docs/rules/unit-tests).

Finite regression, simulation and browser checks cannot establish that every possible edge case has been eliminated. The separate requested power-loss/moving-latency simulations and issue 214 legacy/geometry retention work must be reported with their own evidence. The approved ride-record retention remains 180 days in PR 210.
