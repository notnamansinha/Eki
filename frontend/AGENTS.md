<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Transit artwork and landing layout (2026-11-03)

The login page and persistent passenger shell share
`src/components/shared/TransitArtwork.tsx`. The two user-approved sources are
`docs/design/transit-artwork/bus-background-portrait-trees.png` (841x1870) and
`docs/design/transit-artwork/bus-background-landscape-trees.png` (1672x941), relative
to the repository root. Keep these exact paintings: the exterior bus and clock
were removed in favour of trees. Select
by viewport orientation and fill the screen with proportional `object-fit: cover`,
including on rotation and in mobile desktop mode. Generate delivery sizes with
`node scripts/optimize-transit-artwork.mjs` from the repository root; never
recompress a delivery image or upscale it to claim extra detail. Keep the native
responsive `srcset`, full-size WebP fallback and eager/high-priority loading.
See `docs/context-docs/TRANSIT_ARTWORK.md` at the repository root.
Archive the PNG masters outside `public/`; deploy only the WebP delivery sizes.
Run the root build when changing these backgrounds so the generated CSP hashes
accompany the exported HTML; keep developer-specific origins out of the commit.
The landing has no AU logo or logo header. Headline, copy and spacing respond
to viewport height as well as width: normal sign-in and the footer must fit a
1280x585 CSS viewport at 100% browser zoom, including 150% OS display scaling.
Keep natural scrolling available for enlarged text and additional auth notices.
The landing button uses bold “Continue with Google” with the bundled
Google mark at `public/google-g.svg`. Keep the loading and redirect states.
The headline and description use soft black text shadows. Option B adds a
centred 1.3× scale to the landing portrait artwork. Keep the portrait
`sizes` in step with the CSS scale. The passenger background and landscape
composition use the base cover fit.
Lead the landing copy with bus tracking. Qualify bus locations and estimated
arrivals by live data availability and keep the description free of full stops.
The secondary Campus Operations link sits below the Google button.

## Desktop Live Routes (2026-11-03)

Pointer-equipped desktop and laptop windows use the approved centered Live
Routes panel over the full-width passenger artwork. The panel caps at 42 rem,
gives the route list a scrollbar, and leaves room above the floating nav.
The loading shell shares the same desktop geometry. Keep the existing
touch-only layout. Preserve route selection and restore keyboard focus to the
route card when returning from tracking.

## Passenger route schedules (2026-11-03)

Passenger navigation labels are Live, Routes and Profile. Use Lucide
MapPinned for Live, connected dots for Routes and Lucide UserRound for Profile.
The Send Feedback action uses Lucide MessageSquareText (2026-11-06; was
ClipboardPenLine). Profile uses ShieldUser for Admin panel, LogOut for Sign
out and UserRoundX for Delete account, and the matching confirm dialogs pass
LogOut and UserRoundX to ConfirmModal's `icon` prop.

The Routes tab shows published schedules in compact rows with line badges.
Use the front-facing bus glyph with mirrors and tires in both badge placements.
Desktop shows a list and independently scrolling timetable beside it. Smaller
screens open the timetable in place and Back returns focus to the selected row.
Use the configured stop order and times from the existing route schedule
sources. Route schedules must never start a live map or Maps request.

## Passenger brand theme (2026-11-05)

