<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Transit artwork (2026-11-02)

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
responsive `srcset`, full-size WebP fallback, eager/high-priority loading and shared
framing. See `docs/context-docs/TRANSIT_ARTWORK.md` at the repository root.
Archive the PNG masters outside `public/`; deploy only the WebP delivery sizes.
Run the root build when changing these backgrounds so the generated CSP hashes
accompany the exported HTML; keep developer-specific origins out of the commit.
