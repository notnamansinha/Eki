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
import { bundle } from "workbox-build/build/lib/bundle.js";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(import.meta.url), "../..");
const frontendRoot = path.join(root, "frontend");
const swDest = path.join(frontendRoot, "out", "sw.js");

const result = await injectManifest({
  swSrc: path.join(frontendRoot, "src", "sw.js"),
  swDest,
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
    // Source maps are published for debugging but should never consume the
    // offline precache budget.
    "**/*.map",
    // Exclude build metadata
    "_next/static/**/webpack-*",
    "_next/static/**/buildManifest.js",
  ],
  // Maximum file size to precache (2 MB). Larger files (e.g. if someone adds
  // a video) should use runtime caching instead.
  maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
});

// injectManifest replaces the precache placeholder but intentionally leaves
// module imports untouched. Bundle the injected source so browsers receive a
// self-contained classic service worker rather than unresolved bare imports.
const require = createRequire(import.meta.url);
let unbundledCode = await readFile(swDest, "utf8");
for (const packageName of [
  "workbox-core",
  "workbox-precaching",
  "workbox-routing",
  "workbox-strategies",
  "workbox-expiration",
  "workbox-cacheable-response",
]) {
  // Workbox's bundler stages source in the OS temp directory, outside this
  // repository's node_modules ancestry. Resolve the entry modules here so
  // Rollup can follow both these imports and their nested dependencies.
  const packageDirectory = path.dirname(
    require.resolve(`${packageName}/package.json`),
  );
  const modulePath = path.join(packageDirectory, "index.mjs").replaceAll("\\", "/");
  unbundledCode = unbundledCode.replaceAll(
    `"${packageName}"`,
    JSON.stringify(modulePath),
  );
}
const bundledFiles = await bundle({
  babelPresetEnvTargets: [
    "Chrome >= 80",
    "Firefox >= 78",
    "Safari >= 14",
    "Edge >= 80",
  ],
  inlineWorkboxRuntime: true,
  mode: "production",
  sourcemap: false,
  swDest,
  unbundledCode,
});
for (const file of bundledFiles) {
  await writeFile(file.name, file.contents);
}

console.log(
  `✅ SW generated: ${result.count} files precached (${(result.size / 1024).toFixed(0)} KB total)`
);

if (result.warnings.length > 0) {
  console.warn("Warnings:");
  for (const warning of result.warnings) {
    console.warn(`  ⚠ ${warning}`);
  }
}
