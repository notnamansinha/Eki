# Device and Screen-Reader Acceptance

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-TST-016 | 1.1 | Current | 2026-11-24 |

## 1. Purpose

This procedure covers the checks that emulated browsers cannot make: Eki on real phones and tablets, and Eki with real screen readers. A release passes issue #523 when one record made with this procedure holds, for one named revision:

- a real-device matrix with at least one iPhone and one Android phone (Section 4);
- at least two screen-reader sessions: NVDA with Firefox on Windows, and VoiceOver with Safari on iOS (Section 5);
- the reviewed visual baselines passing on that revision (`npm run qa:visual`, [visual baselines](VISUAL_BASELINES.md)).

Automated checks already cover emulated layouts, axe-core rules and the accessibility tree. This procedure does not repeat them; it checks what they cannot observe.

## 2. Prerequisites

| Item | Requirement |
|---|---|
| Target | `https://bustrack-be165.web.app`, the site released by every green push to `main` ([CI, deployment and releases](../docs/operations/CI_CD_AND_RELEASES.md)) |
| Accounts | One passenger and one administrator test account, used only for testing. Do not use a personal account: the delete-account check (DEV-11) must stop at the confirmation dialog, and nothing in this procedure deletes an account |
| Live service | For the tracking and boarding checks, a bus in service on the target. Without one, mark those checks `BLOCKED` with the reason |
| Devices | At least one iPhone on a supported iOS release and one Android phone with Chrome. Add an iPad or Android tablet, a foldable and a low-memory Android phone (2 to 3 GB RAM) when available |
| Screen readers | NVDA (current release) with Firefox on Windows; VoiceOver with Safari on iOS. Optional: TalkBack with Chrome on Android, VoiceOver with Safari on macOS |
| Record | A copy of the template in Section 6 |

## 3. Name the revision

The web app shows no build label (`NEXT_PUBLIC_BUILD_VERSION` is not set by any workflow), so the release is identified by its deployment.

1. Before the first session, run:

   ```powershell
   gh run list --repo notnamansinha/Eki --workflow deploy.yml --branch main --status success --limit 1 --json headSha,createdAt,url
   ```

   Expected result: one run. Record `headSha` as the revision, with `createdAt` and `url`.

2. Run `npm run qa:visual` on that commit. Expected result: all tests pass. Record the pass and the image digest from `artifacts/visual/run.json`.
3. After the last session, run the command in step 1 again. Expected result: the same `headSha`. If it changed, a new release reached the site during testing: record which sessions ran before and after it, and repeat the affected checks on the new revision.

## 4. Real-device matrix

Run every check on each device. Use the browser named in the device column of the record; on iPhone and iPad, also repeat DEV-01, DEV-02 and DEV-09 in the installed app (DEV-10). Mark each check `PASS`, `FAIL` (with a screenshot or screen recording) or `BLOCKED` (with the reason).

