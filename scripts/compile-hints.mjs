/**
 * compile-hints.mjs — Post-build step (#498): mark the landing page's initial
 * JavaScript chunks for eager compilation, and keep that JavaScript in budget.
 *
 * Without a hint, V8 compiles each Turbopack module factory lazily on the main
 * thread the first time the runtime instantiates it. On `/` that compilation
 * was most of the single hydration long task, and it grows with a slower CPU.
 * Chromium compiles every function of a script whose first line is the magic
 * comment `//# allFunctionsCalledOnLoad` eagerly, on the background thread
 * that streams the async script, so hydration no longer waits for it on the
 * main thread. Other browsers treat the line as an ordinary comment. The cost:
 * every function in these files is compiled, including ones never called,
 * which takes background CPU time and memory, and a streamed script runs only
 * once its background compilation has finished.
 *
 * Only the chunks that `out/index.html` loads with a `<script src>` are marked:
 * the framework, root layout and landing page code that runs at load. Chunks
 * loaded later (Firebase, Maps, workspaces) keep lazy compilation. The step
 * runs after `next build` and before `scripts/generate-sw.mjs`, which
 * fingerprints the final chunk contents. Each marked chunk's source map moves
 * down one line so production stack traces still resolve.
 *
 * Keep this step comment-only. Chunk names are content hashes computed before
 * it runs, so they do not change, and Hosting serves `/_next/static/**` as
 * immutable for a year: a browser may keep an unmarked copy until the names
 * change. That is harmless only because marked and unmarked files behave the
 * same. Any change that alters behaviour needs new file names.
 */
import { readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { parse } from "parse5";

export const COMPILE_HINT = "//# allFunctionsCalledOnLoad";

/** Set in a source map that this step has already moved down one line. */
export const SHIFTED_MAP_MARKER = "x_eki_compile_hint_shift";

/**
 * Gzip budget for the module JavaScript that `/` loads at start-up (the
 * `nomodule` polyfill is excluded). It was 152.4 KiB when this was set, most
 * of it React DOM and the Next.js runtime. Hydration cost follows this size,
 * so raise it only for a measured reason.
 */
export const LANDING_JS_GZIP_BUDGET_BYTES = 170 * 1024;

const EXPORT_ORIGIN = "https://export.invalid";

/** `/_next/static/chunks/*.js` paths loaded by `<script src>`, without `nomodule` ones. */
export function initialChunkPaths(html) {
  const paths = new Set();
  function visit(node) {
    if (node.tagName === "script") {
      const attrs = new Map(node.attrs.map((attr) => [attr.name, attr.value]));
      const src = attrs.get("src");
      if (src && !attrs.has("nomodule") && /^\/_next\/static\/chunks\/[\w.-]+\.js$/.test(src)) paths.add(src);
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(html));
  return [...paths];
}

/** Prepend the hint as the first line unless the source already starts with it. */
export function withCompileHint(source) {
  if (source.startsWith(`${COMPILE_HINT}\n`)) return { source, changed: false };
  return { source: `${COMPILE_HINT}\n${source}`, changed: true };
}

/**
 * The export path of a chunk's external source map, or null when the chunk
 * has no source map comment. Throws for any reference this step cannot move
 * safely, so a change in the Next.js output fails the build instead of
 * shipping maps that are one line off.
 */
export function sourceMapPathname(source, src) {
  const refs = [...source.matchAll(/^\/\/[#@] sourceMappingURL=(\S+)[ \t]*\r?$/gm)].map((match) => match[1]);
  const mentions = source.match(/[#@] sourceMappingURL=/g)?.length ?? 0;
  if (refs.length !== mentions || refs.length > 1) {
    throw new Error(`${src}: expected at most one "//# sourceMappingURL=" comment on its own line.`);
  }
  if (refs.length === 0) return null;
  if (refs[0].startsWith("data:")) throw new Error(`${src}: inline source maps are not supported.`);
  const url = new URL(refs[0], `${EXPORT_ORIGIN}${src}`);
  if (url.origin !== EXPORT_ORIGIN || !url.pathname.startsWith("/_next/static/")) {
    throw new Error(`${src}: source map ${refs[0]} is outside /_next/static/.`);
  }
  return decodeURIComponent(url.pathname);
}

/** Move every mapping of a flat source map down one generated line, and mark the map as moved. */
export function shiftSourceMapOneLine(map) {
  if (typeof map.mappings !== "string") throw new Error("Unsupported source map: expected a flat map with mappings.");
  return { ...map, mappings: `;${map.mappings}`, [SHIFTED_MAP_MARKER]: 1 };
}

/** The file in the export directory that a site path such as `/_next/static/chunks/a.js` serves. */
function fileForUrlPath(outDir, urlPath) {
  return path.join(outDir, ...urlPath.split("/").filter(Boolean));
}

/**
 * Marks the landing page's initial chunks in an exported `out/` directory.
 * Each map is written before its chunk, and a map carries a marker once
 * moved, so a run that stopped half-way can be repeated safely.
 * Returns the chunks, how many were newly marked and each chunk's gzip size.
 */
export async function markLandingChunks(outDir) {
  const html = await readFile(path.join(outDir, "index.html"), "utf8");
  const chunks = initialChunkPaths(html);
  if (chunks.length === 0) {
    throw new Error("index.html loads no /_next/static/chunks/*.js script. Did the Next.js export format change?");
  }
  let marked = 0;
  const sizes = [];
  for (const src of chunks) {
    const file = fileForUrlPath(outDir, src);
    const original = await readFile(file, "utf8");
    const { source, changed } = withCompileHint(original);
    const mapPathname = sourceMapPathname(original, src);
    if (mapPathname) {
      const mapFile = fileForUrlPath(outDir, mapPathname);
      const map = JSON.parse(await readFile(mapFile, "utf8"));
      if (map[SHIFTED_MAP_MARKER] !== 1) {
        // A chunk that already starts with the hint but whose map was never
        // moved was marked by something else; its map may already be right.
        if (!changed) throw new Error(`${src} already starts with the compile hint, but ${mapPathname} was not moved by this step.`);
        await writeFile(mapFile, JSON.stringify(shiftSourceMapOneLine(map)));
      }
    }
    if (changed) {
      await writeFile(file, source);
      marked++;
    }
    sizes.push({ src, gzipBytes: gzipSync(source, { level: 9 }).length });
  }
  return { chunks, marked, sizes };
}

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

/** Budget verdict with the chunks listed largest first, so a failure shows what grew. */
export function landingBudgetReport(sizes) {
  const budget = LANDING_JS_GZIP_BUDGET_BYTES;
  const total = sizes.reduce((sum, { gzipBytes }) => sum + gzipBytes, 0);
  const table = [...sizes]
    .sort((a, b) => b.gzipBytes - a.gzipBytes)
    .map(({ src, gzipBytes }) => `  ${kib(gzipBytes).padStart(10)}  ${src}`)
    .join("\n");
  if (total <= budget) return { ok: true, total, message: `${kib(total)} gzip of ${kib(budget)} budget.` };
  return {
    ok: false,
    total,
    message:
      `The landing page loads ${kib(total)} of gzipped JavaScript at start-up; the budget is ${kib(budget)} ` +
      "(LANDING_JS_GZIP_BUDGET_BYTES in scripts/compile-hints.mjs). Chunks, largest first:\n" +
      `${table}\n` +
      "If app code grew, keep it off / (lazy-load it). If a Next.js or React update grew the framework chunks, " +
      "measure the landing page's total blocking time and raise the budget in the same change.",
  };
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const outDir = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "..", "frontend", "out"));
  const { chunks, marked, sizes } = await markLandingChunks(outDir);
  const report = landingBudgetReport(sizes);
  console.log(`Compile hints: ${chunks.length} landing chunks (${marked} newly marked), ${report.ok ? report.message : kib(report.total)}`);
  if (!report.ok) {
    console.error(report.message);
    process.exitCode = 1;
  }
}
