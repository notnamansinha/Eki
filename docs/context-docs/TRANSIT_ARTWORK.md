# Transit artwork delivery

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-UIX-002 | 1.0 | Current | 2026-11-02 |

## Source and delivery

The login and persistent passenger backgrounds use the exact two tree-view
paintings approved and attached by the user on 2 November 2026. The source
PNGs are copied byte for byte from those attachments into
`docs/design/transit-artwork/`:

| Source | Native dimensions | PNG bytes | Full-size WebP bytes |
|---|---|---|---|
| `bus-background-portrait-trees.png` | 841x1870 | 3917997 | 959266 |
| `bus-background-landscape-trees.png` | 1672x941 | 3443721 | 861222 |

The exterior bus and clock are absent; trees fill the window view. These are
generated adaptations of the original illustration. Use these approved sources
for delivery files; changing their contents needs a new owner request.
The user confirmed WebP still images rather than WebM video.

`scripts/optimize-transit-artwork.mjs` uses the Sharp encoder installed with
Next.js to derive portrait widths 480, 768 and 841 and landscape widths 960,
1280 and 1672, directly from the approved PNGs. Quality 96 and smart chroma
subsampling keep the fine halftone detail while the native WebPs are about
75% smaller than their PNG sources. WebP encoding is lossy; source PNGs retain
the approved pixels. There is no sharpening, redrawing or artificial upscaling.
The source PNGs are archived outside the app's public folder, so deployment
contains only six WebP sizes (about 3.85 MB combined), rather than also shipping
7.36 MB of source PNGs. A browser requests one matching size at a time; all
six sizes are not downloaded at startup.

Run `node scripts/optimize-transit-artwork.mjs` from the repository root to
regenerate delivery files. Do not derive them from another compressed
WebP. Keep the legacy hero asset available for social metadata and older cached
pages. New delivery URLs prevent the service worker from reusing the previous
low-quality background. Images remain runtime cached, outside the install
precache budget.

## Framing and layout

`frontend/src/components/shared/TransitArtwork.tsx` owns the native picture,
source candidates, viewport-based sizes, full-size WebP fallback and existing
40% shade. Both `app/page.tsx` and `PassengerLoadingShell.tsx` render it. The
passenger layout keeps it mounted when its loading placeholders disappear.

Native picture media queries select the portrait composition in portrait
viewports, otherwise the landscape composition. Each has its own WebP srcset;
the base img fallback is the full-size landscape WebP. Orientation and source
selection update when the viewport rotates, resizes, or changes in mobile
desktop mode. There are no browser-name
or user-agent branches and no JavaScript image swapping.

The foreground uses centred `object-fit: cover`. The selected composition
fills the canvas with proportional cropping at other ratios, with no empty
borders or stretched figures. The `sizes` values account for cover's painted
width, including when it exceeds the viewport width. Pixel density participates
in native srcset selection, capped by the actual source resolution. These
sources do not contain extra 4K detail. There is no animation or video decode cost.

The login background stays fixed to the viewport, while the login document
can grow and scroll on short landscape screens or with enlarged text. Its
header participates in layout so the logo and sign-in controls do not overlap.
Header, content and footer account for browser safe-area insets.
Short landscape viewports use compact type, logo and button spacing, with
44px minimum button height, rather than inheriting desktop sizes from their width.

## Verification

The passenger browser fixture serves the real public image files. Regression
checks in `e2e/passenger-layout/transit-artwork.spec.ts` cover successful image
delivery, candidate resolution, edge-to-edge fitting, a 3x-density phone,
rotation in both directions and one WebP download per initial view. All 15
checks passed across the five configured passenger viewports.

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
[passenger portrait](../design/transit-artwork/qa/passenger-portrait.jpg) and
[passenger desktop](../design/transit-artwork/qa/passenger-desktop.jpg). The
passenger views contain synthetic QA data; the login views block external providers.

Frontend ESLint, the production build including TypeScript, six documentation
quality checks and 35 documentation mirror checks passed. The PWA service
worker generator passed with 27 precached files totalling 1126 KB; artwork
stays runtime cached. All six exported WebPs match their delivery files byte
for byte, and no source PNG is present in the export. Both archived PNGs were
checked byte for byte against the user's approved attachments.

PR preparation also passed the complete browser suites: passenger layout 140,
passenger progress 12 and admin/sign-in 64. The root build passed, including
backend TypeScript, static export, service-worker generation and web/backend
CSP verification. Seven generated inline-script hashes were checked against
the exported HTML and retained while preserving the committed origin directives.
The runtime dependency audit reported zero vulnerabilities. The QA coverage
budget passed with no changed critical source files.

The first aggregate `npm run verify` attempt passed lint, 267 script tests and
the API/UI contract checks, then hit the unchanged backend routing-lifecycle
test's 5-second timeout under concurrent local browser load (1616 backend tests
passed, 75 skipped). That file subsequently passed all 28 tests in isolation
with its existing timeout and no source changes. This does not turn the first
aggregate run into a pass; the limitation is recorded in the pull request.
