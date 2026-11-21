/**
 * compile-hints.mjs — Post-build step (#498): mark the landing page's initial
 * JavaScript chunks for eager compilation, and keep that JavaScript in budget.
 *
 * Without a hint, V8 compiles each Turbopack module factory lazily on the main
 * thread the first time the runtime instantiates it. On `/` that compilation
 * was most of the single hydration long task, and it grows with a slower CPU.
 * Chromium compiles every function of a script whose first line is the magic
 * comment `//# allFunctionsCalledOnLoad` eagerly, on the background thread
 * that streams the async script, so hydration no longer waits for it. Other
 * browsers treat the line as an ordinary comment.
 *
 * Only the chunks that `out/index.html` loads with a `<script src>` are marked:
 * the framework, root layout and landing page code that runs at load. Chunks
 * loaded later (Firebase, Maps, workspaces) keep lazy compilation. The step
 * runs after `next build` and before `scripts/generate-sw.mjs`, which
 * fingerprints the final chunk contents. It is idempotent, and it moves each
 * marked chunk's source map down one line so production stack traces still
 * resolve.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { parse } from "parse5";

export const COMPILE_HINT = "//# allFunctionsCalledOnLoad";

/**
 * Gzip budget for the module JavaScript that `/` loads at start-up (the
 * `nomodule` polyfill is excluded). It was about 152 KiB when this was set.
 * Hydration cost follows this size, so raise it only for a measured reason.
 */
export const LANDING_JS_GZIP_BUDGET_BYTES = 170 * 1024;

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

/** Move every mapping of a source map down one generated line. */
export function shiftSourceMapOneLine(map) {
  if (typeof map.mappings === "string") return { ...map, mappings: `;${map.mappings}` };
  if (Array.isArray(map.sections)) {
    return {
      ...map,
      sections: map.sections.map((section) => ({
        ...section,
        offset: { ...section.offset, line: section.offset.line + 1 },
      })),
    };
  }
  throw new Error("Unsupported source map: neither mappings nor sections.");
}

/**
 * Marks the landing page's initial chunks in an exported `out/` directory.
 * Returns the chunks, how many were newly marked and their total gzip size.
 */
export async function markLandingChunks(outDir) {
  const html = await readFile(path.join(outDir, "index.html"), "utf8");
  const chunks = initialChunkPaths(html);
  if (chunks.length === 0) {
    throw new Error("index.html loads no /_next/static/chunks/*.js script. Did the Next.js export format change?");
  }
  let marked = 0;
  let gzipBytes = 0;
  for (const src of chunks) {
    const file = path.join(outDir, ...src.split("/").filter(Boolean));
    const original = await readFile(file, "utf8");
    const { source, changed } = withCompileHint(original);
    if (changed) {
      await writeFile(file, source);
      const mapRef = original.match(/\/\/# sourceMappingURL=(\S+)\s*$/)?.[1];
      if (mapRef && !mapRef.startsWith("data:")) {
        const mapFile = path.join(path.dirname(file), mapRef);
        const map = JSON.parse(await readFile(mapFile, "utf8"));
        await writeFile(mapFile, JSON.stringify(shiftSourceMapOneLine(map)));
      }
      marked++;
    }
    gzipBytes += gzipSync(source, { level: 9 }).length;
  }
  return { chunks, marked, gzipBytes };
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  const outDir = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "..", "frontend", "out"));
  const { chunks, marked, gzipBytes } = await markLandingChunks(outDir);
  const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
  console.log(`Compile hints: ${chunks.length} landing chunks (${marked} newly marked), ${kib(gzipBytes)} gzip.`);
  if (gzipBytes > LANDING_JS_GZIP_BUDGET_BYTES) {
    console.error(
      `The landing page loads ${kib(gzipBytes)} of gzipped JavaScript at start-up; ` +
      `the budget is ${kib(LANDING_JS_GZIP_BUDGET_BYTES)} (scripts/compile-hints.mjs). ` +
      "Keep new client code off / (lazy-load it), or raise the budget with measured TBT numbers.",
    );
    process.exit(1);
  }
}