The passenger panel follows the Ahmedabad University brand rules
(`AU_RULES_AND_BRAND_GUIDELINES.md`): AU Red `#801214` for actions, links and the
route line, Dark Grey `#434747` text, Off-white `#F2EFEC` pages and Gold
`#AE9562` for decoration only. Playfair Display (headings) and Roboto (UI) are
self-hosted through `next/font` in `src/app/layout.tsx`. Passenger and Admin share
palette, font and gradient tokens in `src/app/brand-theme.css`, scoped with
`:root:has(.passenger-layout, .admin-layout)` so portalled dialogs inherit them,
while the landing page, `/install` and the standalone `/feedback` console keep
the original `src/app/globals.css` palette. Surface rules live in each panel's
`theme.css`; Passenger uses semantic `pp-*` classes and Admin uses `ui-*` colour
utilities. Keep actions AU Red and reserve status colours for status indicators.
Phones use iOS-style grouped lists, sheets with grabbers and one translucent tab
bar tinted AU Red. Pointer devices keep the centred Live Routes panel with paper
cards, adding the line code and gold rule only when the window is at least
44rem tall. The Routes tab is a line diagram: AU Red line badges, a Dark Grey
rail and AU Red terminals. Keep text at 12px or more, touch targets at 44px,
and pair every colour signal with text or an icon. Show location use in a
notice before the browser prompt; tracking must work without location.
Routes and Profile follow ahduni.edu.in, where AU Red carries white type: the
route list and timetable headers are solid AU Red bands (white search field,
white line badge on the timetable), Profile has an AU Red title over a short AU
Red rule and the account on a solid AU Red card. Keep focus rings white on
those bands.
Profile cards and lists, the feedback dialog and the passenger confirm dialog
use Apple's continuous corners: inside `@supports (corner-shape: squircle)`,
`src/app/passenger/theme.css` applies `corner-shape: squircle` at 1.6 times the
nominal radius. Keep close buttons circular and grabbers as capsules.

## Phone Live routes sheet (2026-11-06)

On touch screens the Live routes panel rests as a peek above the tab bar
(date, title, route count and hint) so the passenger artwork shows in full.
The whole peek is one button ("Show live routes" / "Hide live routes") that
raises the list; while lowered the list is inert. Swiping the peek up raises
the sheet and swiping it down lowers it (2026-11-09, `useSheetSwipe`); the map's
Route timeline handle swipes the same way. A drag is never also a tap. Choosing a route leaves the
sheet raised for Back. Until the passenger toggles it, the sheet opens by
itself when it has something to say: an admin announcement, or loaded data
with no route to choose. It is a sheet only while the heading leaves at least
56px of panel below it; with very large text it stays open with no toggle.
The peek is measured before first paint and transitions start only after
that (`data-peek-ready`); the loading shell rests at the same peek. Route taps
are ignored for the 450ms the sheet takes to rise. In portrait the artwork slides up 30% while the sheet
is raised, so the band above it frames the passengers and trees rather than
the ceiling straps. Pointer devices keep the centred panel with no toggle.

## Admin Live Ops dark (2026-11-06)

Senior faculty found a light Live Ops panel beside the light Google Map hard to
read, so the Live Ops panel (`.admin-live-ops`), its tab panel and the admin tab
bar while Live Ops is active (`data-tone="dark"`) use the original Eki warm
blacks: `#09090b` panel, `#0f0f12` tab bar, `#16161a` cards and `#ececef`
text. AU Red stays the button fill (lifted to `#b3262a` on black); use the
`--accent-text` tint `#f3a4a5` for accent text, rules and focus indicators on
black, never AU Red itself. The Google Map and its own controls stay light, and
every other admin tab keeps the AU palette. The overrides are scoped token changes in `src/app/admin/theme.css`;
keep new Live Ops colours on the shared tokens so they follow the scope.

## Admin continuous corners (2026-11-06)

The admin panel uses Apple's continuous corner curve: inside
`@supports (corner-shape: superellipse(1.7))`, `src/app/admin/theme.css` scales the
radius tokens by 1.528665 and applies `corner-shape: superellipse(1.7)` to every
`rounded-*` element except `rounded-full`. Keep circles and pills on
`rounded-full`, and use the radius tokens (not arbitrary `rounded-[…]` values) so
new admin corners pick up the curve.

## Thumb drawer stop picker (2026-11-25)

