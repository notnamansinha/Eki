# Transit Artwork Delivery

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-UIX-002 | 2.0 | Current | 2026-11-07 |

## 1. Source and delivery

The login and persistent passenger backgrounds use two tree-view paintings,
one portrait and one landscape. The source PNGs are kept in
`docs/design/transit-artwork/`:

| Source | Native dimensions | PNG bytes | Full-size WebP bytes |
|---|---|---|---|
| `bus-background-portrait-trees.png` | 841x1870 | 3917997 | 959266 |
| `bus-background-landscape-trees.png` | 1672x941 | 3443721 | 861222 |

The exterior bus and clock are absent; trees fill the window view. These are
generated adaptations of the original illustration. Derive delivery files
only from these source PNGs. The backgrounds are WebP still images, not video.

`scripts/optimize-transit-artwork.mjs` uses the Sharp encoder installed with
Next.js to derive portrait widths 480, 768 and 841 and landscape widths 960,
1280 and 1672, directly from the source PNGs, into `frontend/public/images/`.
The script stops if a source PNG does not have its expected dimensions.
Quality 96, encoder effort 6 and smart chroma subsampling keep the fine
halftone detail while the native WebPs are about 75 % smaller than their PNG
sources. WebP encoding is lossy; source PNGs retain the original pixels. The
script resizes without enlargement, so there is no sharpening, redrawing or
artificial upscaling. The source PNGs are archived outside the app's public
folder, so deployment contains only six WebP sizes (about 3.85 MB combined),
rather than also shipping 7.36 MB of source PNGs. A browser requests one
matching size at a time; all six sizes are not downloaded at startup.

Run `node scripts/optimize-transit-artwork.mjs` from the repository root to
regenerate delivery files. Do not derive them from another compressed
WebP. Keep the legacy hero asset (`/images/hero-background.webp`) available
for social metadata and older cached pages. The delivery files use their own
URLs, separate from the legacy hero image, so a cached copy of the older,
lower-quality background is never served in their place. Images are runtime
cached by the service worker (`eki-images` in `frontend/src/sw.js`), outside
the install precache budget.

## 2. Framing and layout

`frontend/src/components/shared/TransitArtwork.tsx` owns the native picture,
source candidates, viewport-based sizes, full-size WebP fallback and shade
element. Both `app/page.tsx` and `PassengerLoadingShell.tsx` render it. The
passenger layout keeps it mounted when its loading placeholders disappear.
The landing shade is 40 % black (`.transit-artwork-shade` in
`app/globals.css`). In the passenger layout, `app/passenger/theme.css`
replaces it with `--pp-art-scrim`, a gradient that is clear down to 45 % of
the height and darkens to 18 % black at the bottom, and paints the artwork
background in the off-white `--pp-page`.

Native picture media queries select the portrait composition in portrait
viewports, otherwise the landscape composition. Each has its own WebP srcset;
the base img fallback is the full-size landscape WebP, loaded eagerly with
high fetch priority. Orientation and source selection update when the
viewport rotates, resizes, or changes in mobile desktop mode. There are no
browser-name or user-agent branches and no JavaScript image swapping.

The foreground uses centred `object-fit: cover`. The selected composition
fills the canvas with proportional cropping at other ratios, with no empty
borders or stretched figures. The `sizes` values account for cover's painted
width, including when it exceeds the viewport width. Pixel density participates
in native srcset selection, capped by the actual source resolution. These
sources do not contain extra 4K detail. There is no video decode cost; the only
motion is the CSS slide on phones described below.

