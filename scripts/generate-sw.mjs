/**
 * generate-sw.mjs — Post-build step: Inject precache manifest into SW.
 *
 * Scans frontend/out/ for all static assets produced by `next build`,
 * bundles the Workbox runtime + src/sw.js, and writes the final sw.js
 * into frontend/out/ ready for Firebase Hosting deployment.
 *
 * Run after `next build` and before `update-csp.mjs`.
 */

import { injectManifest } from "workbox-build";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(import.meta.url), "../..");
const frontendRoot = path.join(root, "frontend");

const result = await injectManifest({
  swSrc: path.join(frontendRoot, "src", "sw.js"),
  swDest: path.join(frontendRoot, "out", "sw.js"),
  globDirectory: path.join(frontendRoot, "out"),
  globPatterns: [
    // HTML pages (the app shell for every route)
    "**/*.html",
    // Next.js static chunks — JS and CSS
    "_next/static/**/*.{js,css}",
    // PWA manifest
    "manifest.webmanifest",
    // Icons and hero images
    "*.png",
    "*.webp",
    "images/**/*.{webp,jpg,png}",
  ],
  globIgnores: [
    // Exclude source maps (not generated with productionBrowserSourceMaps:false,
    // but guard against future changes)
    "**/*.map",
    // Exclude build metadata
    "_next/static/**/webpack-*",
    "_next/static/**/buildManifest.js",
  ],
  // Maximum file size to precache (2 MB). Larger files (e.g. if someone adds
  // a video) should use runtime caching instead.
  maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
});

console.log(
  `✅ SW generated: ${result.count} files precached (${(result.size / 1024).toFixed(0)} KB total)`
);

if (result.warnings.length > 0) {
  console.warn("Warnings:");
  for (const warning of result.warnings) {
    console.warn(`  ⚠ ${warning}`);
  }
}