| ID | Check | Steps | Pass when |
|---|---|---|---|
| DEV-01 | Dynamic toolbars and `100dvh` | Open `/passenger`. Scroll the Live routes list, Profile and an open route timeline so the browser toolbar collapses and returns. | The tab bar and the Live routes sheet stay fully visible above the browser toolbar and the home indicator at every toolbar position; nothing jumps behind them. |
| DEV-02 | Safe areas | Repeat DEV-01 in landscape on a device with a notch or camera cutout. | No text or control sits under the cutout, the rounded corners or the home indicator. |
| DEV-03 | Input zoom | Focus the route search (`Search routes or stops`), the feedback text box and, as administrator, a Fleet text field. | iOS does not zoom the page on focus. Leaving the field returns the page to its previous scale. |
| DEV-04 | Back and forward cache | Open a route, follow **Install the app** from the landing page or a University link from Profile, then go back. Repeat with the app in the background for 2 minutes. | The previous screen returns. Live data resumes within 30 s (the freshness threshold in `frontend/src/lib/liveBusFreshness.ts`), or the screen shows its reconnecting or delayed state instead of a stale bus position presented as live. |
| DEV-05 | Text size | Set the largest text size (iOS Larger Text, Android font size and display size at maximum). Open the landing page, Live routes, an open route, Profile, both dialogs (DEV-11) and, as administrator, Feedback and Live Ops. | Text wraps; no label is clipped, overlaps another or pushes an icon out of its card. See Section 7 for two layouts to look at first. |
| DEV-06 | Android font boosting | On Android Chrome with default text size, compare the Live routes cards and Profile rows with the `phone` baselines in `e2e/visual/baselines/phone/`. | No block of text is enlarged out of proportion to the rest of its card. |
| DEV-07 | Rotation | Rotate while on the landing page, Live routes and an open route. | The artwork switches between portrait and landscape compositions, the route card or timeline stays in view, and focus is not lost. |
| DEV-08 | Location permission | Open a route and choose **Allow location**; deny the operating-system prompt. Repeat and allow it. | After a denial, live tracking keeps working and the prompt does not return in a loop. After allowing, the walking estimate appears. |
| DEV-09 | Sign-in | Sign out, then sign in with **Continue with Google**. If the pop-up is blocked, use **Continue with full-page Google sign-in**. | Sign-in completes and opens the passenger or admin workspace. |
| DEV-10 | Installed app and offline cold start | Install from `/install`. Open it, close it fully, turn on airplane mode and open it again (issue #430). | The installed app opens in standalone mode. Offline, it shows its offline state rather than a browser error page; with the network back, it recovers without reinstalling. |
| DEV-11 | Dialogs | In Profile, open **Send feedback**, then close it. Open **Delete account** and choose **Cancel**. | Each dialog fits the screen with the keyboard open, scrolls if needed, and closing returns to Profile. Do not confirm the deletion. |
| DEV-12 | Tablet and foldable layouts | On a tablet, check portrait, landscape and split-screen at half width. On a foldable, check folded and unfolded. | The layout matches the nearest `tablet` or `phone` baseline; no area is empty because a breakpoint was missed. |
| DEV-13 | Low memory | On the low-memory Android phone, open Live routes, track a bus for 5 minutes and switch apps twice. | The page is not reloaded by the browser, the map keeps updating and the bus marker does not freeze for more than 30 s. |

## 5. Screen-reader sessions

Each session runs every script below. Use the screen reader's normal navigation (swipe or arrow keys, headings, landmarks, form controls); do not use a mouse or touch exploration except where a step says so. The expected roles and names come from the reviewed accessibility trees in `e2e/visual/baselines/` (synthetic route and bus names there; the target shows real ones). Record what was spoken when it differs from the expectation.

| Session | Device | Screen reader and browser |
|---|---|---|
| A (required) | Windows desktop | NVDA with Firefox |
| B (required) | iPhone | VoiceOver with Safari |
| C (optional) | Android phone | TalkBack with Chrome |
| D (optional) | Mac | VoiceOver with Safari |

| ID | Flow | Steps | Expected |
|---|---|---|---|
| SR-01 | Landing | Load `/`. Read the whole page, then list headings and links. | Heading level 1 "Track your campus bus"; button "Continue with Google"; links "Campus Operations" and "Install the app". The two-sentence description is read with a pause between the sentences (it has no full stop; record if it runs together). |
| SR-02 | Live routes | Sign in as passenger. On a touch device, find and activate "Show live routes". Move through the route list, then navigate by headings. | Heading level 1 "Live routes" with the route count; each route is one button named "Track <route name>"; on touch, the toggle reports collapsed and expanded. Record whether heading navigation reaches each route name (each card is a button that contains a level 3 heading). |
| SR-03 | Tracking a bus | Activate a route. Read the screen from the top. Activate "Route timeline" and read the stops. Use "Back to home". | Heading level 1 is the route name; "Back to home", "Open live chat", the "Location" region with "Allow location" and "Not now", the bus image named with its state ("approximate GNSS position", or "GPS signal lost, last known location"), "Center on bus" reported as pressed, "Show route overview", "Route timeline". "Back to home" returns focus to the route's button. |
| SR-04 | Live status changes | While tracking, wait for or provoke a status change (a delayed or lost signal, or the service ending). | The change is announced once, without moving focus. The lost-signal state is shown in two status regions (header and map notice): record whether it is spoken twice. |
| SR-05 | Boarding | With a bus in service, choose the boarding and destination stops and activate "Board". | The pickers are named "Boarding stop" and "Destination station"; without both stops the hint "Choose your boarding and destination stops to board." is reachable; "Checking…" and then "On board", or the error, is announced through the status or alert region. |
| SR-06 | Route schedules list and search | Open "Routes". Type part of a stop name in "Search routes or stops", then a word that matches nothing, then clear it. Open a schedule and go back. | Search box "Search routes or stops"; list "Published routes" with buttons "View schedule for <route>"; "No routes match your search." is reachable when nothing matches (record whether it is announced without moving there); the schedule heading takes focus on open and the route's button takes it back on return. |
| SR-07 | Feedback form | Profile, "Send feedback". Type a comment, submit, then reopen and press Escape (two-finger scrub on iOS). | Dialog "Send feedback"; text box "Comments and suggestions"; the word count; "Submit feedback" reported as unavailable while empty; the result announced through the status region; focus stays inside the dialog and returns to "Send feedback" when it closes. |
| SR-08 | Delete-account confirmation | Profile, "Delete account". Read the dialog, then choose "Cancel". | Dialog "Delete account?" with its description read on open; focus starts on "Cancel"; "Cancel" returns focus to "Delete account". Do not confirm. |
| SR-09 | Admin vehicle create, edit and delete | Sign in as administrator, tab "Fleet & People". Fill "New vehicle Bus ID" and "New vehicle display name", tick a route, activate "Add Vehicle". Edit and then delete that vehicle with "Edit vehicle <name>" and "Delete vehicle <name>", confirming the deletion. Use a test vehicle ID that no tracker uses. | Tabs "Administration sections" with the selected tab reported; each field named as listed; validation errors and the result announced; the delete confirmation is a dialog with focus on "Cancel". Record whether voice control can activate the buttons by their visible text (Section 7). |
| SR-10 | Admin route editor | Tab "Routes", "Add Route". Search with "Search for a stop" (each search is a billed Places request; keep to a few), add two stops, reorder with "Move stop <name> up" and "Move stop <name> down" and remove one with "Remove stop <name>". Select another tab, choose "Keep editing", then leave with "Cancel route editing". Do not save. | Each control named as listed; the new stop order is perceivable; selecting another tab with unsaved changes opens the dialog "Discard unsaved changes?" with "Keep editing" and "Discard changes". |
| SR-11 | Admin feedback list and filters | Tab "Feedback". Use "Search feedback", "Feedback type" and "Feedback status". | The comboboxes report their selected option; the "Entries <n> of <m>" count updates after each filter (record whether the change is announced); each entry is one button. Record how long an entry's spoken name is (it contains the whole card). |

## 6. Record template

Copy this into `docs/testing/DEVICE_AND_SCREEN_READER_<YYYY>_<MM>_<DD>.md` with the next free `EKI-EVD` ID and status `Historical`, fill it in, add it to the [documentation register](../docs/README.md#4-document-register) and the [testing index](../docs/testing/README.md), and link it from issue #523.

```markdown
## 1. Revision

| Item | Value |
|---|---|
| Revision (`headSha`) | <40-character commit> |
| Deploy run | <url>, <createdAt> |
| Same revision after the last session | Yes / No (details) |
| `npm run qa:visual` on the revision | Pass / Fail, image <digest> |
| Tester(s) | <name or handle> |
| Dates | <YYYY-MM-DD> |

## 2. Devices

| Device | OS version | Browser and version | Installed app | DEV-01 | DEV-02 | ... | DEV-13 | Notes |
|---|---|---|---|---|---|---|---|---|

## 3. Screen-reader sessions

| Session | Device and OS | Screen reader and version | Browser and version | SR-01 | ... | SR-11 | Notes |
|---|---|---|---|---|---|---|---|

## 4. Findings

| ID | Check | Severity | Observed | Expected | Evidence | Issue |
|---|---|---|---|---|---|---|
```

Store screenshots and recordings with the issue or in approved storage, not in the repository, and remove personal data (other users' names, locations) before attaching them.

## 7. Known items to confirm

The visual baseline review on 2026-11-24 ([EKI-EVD-063](../docs/testing/VISUAL_BASELINE_REVIEW_2026_11_24.md), findings F1 to F8) found these in the emulated renders. The first three (F1 to F3) are fixed in pull request [#562](https://github.com/notnamansinha/Eki/pull/562): confirm each fix on a real device or with voice control. Confirm or clear the others on a real device or with a screen reader. Record each result as a finding.

| Item | Where | Check |
|---|---|---|
| Fixed in #562 (F1): the "Unreviewed" label overflowed its summary card and squeezed its icon out at 412 CSS px. On phones the icon now sits above the label and keeps its size. Confirm that no summary label is clipped at the largest text size | Admin Feedback on a phone | DEV-05 |
| Fixed in #562 (F2): the Live Ops summary labels filled their cells with no side padding at 1280 CSS px. The cells now have side padding, and the labels are centred and no longer upper case, so "Direction" fits a padded cell. Confirm that no label touches a cell border at the largest text size | Admin Live Ops on a desktop | DEV-05 on a tablet in landscape |
| Fixed in #562 (F3): four accessible names did not contain the visible label (WCAG 2.2 success criterion 2.5.3, Label in Name). They are now "Add Vehicle", "Add Operator", "Saved Vehicles <count>" and "Saved Operators <count>", and the two list toggles report expanded or collapsed. Confirm that voice control activates each one by its visible text | Admin Fleet & People | SR-09 with voice control (Voice Control on iOS, Voice Access on Android) |
| The lost-signal message is in two status regions | Passenger tracking | SR-04 |
| Each feedback entry is a single button whose name is the whole card | Admin Feedback | SR-11 |
| Route cards are buttons that contain headings | Passenger Live routes | SR-02 |
