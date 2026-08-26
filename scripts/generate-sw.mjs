/**
 * generate-sw.mjs — Post-build step: Inject precache manifest into SW.
 *
 * Scans frontend/out/ for the bounded install shell produced by `next build`,
 * bundles the Workbox runtime + src/sw.js, and writes the final sw.js
 * into frontend/out/ ready for Firebase Hosting deployment.
 *
 * Run after `next build` and before `update-csp.mjs`.
 *
 * Performance: the SW pipeline (workbox injectManifest + Rollup/Babel bundle)
 * costs several seconds on every build even when the static export is
 * byte-identical. To keep no-op builds fast, we fingerprint every input that
 * can affect the final sw.js (the SW source, the workbox config, and the
 * content of every globbed output file) and replay a cached sw.js when
 * nothing changed. The cache lives under frontend/.next/cache (gitignored
 * and preserved by Next.js), so `next build` wiping out/ does not
 * invalidate it. `frontend/next.config.ts` pins a deterministic build ID so
 * that unchanged source produces byte-identical out/ — required for the
 * fingerprint to be stable.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { injectManifest } from "workbox-build";
import { bundle } from "workbox-build/build/lib/bundle.js";

const root = path.resolve(fileURLToPath(import.meta.url), "../..");
const frontendRoot = path.join(root, "frontend");
const swDest = path.join(frontendRoot, "out", "sw.js");
const PRECACHE_BUDGET_BYTES = 2 * 1024 * 1024;

const config = {
  swSrc: path.join(frontendRoot, "src", "sw.js"),
  swDest,
  globDirectory: path.join(frontendRoot, "out"),
  globPatterns: [
    // HTML pages (the app shell for every route)
    "**/*.html",
    // PWA manifest
    "manifest.webmanifest",
    // The manifest icons remain available before the app starts. Large imagery
    // is runtime-cached and must not compete with the JavaScript bootstrap.
    "icon*.png",
    "apple-icon.png",
  ],
  globIgnores: [
    // Source maps are published for debugging but should never consume the
    // offline precache budget.
    "**/*.map",
    // Exclude build metadata
    "_next/static/**/webpack-*",
    "_next/static/**/buildManifest.js",
  ],
  // Maximum individual file size (1 MB); the aggregate budget below also
  // prevents many smaller assets from silently bloating install traffic.
  // a video) should use runtime caching instead.
  maximumFileSizeToCacheInBytes: 1024 * 1024,
};

function assertPrecacheBudget(size) {
  if (size > PRECACHE_BUDGET_BYTES) {
    throw new Error(
      `Precache is ${(size / 1024).toFixed(0)} KB; budget is ${PRECACHE_BUDGET_BYTES / 1024} KB. ` +
      "Move role-specific or large assets to runtime caching.",
    );
  }
}

const cacheDir = path.join(frontendRoot, ".next", "cache", "sw");
const cacheManifestPath = path.join(cacheDir, "manifest.json");
const cacheSwPath = path.join(cacheDir, "sw.js");
const generatorPath = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
const workboxPackages = [
  "workbox-build",
  "workbox-core",
  "workbox-precaching",
  "workbox-routing",
  "workbox-strategies",
  "workbox-expiration",
  "workbox-cacheable-response",
];

/**
 * Semantic part of the workbox config — everything except the absolute paths
 * (swSrc/swDest/globDirectory). Absolute paths are excluded from the
 * fingerprint because their case differs by invocation context on Windows
 * (npm may resolve the workspace as "EKI" while a direct run uses "Eki"),
 * which would invalidate the cache spuriously.
 */
const fingerprintConfig = (() => {
  const { swSrc: _swSrc, swDest: _swDest, globDirectory: _globDirectory, ...semantic } = config;
  return semantic;
})();

/** Recursively collect file paths under a directory. */
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(target);
    return entry.isFile() ? [target] : [];
  }));
  return nested.flat();
}