On touch screens in portrait orientation, the passenger artwork slides up
30 % (`translateY(-30%)`, 450 ms, `cubic-bezier(0.32, 0.72, 0, 1)`) while the
Live routes panel is open on the home view, so the band above the panel shows
the passengers and the trees rather than the ceiling straps. The opaque panel
covers the vacated bottom. While the phone sheet rests lowered, the artwork is
not shifted and fills the screen above the peek. The transition starts only
after the sheet's first measurement (`data-peek-ready`) and is removed under
reduced motion. The phone sheet is specified in the
[UI design system](../design/UI_DESIGN_SYSTEM.md#76-phone-live-routes-sheet).

The login has no AU logo or logo header.
The headline, description and gaps respond to viewport height as well as width,
so normal sign-in and the footer fit without scrolling in a 1280x585 CSS
viewport. That represents a 1080p desktop with 150 % system scaling, browser
chrome and taskbar, at 100 % browser zoom. The headline is capped at 96 px.
Viewports at most 32 rem (512 px) tall use compact type and a 44 px minimum
button height. The fixed background fills the viewport; the document can
still grow and scroll when enlarged text or additional auth notices need more
space. Content and footer account for browser safe-area insets.

## 3. Verification

The passenger browser fixture (`e2e/fixtures/vite.config.mts`) and the
landing fixture (`e2e/admin-access/vite.config.mts`) serve the real files in
`frontend/public/`. `e2e/passenger-layout/transit-artwork.spec.ts` has three
tests, run in each of the five passenger layout projects: successful image
delivery, candidate resolution and edge-to-edge fitting; rotation in both
directions on a 3x-density phone; and one WebP download, and no PNG, per
initial view. `e2e/passenger-layout/home-sheet.spec.ts` checks that the
portrait artwork shifts up only while the phone sheet is raised.
`e2e/admin-access/landing-layout.spec.ts` checks that the entire normal
sign-in and footer fit without scrolling at 1280x585, 1280x720, 1920x878 and
390x844, and that a desktop at 150 % density and 100 % browser zoom shows the
complete button and footer in the initial viewport.

The following results were recorded for the artwork and landing layout by
2026-11-03.

All 15 artwork checks passed across the five configured passenger viewports.
The actual Next.js production export and the passenger fixture passed 42
viewport/surface checks across Chromium, Firefox and WebKit. Viewports were
320x568, 390x844, 844x390, 768x1024, 1280x800, 2560x1080 and a 980x1860 CSS
viewport representing mobile desktop mode, at densities from 1x to 3x.
Checks covered successful decode, the correct composition, edge-to-edge fitting,
no horizontal overflow and reachable login controls. Login provider requests
were blocked and passenger data was synthetic. These are automated browser
checks on Windows, not physical-device or live-auth measurements. Local
screenshots and results are in `temp/artwork-quality/evidence/` (Git-ignored).

Review screenshots: [login portrait](../design/transit-artwork/qa/login-portrait.jpg),
[login desktop](../design/transit-artwork/qa/login-desktop.jpg),
[100 % zoom on a scaled desktop](../design/transit-artwork/qa/login-scaled-desktop.jpg),
[passenger portrait](../design/transit-artwork/qa/passenger-portrait.jpg) and
[passenger desktop](../design/transit-artwork/qa/passenger-desktop.jpg). The
passenger views contain synthetic QA data; the login views block external
providers. The passenger screenshots predate the Ahmedabad University
passenger theme, so they show an earlier dark panel and navigation over the
same artwork.

Frontend ESLint, the production build including TypeScript, six documentation
quality checks and 35 documentation mirror checks passed. The PWA service
worker generator passed with 27 precached files totalling 1126 KB; artwork
stayed runtime cached. All six exported WebPs matched their delivery files byte
for byte, and no source PNG was present in the export. Both archived PNGs were
checked byte for byte against their source files.

The complete browser suites also passed: passenger layout 140, passenger
progress 12 and admin/sign-in 64. The root build passed, including backend
TypeScript, static export, service-worker generation and web/backend CSP
verification. Seven generated inline-script hashes were checked against the
exported HTML and retained while preserving the committed origin directives.
The runtime dependency audit reported zero vulnerabilities. The QA coverage
budget passed with no changed critical source files.

The first aggregate `npm run verify` attempt passed lint, 267 script tests and
the API/UI contract checks, then hit the unchanged backend routing-lifecycle
test's 5-second timeout under concurrent local browser load (1616 backend tests
passed, 75 skipped). That file then passed all 28 tests in isolation with its
existing timeout and no source changes. The first aggregate run therefore does
not count as a pass.

For the landing without a logo, all 28 layout and cold-open browser checks
and 12 landing unit tests passed. The static production export passed 18
rendering checks across Chromium, Firefox and WebKit, including scaled
desktop, short desktop, wide desktop, portrait and landscape viewports. The
root build and regenerated CSP passed, with a service-worker precache of 27
files and 1109 KB. The full frontend unit run completed with 1098 tests.

## 4. Sign-in screen

The landing scales the portrait artwork by 1.3x around its centre
(`.transit-landing` in `app/globals.css`). Its portrait
`sizes` accounts for the wider painted image. Landscape and the passenger
shell use the base cover fit.

The sign-in button uses bold “Continue with Google” and a 20 px
multicoloured G from Google's light web sign-in asset at
`frontend/public/google-g.svg`. The mark is decorative (empty `alt`) because
the button label identifies the provider. While sign-in is preparing or
opening, a spinner replaces the mark and the label reads "Preparing sign-in…"
or "Opening Google…".
[Google Identity branding assets](https://developers.google.com/identity/branding-guidelines)

The headline and description use a black text shadow with a 2 px offset and
8 px blur at 48 % and 45 % opacity respectively.
The headline reads “Track your campus bus”. The description introduces
University bus routes and available bus locations, followed by “Arrival
estimates depend on live service data” on a separate line. A secondary link
below the Google button directs riders to Campus Operations for campus
travel information and opens the University's Getting Around page in a new tab.
[Ahmedabad University transport guide](https://ahduni.edu.in/academics/schools-centres/office-of-the-dean-of-students/getting-around/)

The login review screenshots show the sign-in fixture with synthetic auth
at 390x844, 1440x900 and 1280x585 CSS pixels. The fixture verified that the
heading, enabled Google button, Campus Operations link and footer fit.

## 5. Desktop passenger view

On pointer-equipped windows, the Live routes panel is centred over the artwork, at most 42 rem wide, on a white surface with paper route cards. A shorter artwork band (`clamp(24px, calc(22dvh - 64px), 144px)`) leaves more room for the compact, independently scrolling route list, and the floating dock sits below the panel. The workspace and session-loading shell share this geometry. Touch-only windows show Live routes as a sheet that rests on the tab bar, so the artwork fills the screen above the peek, and the loading shell rests at the same peek. Both layouts use the same portrait and landscape artwork sources.

## 6. Published schedule navigation

The Routes tab docks the passenger navigation to the bottom edge, and on
pointer-equipped windows at least 64 rem wide moves it to a top bar above the
list and timetable. The Live tab keeps the centred dock over the artwork on
pointer devices and the full-width tab bar on touch screens. The tabs mark the
active section in AU Red Bold, with no underline marker, and browser Back and
Forward move between Live, Routes and Profile. The icons are Lucide MapPinned
for Live, Eki's connected dots for Routes and Lucide UserRound for Profile. The
Profile feedback action uses Lucide MessageSquareText.

Published route badges use a front-facing bus SVG with side mirrors, a destination sign, headlights and tires. The same glyph appears in the route list and timetable header. The Routes tab covers the artwork with the off-white Ahmedabad University page: the list and timetable headers are AU Red bands with white type, the list badges are AU Red with white text, the timetable badge is white with AU Red text, and the timetable rail is Dark Grey (`#434747`) with AU Red first and last stops.
