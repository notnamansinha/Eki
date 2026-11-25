import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  COMPILE_HINT,
  LANDING_JS_GZIP_BUDGET_BYTES,
  SHIFTED_MAP_MARKER,
  initialChunkPaths,
  landingBudgetReport,
  markLandingChunks,
  shiftSourceMapOneLine,
  sourceMapPathname,
  withCompileHint,
} from "./compile-hints.mjs";

const script = fileURLToPath(new URL("./compile-hints.mjs", import.meta.url));

/** A temporary export with index.html loading `a.js` (mapped) and a nomodule polyfill. */
async function withExport(run, { chunk = "console.log(1);\n//# sourceMappingURL=hash-a.js.map" } = {}) {
  const outDir = await mkdtemp(path.join(tmpdir(), "eki-compile-hints-"));
  const chunks = path.join(outDir, "_next", "static", "chunks");
  try {
    await mkdir(chunks, { recursive: true });
    await writeFile(path.join(outDir, "index.html"),
      '<html><head><script src="/_next/static/chunks/a.js" async=""></script>' +
      '<script src="/_next/static/chunks/poly.js" noModule=""></script></head></html>');
    await writeFile(path.join(chunks, "a.js"), chunk);
    await writeFile(path.join(chunks, "hash-a.js.map"), JSON.stringify({ version: 3, sources: ["a.ts"], mappings: "AAAA" }));
    await writeFile(path.join(chunks, "poly.js"), "polyfill();");
    await writeFile(path.join(chunks, "lazy.js"), "lazy();");
    await run({ outDir, chunks });
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}
const readMap = async (chunks) => JSON.parse(await readFile(path.join(chunks, "hash-a.js.map"), "utf8"));

test("selects the async module chunks a page loads, not the nomodule polyfill or other scripts", () => {
  const html = [
    '<script src="/_next/static/chunks/0e_osw83rtyyq.js" async=""></script>',
    '<script src="/_next/static/chunks/turbopack-0zq_vp9s-5ndp.js" async=""></script>',
    '<script src="/_next/static/chunks/0cz1d0mv5g_q7.js" noModule=""></script>',
    '<script id="_R_">self.__next_f=[]</script>',
    '<script src="https://example.invalid/x.js"></script>',
    '<link rel="preload" as="script" href="/_next/static/chunks/preloaded.js"/>',
    '<!-- <script src="/_next/static/chunks/commented.js"></script> -->',
    '<script src="/_next/static/chunks/0e_osw83rtyyq.js" async=""></script>',
  ].join("");
  assert.deepEqual(initialChunkPaths(html), [
    "/_next/static/chunks/0e_osw83rtyyq.js",
    "/_next/static/chunks/turbopack-0zq_vp9s-5ndp.js",
  ]);
});

test("rejects chunk paths that could leave the chunk directory", () => {
  assert.deepEqual(initialChunkPaths('<script src="/_next/static/chunks/../../../secret.js"></script>'), []);
});

test("puts the hint on the first line exactly once", () => {
  const first = withCompileHint("(()=>{})();\n//# sourceMappingURL=a.js.map");
  assert.equal(first.changed, true);
  assert.equal(first.source.split("\n")[0], COMPILE_HINT);
  const again = withCompileHint(first.source);
  assert.equal(again.changed, false);
  assert.equal(again.source, first.source);
});

test("finds relative and root-relative source maps, including before a debugId line", () => {
  const src = "/_next/static/chunks/a.js";
  assert.equal(sourceMapPathname("x();\n//# sourceMappingURL=h.js.map", src), "/_next/static/chunks/h.js.map");
  assert.equal(sourceMapPathname("x();\r\n//# sourceMappingURL=h.js.map\r\n", src), "/_next/static/chunks/h.js.map");
  assert.equal(sourceMapPathname("x();\n//# sourceMappingURL=/_next/static/maps/h.map\n//# debugId=1234", src), "/_next/static/maps/h.map");
  assert.equal(sourceMapPathname("x();", src), null);
});

test("refuses source map references it cannot move safely", () => {
  const src = "/_next/static/chunks/a.js";
  assert.throws(() => sourceMapPathname("x();\n/*# sourceMappingURL=h.js.map */", src), /at most one/);
  assert.throws(() => sourceMapPathname("x();//# sourceMappingURL=h.js.map", src), /at most one/);
  assert.throws(() => sourceMapPathname("x();\n//# sourceMappingURL=a.map\n//# sourceMappingURL=b.map", src), /at most one/);
  assert.throws(() => sourceMapPathname("x();\n//# sourceMappingURL=data:application/json;base64,e30=", src), /inline/);
  assert.throws(() => sourceMapPathname("x();\n//# sourceMappingURL=https://cdn.invalid/h.map", src), /outside/);
  assert.throws(() => sourceMapPathname("x();\n//# sourceMappingURL=../../../../secret.map", src), /outside/);
});

test("moves a flat source map down one line, marks it and refuses other map shapes", () => {
  const flat = shiftSourceMapOneLine({ version: 3, mappings: "AAAA,CAAC" });
  assert.equal(flat.mappings, ";AAAA,CAAC");
  assert.equal(flat[SHIFTED_MAP_MARKER], 1);
  assert.throws(() => shiftSourceMapOneLine({ version: 3, sections: [] }), /Unsupported source map/);
});

test("marks an export's landing chunks once, shifts their maps and leaves other chunks alone", () => withExport(async ({ outDir, chunks }) => {
  const first = await markLandingChunks(outDir);
  assert.deepEqual(first.chunks, ["/_next/static/chunks/a.js"]);
  assert.equal(first.marked, 1);
  assert.deepEqual(first.sizes.map(({ src }) => src), ["/_next/static/chunks/a.js"]);
  assert.ok(first.sizes[0].gzipBytes > 0);
  assert.equal(await readFile(path.join(chunks, "a.js"), "utf8"), `${COMPILE_HINT}\nconsole.log(1);\n//# sourceMappingURL=hash-a.js.map`);
  assert.equal((await readMap(chunks)).mappings, ";AAAA");
  assert.equal(await readFile(path.join(chunks, "poly.js"), "utf8"), "polyfill();");
  assert.equal(await readFile(path.join(chunks, "lazy.js"), "utf8"), "lazy();");

  const second = await markLandingChunks(outDir);
  assert.equal(second.marked, 0);
  assert.equal((await readMap(chunks)).mappings, ";AAAA");
}));

test("finishes a run that stopped after moving a map, without moving it twice", () => withExport(async ({ outDir, chunks }) => {
  await writeFile(path.join(chunks, "hash-a.js.map"), JSON.stringify(shiftSourceMapOneLine(await readMap(chunks))));
  const result = await markLandingChunks(outDir);
  assert.equal(result.marked, 1);
  assert.equal((await readMap(chunks)).mappings, ";AAAA");
  assert.ok((await readFile(path.join(chunks, "a.js"), "utf8")).startsWith(`${COMPILE_HINT}\n`));
}));

test("stops when a chunk already has the hint but its map was not moved by this step", () => withExport(async ({ outDir, chunks }) => {
  await assert.rejects(markLandingChunks(outDir), /was not moved by this step/);
  assert.equal((await readMap(chunks)).mappings, "AAAA");
}, { chunk: `${COMPILE_HINT}\nconsole.log(1);\n//# sourceMappingURL=hash-a.js.map` }));

test("fails when the landing page loads no chunk, instead of silently skipping the hints", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "eki-compile-hints-"));
  try {
    await writeFile(path.join(outDir, "index.html"), "<html><body>No scripts</body></html>");
    await assert.rejects(markLandingChunks(outDir), /loads no \/_next\/static\/chunks/);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("reports the budget with the largest chunks first", () => {
  const atBudget = [{ src: "/small.js", gzipBytes: 1024 }, { src: "/big.js", gzipBytes: LANDING_JS_GZIP_BUDGET_BYTES - 1024 }];
  assert.equal(landingBudgetReport(atBudget).ok, true);
  const over = landingBudgetReport([{ src: "/small.js", gzipBytes: 1024 }, { src: "/big.js", gzipBytes: LANDING_JS_GZIP_BUDGET_BYTES }]);
  assert.equal(over.ok, false);
  assert.equal(over.total, LANDING_JS_GZIP_BUDGET_BYTES + 1024);
  assert.ok(over.message.indexOf("/big.js") < over.message.indexOf("/small.js"), over.message);
  assert.match(over.message, /LANDING_JS_GZIP_BUDGET_BYTES/);
});

test("the command marks an export and exits non-zero only when the budget is exceeded", () => withExport(async ({ outDir, chunks }) => {
  const output = execFileSync(process.execPath, [script, outDir], { encoding: "utf8" });
  assert.match(output, /1 landing chunks \(1 newly marked\)/);
  // Incompressible content just over the budget.
  const filler = randomBytes(LANDING_JS_GZIP_BUDGET_BYTES).toString("base64");
  await writeFile(path.join(chunks, "a.js"), `${COMPILE_HINT}\nconst filler = "${filler}";\n//# sourceMappingURL=hash-a.js.map`);
  assert.throws(
    () => execFileSync(process.execPath, [script, outDir], { encoding: "utf8", stdio: "pipe" }),
    (error) => error.status === 1 && /budget is 170\.0 KiB/.test(error.stderr) && /\/_next\/static\/chunks\/a\.js/.test(error.stderr),
  );
}));

test("the build marks chunks after next build and before the service worker fingerprints them", async () => {
  const { scripts } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const steps = scripts.build.split("&&").map((step) => step.trim());
  const nextBuild = steps.indexOf("npm run build --workspace=frontend");
  const hints = steps.indexOf("node scripts/compile-hints.mjs");
  const serviceWorker = steps.indexOf("node scripts/generate-sw.mjs");
  assert.ok(nextBuild >= 0 && hints > nextBuild && serviceWorker > hints, scripts.build);
});