The approved concept 2, "Thumb drawer", replaces the boarding card at the top
of the tracking view. The top line holds only Back and chat, with the map
buttons under chat; a status card joins it only for the bus picker, a paused
notice, a pending direction or missing data. A From → To bar
(`PassengerBoardingView`) sits in the thumb zone above the timeline peek.
Choosing opens the route timeline as the comboboxes' listbox
(`StopPickerSheet`): the same rail and live ETAs, passed stops folded behind
"N passed stops", stops that cannot be chosen kept as disabled options. With
both stops set the bar shows the trip for 0.9 s, then slides into a drawer on
the right edge with the stop and the bus ETA; ‹ pulls it back out, and
a tap on the map or Escape tucks it away. The timeline peek names the next
stop or the stop the bus is at, with a Live chip; the ride status stays in a
visually hidden polite live region. Keep the combobox names ("Boarding stop",
"Destination station"), the location notice above the drawer before the first
join, 44 px targets and the focus moves in FR-PAS-058.

The drawer has no Board button. The passenger is boarded once the bus has reached the boarding stop: under a minute away (the
origin may not be marked "at" before departure), at the stop, or already past
it, since a passenger on board is still within the 150 m check. Each stage is
one attempt; a failed check offers Try again rather than retrying by itself
(FR-PAS-052).

## Demo ride (2026-11-25)

Live routes lists a "Demo ride" under "Practice", after the live routes or
below "No buses running", so the stop picker and boarding can be tried
without a bus. `src/lib/demoRide.ts` simulates it in the browser on fixed
road geometry (OpenStreetMap, ODbL, credited under the Practice card) and publishes the same live-bus shape as
RTDB through `src/lib/passengerLiveSource.ts`. It never contacts Firebase or
the backend, offers no chat or walking-time notice, boards the passenger when
the demo bus is at their stop and ends without feedback.
Keep it marked "Not a real bus" and out of the route count.
It is off unless `NEXT_PUBLIC_DEMO_RIDE=true` (2026-11-26): it was for the
tour and the feature video, and the user saw its Practice card on the
deployed app after the tour. Turn it on only for recordings and the
`e2e/demo-ride` fixture; the tour rides its own bus.

## App tour (2026-11-25, updated 2026-11-26)

After an account's first sign-in the passenger app runs a short, hands-on
tour (`AppTour`, checked by `src/lib/firstRunTour.ts`) over the real screens,
with Skip at the top of the card and Next at the bottom. On a "Your turn" step
the spotlight stays usable and the tour moves on when the passenger acts: they
tap the Vaishnodevi route in Live routes, choose their own stops so the
From → To bar docks into the Thumb drawer, see where live chat sits, tap
Routes and then that route (the card changes once Routes is open),
then tap Profile, where a closing card ("You're all set") points at Replay app
tour and Done ends the tour. Next does each step for them and
is the keyboard and screen reader path. Profile has **Replay app tour**
(Lucide Compass). Keep it to six steps with one short line of copy each
(2026-11-25: the user asked for it hands-on, not just steps; 2026-11-26:
less text), in the passenger palette and type
(Playfair title, gold rule, Roboto copy, AU Red Next). A finished or skipped
tour is remembered per account in this browser.

No fake route appears in the tour (2026-11-26, the user's request): it rides
a route published to passengers (`settings/passengerRoutes`, the Routes tab's
list), the published Vaishnodevi route first, so it looks like the app on a
normal day. Only published routes are candidates (2026-11-26): Firestore still
holds an unpublished copy, **Vaishnodevi to Campus** (`Route-1`), and the user
asked that only the original, **Vaishnodevi Circle** (`route_01`, the route
the trackers run on), be shown; never pick a route by id or by name alone. While the tour is open `src/lib/tourRide.ts` drives a
scripted bus along that route's stored stops and road in this browser (the
same engine as the demo ride, `src/lib/rideSimulation.ts`), listed first as an
ordinary live route card in place of the route's own card, and the demo ride's
Practice card is hidden. Its map, notes and chat button read as a live ride;
nothing reaches RTDB or the backend, and the bus leaves with the tour. Routes
spotlights the same route. Without a published route that can carry the ride,
without live data, or for a passenger already on a real ride, the tour is
three steps. Keep it smooth: the tour fades
in once its first spotlight is in place, and each spotlight waits for its part
of the screen to stop moving, then glides there.
