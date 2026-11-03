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

The Routes tab shows published schedules in compact rows with line badges.
Use the rounded, arched transit-front glyph in the list and timetable badge.
Desktop shows a list and independently scrolling timetable beside it. Smaller
screens open the timetable in place and Back returns focus to the selected row.
Use the configured stop order and times from the existing route schedule
sources. The timetable uses the Ahmedabad University palette and the existing
app typeface. Route schedules must never start a live map or Maps request.