/**
 * Return the exact immutable JS and CSS files each exported HTML shell needs
 * to hydrate while offline. Precaching these references prevents a newly
 * activated worker from serving HTML whose bootstrap has never been cached.
 */
async function bootstrapShellEntries() {
  const entries = new Map();
  let size = 0;
  const files = await walk(config.globDirectory);
  const htmlFiles = files.filter((file) => path.extname(file) === ".html");
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^\"]+\.(?:js|css))"/g)) {
      const url = match[1];
      if (entries.has(url)) continue;
      const contents = await readFile(path.join(config.globDirectory, url.slice(1)));
      if (contents.length > config.maximumFileSizeToCacheInBytes) {
        throw new Error(`Bootstrap asset ${url} exceeds the 1 MB precache-file limit.`);
      }
      entries.set(url, {
        url,
        revision: createHash("sha256").update(contents).digest("hex"),
      });
      size += contents.length;
    }
  }
  return {
    entries: [...entries.values()].sort((left, right) => left.url.localeCompare(right.url)),
    size,
  };
}

/**
 * Content fingerprint of every input that can change the precache manifest.
 * A stable hash over: the generator, resolved Workbox versions, semantic
 * workbox config, SW source, and all files under globDirectory (excluding our
 * own sw.js output).
 * `next build` regenerates out/ with fresh mtimes every run, so mtimes are
 * deliberately excluded.
 */
async function fingerprint() {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(fingerprintConfig));
  hash.update(await readFile(generatorPath));
  for (const packageName of workboxPackages) {
    const { version } = require(`${packageName}/package.json`);
    hash.update(`\n${packageName}@${version}\n`);
  }
  hash.update(await readFile(config.swSrc));
  const files = (await walk(config.globDirectory)).sort();
  for (const file of files) {
    if (path.resolve(file) === path.resolve(config.swDest)) continue; // our own output
    const relative = path.relative(config.globDirectory, file).replaceAll("\\", "/");
    hash.update(`\n${relative}\n`);
    hash.update(await readFile(file));
  }
  return hash.digest("hex");
}

/** Run the full workbox pipeline: inject precache manifest, then bundle. */
async function generate() {
  const bootstrap = await bootstrapShellEntries();
  const result = await injectManifest({
    ...config,
    additionalManifestEntries: bootstrap.entries,
  });

  // injectManifest replaces the precache placeholder but intentionally leaves
  // module imports untouched. Bundle the injected source so browsers receive a
  // self-contained classic service worker rather than unresolved bare imports.
  let unbundledCode = await readFile(swDest, "utf8");
  for (const packageName of workboxPackages.slice(1)) {
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

  return { ...result, size: result.size + bootstrap.size };
}

async function main() {
  const current = await fingerprint();

  // Replay the cached sw.js when every input is unchanged.
  try {
    const cachedManifest = JSON.parse(await readFile(cacheManifestPath, "utf8"));
    if (cachedManifest.fingerprint === current) {
      assertPrecacheBudget(cachedManifest.size);
      await copyFile(cacheSwPath, swDest);
      console.log(
        `✅ SW unchanged: ${cachedManifest.count} files precached (${(cachedManifest.size / 1024).toFixed(0)} KB total, cached)`
      );
      return;
    }
  } catch {
    // No cache yet (first build or cache cleared) — generate below.
  }

  const result = await generate();
  assertPrecacheBudget(result.size);

  await mkdir(cacheDir, { recursive: true });
  // The manifest is the commit marker: only publish it after its worker is
  // safely in place, so interrupted writes cannot replay a stale worker.
  await copyFile(swDest, cacheSwPath);
  await writeFile(
    cacheManifestPath,
    JSON.stringify({ fingerprint: current, count: result.count, size: result.size })
  );

  console.log(
    `✅ SW generated: ${result.count} files precached (${(result.size / 1024).toFixed(0)} KB total)`
  );

  if (result.warnings.length > 0) {
    console.warn("Warnings:");
    for (const warning of result.warnings) {
      console.warn(`  ⚠ ${warning}`);
    }
  }
}

await main();
