import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  COMPILE_HINT,
  initialChunkPaths,
  markLandingChunks,
  shiftSourceMapOneLine,
  withCompileHint,
} from "./compile-hints.mjs";

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

test("moves source map mappings and index-map sections down one line", () => {
  assert.equal(shiftSourceMapOneLine({ version: 3, mappings: "AAAA,CAAC" }).mappings, ";AAAA,CAAC");
  const indexMap = shiftSourceMapOneLine({ version: 3, sections: [{ offset: { line: 0, column: 0 }, map: {} }] });
  assert.deepEqual(indexMap.sections[0].offset, { line: 1, column: 0 });
  assert.throws(() => shiftSourceMapOneLine({ version: 3 }), /Unsupported source map/);
});

test("marks an export's landing chunks once, shifts their maps and leaves other chunks alone", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "eki-compile-hints-"));
  try {
    const chunks = path.join(outDir, "_next", "static", "chunks");
    await mkdir(chunks, { recursive: true });
    await writeFile(path.join(outDir, "index.html"),
      '<html><head><script src="/_next/static/chunks/a.js" async=""></script>' +
      '<script src="/_next/static/chunks/poly.js" noModule=""></script></head></html>');
    await writeFile(path.join(chunks, "a.js"), "console.log(1);\n//# sourceMappingURL=hash-a.js.map");
    await writeFile(path.join(chunks, "hash-a.js.map"), JSON.stringify({ version: 3, sources: ["a.ts"], mappings: "AAAA" }));
    await writeFile(path.join(chunks, "poly.js"), "polyfill();");
    await writeFile(path.join(chunks, "lazy.js"), "lazy();");

    const first = await markLandingChunks(outDir);
    assert.deepEqual(first.chunks, ["/_next/static/chunks/a.js"]);
    assert.equal(first.marked, 1);
    assert.ok(first.gzipBytes > 0);
    assert.equal(await readFile(path.join(chunks, "a.js"), "utf8"), `${COMPILE_HINT}\nconsole.log(1);\n//# sourceMappingURL=hash-a.js.map`);
    assert.equal(JSON.parse(await readFile(path.join(chunks, "hash-a.js.map"), "utf8")).mappings, ";AAAA");
    assert.equal(await readFile(path.join(chunks, "poly.js"), "utf8"), "polyfill();");
    assert.equal(await readFile(path.join(chunks, "lazy.js"), "utf8"), "lazy();");

    const second = await markLandingChunks(outDir);
    assert.equal(second.marked, 0);
    assert.equal(JSON.parse(await readFile(path.join(chunks, "hash-a.js.map"), "utf8")).mappings, ";AAAA");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("fails when the landing page loads no chunk, instead of silently skipping the hints", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "eki-compile-hints-"));
  try {
    await writeFile(path.join(outDir, "index.html"), "<html><body>No scripts</body></html>");
    await assert.rejects(markLandingChunks(outDir), /loads no \/_next\/static\/chunks/);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("the build marks chunks after next build and before the service worker fingerprints them", async () => {
  const { scripts } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const steps = scripts.build.split("&&").map((step) => step.trim());
  const nextBuild = steps.indexOf("npm run build --workspace=frontend");
  const hints = steps.indexOf("node scripts/compile-hints.mjs");
  const serviceWorker = steps.indexOf("node scripts/generate-sw.mjs");
  assert.ok(nextBuild >= 0 && hints > nextBuild && serviceWorker > hints, scripts.build);
});
