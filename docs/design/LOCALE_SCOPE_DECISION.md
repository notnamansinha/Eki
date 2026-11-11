# Locale Scope Decision

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-ADR-005 | 1.0 | Proposed | 2026-11-11 |

## 1. Context

Decision date: 2026-11-11. Issue: [#525](https://github.com/notnamansinha/Eki/issues/525).

A QA campaign ran a twelve-locale and time-zone matrix (en-US, hi-IN, de-DE, ar-EG, he-IL, ja-JP, tr-TR, pt-BR, ne-NP, en-NZ, en-KI and en-AS) on six browser projects. It asserted only that each locale rendered text and threw no error. It did not assert text direction, mirroring, line breaking or number and date formatting, because the web client has nothing locale-dependent to drive. Paths below are relative to `frontend/src/`.

| Area | State at `main` (`aff5b30d`) | Source |
|---|---|---|
| Copy | Every label, message and error is an English literal in a component. There is no message catalogue, translation layer, locale route or language switch. | components |
| Document language and direction | `<html lang="en">` with no `dir` attribute, so every page is left to right. The web app manifest declares neither `lang` nor `dir`. | `app/layout.tsx`, `app/manifest.ts` |
| Web fonts | Roboto and Playfair Display are self-hosted with the `latin` subset only. Other scripts fall back to the device's system fonts. | `app/layout.tsx` |
| Dates pinned to `en-IN` | The Live routes date kicker (`Intl.DateTimeFormat("en-IN")`) and the feedback timestamp (`toLocaleString("en-IN")`). | `components/passenger/ui/PassengerDate.tsx`, `components/admin/FeedbackPanel.tsx` |
| Dates in the browser's locale | Ride history dates and times (`Intl.DateTimeFormat(undefined, …)` in `NEXT_PUBLIC_SERVICE_TIME_ZONE`, default `Asia/Kolkata`) and chat message times (`toLocaleTimeString([])`). A browser set to `ar-EG` shows these with Arabic-Indic digits inside English sentences. | `components/admin/RideHistoryPanel.tsx`, `components/shared/MessagingPanel.tsx` |
| Other formatting | Published stop times are built by hand as `7:38 am`; distances, coordinates and arrival minutes use `toFixed` or plain interpolation, with English units and plurals. | `lib/passengerRouteSchedule.ts`, components |
| Text in other scripts | Route and stop names typed by administrators, account names from Google, feedback comments, chat messages and service announcements are stored and shown as entered, in any script. Several of these surfaces already set `overflow-wrap: anywhere`. | `app/globals.css`, `app/passenger/theme.css`, components |

## 2. Decision

Eki ships in English only, left to right, until a trigger in Section 2.2 occurs.

1. The web client has no translation layer, language switch or right-to-left build. Every page keeps `<html lang="en">` and left-to-right layout. Icons, margins and map controls are not mirrored.
2. Text in any script is supported as content. Names, comments and messages that administrators and passengers enter are stored and shown as typed. Arabic and Hebrew runs inside the left-to-right page are ordered by the browser's bidirectional algorithm.
3. Public pages and user-content surfaces must reflow at 320 px without horizontal scrolling when they carry non-Latin text, or Latin text with long words, that has natural break points: spaces, the browser's Thai dictionary breaks, or Japanese character breaks. The checks in Section 6 enforce this. Long tokens with no break point at all are tracked separately in [issue #521](https://github.com/notnamansinha/Eki/issues/521).
4. Browser translation is tolerated, not supported. A machine-translated page must stay usable and keep its layout at 320 px (Section 6), but the translated wording, direction and formatting are the browser's.
5. Dates and times are written in English. The two surfaces that follow the browser's locale (Section 1) are a known inconsistency; pinning them to `en-IN` is a separate change.

### 2.1 What this rules out for now

| Check from issue #525 | Disposition under this decision |
|---|---|
| `dir="rtl"` rendering, icon and margin mirroring, map controls | Not applicable: no right-to-left build exists |
| Arabic, Hindi and Thai line breaking and 320 px reflow | Covered for user-entered and machine-translated text (Section 6) |
| Locale-formatted dates, numbers, currency and arrival strings | Not applicable: English only; Eki shows no currency |
| Long translated strings (de-DE, tr-TR) in buttons and tabs | Covered for German and Turkish copy with spaces on the public pages (Section 6); no translated build exists for the workspaces |
| Browser auto-translation end to end | Not run; only text replacement is simulated (Section 6) |

### 2.2 Triggers to revisit

Reopen this decision, and run the full matrix of issue #525 against the result, when any of these occurs:

1. The university or the project owner asks for passenger or administrator copy in another language, such as Hindi or Gujarati.
2. Passenger feedback or support requests show that people cannot use the service in English.
3. An accessibility, procurement or institutional policy requires local-language service information.
4. A right-to-left language is wanted, which also needs the layout mirrored.

Revisiting means at least: a message catalogue that works with the static export; per-locale `lang` and `dir` on `<html>` and in the manifest; logical CSS properties (`margin-inline`, `inset-inline`) in place of left and right; locale-aware `Intl` formatting checked against fixtures; web font subsets for the chosen scripts; and Playwright checks of direction, mirrored spacing, clipped buttons and tabs at 320 px, and formatted dates and numbers.

## 3. Status

Proposed. It records the current behaviour of `main`; no product code changes with it. It becomes Current when the project owner accepts it on issue #525. If the owner rejects it, the work in Section 2.2 starts instead.

## 4. Consequences

1. Readers of right-to-left languages see their own text in the correct order, but the page chrome reads left to right.
2. Non-Latin text renders in system fonts with metrics that differ from Roboto. The reflow checks run in Chromium only; Firefox and WebKit font fallback is not covered.
3. Administrators whose browser locale is not English see ride history and chat times in that locale's digits and order until those two surfaces are pinned.
4. Adding a language later touches every component with copy. No component is built around a catalogue today, so that cost does not shrink by waiting.

## 5. Alternatives considered

| Option | Why not now |
|---|---|
| Add a translation layer and a language switch now | No user or owner has asked for another language; every string and every test assertion on English copy would change, and the static export needs a locale routing scheme |
| Convert layout to logical CSS properties without a right-to-left locale | No visible benefit until a right-to-left locale exists, and nothing would check it |
| Pin every date and time to `en-IN` in this change | A behaviour change to the admin history and chat; kept separate so this record stays a decision on scope |
| Leave the scope unrecorded | Leaves issue #525 open with no test that guards non-Latin reflow |

## 6. Evidence

| Check | What it proves |
|---|---|
| `e2e/admin-access/non-latin-reflow.spec.ts` | At 320 x 640, with the authored copy replaced by Arabic, Hebrew, Hindi, Thai, Japanese, German or Turkish text as a browser translation would, the landing page and the install page (Android steps) do not scroll sideways and no replaced text leaves the viewport or is clipped. The admin feedback list does the same with a passenger name and comment in each script; a name cut with an ellipsis by design counts as fitting. 21 tests in the `mobile` project of `npm run test:e2e:admin`. |
| `e2e/passenger-layout/non-latin-reflow.spec.ts` | At 320 x 640 with touch, a route, both of its stops and the passenger named in each script reflow on the Live routes card, the destination list, the tracking header while it waits for live data, and the account name in Profile. 7 tests in the `narrow` project of the passenger layout suite. |
| `e2e/fixtures/nonLatinText.ts` | The shared samples and the measurement: page `scrollWidth` against `clientWidth`, and the box and horizontal scroll of every visible element that holds sample text |
| Negative controls, run once on 2026-11-11 and not committed | The same measurement reports offenders when the landing paragraph is forced to `white-space: nowrap` (418 px of page overflow) and when the install page carries the 81-character token of issue #521 (901 px), so a passing run is not vacuous |

Both suites run in CI's Production verification job. The checks do not set a non-English browser locale, so they say nothing about the two browser-locale date surfaces in Section 1.
