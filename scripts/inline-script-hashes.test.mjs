import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  exportedInlineScriptHashes,
  globalCspHeader,
  inlineScriptHashes,
  withInlineScriptHashes,
} from "./inline-script-hashes.mjs";
const hash = value => `'sha256-${createHash("sha256").update(value).digest("base64")}'`;

test("hashes parsed inline scripts with quoted attributes and HTML closing-tag whitespace", () => {
  assert.deepEqual([...inlineScriptHashes('<SCRIPT data-note=">" data-src="label">run()</SCRIPT >')], [hash("run()")]);
});
test("ignores external scripts, comments and inert template content", () => {
  const html = '<!-- <script>comment()</script> --><template><script>inert()</script></template><SCRIPT SRC="/a.js">fallback()</SCRIPT><script>live()</script>';
  assert.deepEqual([...inlineScriptHashes(html)], [hash("live()")]);
});
test("normalizes browser script newlines without decoding raw-text character references", () => {
  assert.deepEqual([...inlineScriptHashes('<script>one\r\n&amp;two</script>')], [hash("one\n&amp;two")]);
});
test("deduplicates identical script bodies and skips empty scripts", () => {
  assert.deepEqual([...inlineScriptHashes('<script></script><script>a()</script><script>a()</script>')], [hash("a()")]);
});
test("collects the sorted hashes of every exported HTML file, nested pages included", async (t) => {
  const scratch = fileURLToPath(new URL("../temp/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const out = await mkdtemp(path.join(scratch, "eki-export-"));
  t.after(() => rm(out, { recursive: true, force: true }));
  await mkdir(path.join(out, "admin"));
  await writeFile(path.join(out, "index.html"), "<script>b()</script><script>a()</script>");
  await writeFile(path.join(out, "admin", "index.html"), "<script>a()</script><script>c()</script>");
  await writeFile(path.join(out, "admin", "data.txt"), "<script>not html()</script>");
  assert.deepEqual(exportedInlineScriptHashes(out), [hash("a()"), hash("b()"), hash("c()")].sort());
});
test("finds the global CSP header the build rewrites", () => {
  const csp = { key: "Content-Security-Policy", value: "default-src 'self'" };
  const firebase = { hosting: { headers: [{ source: "/sw.js", headers: [{ key: "Content-Security-Policy", value: "x" }] },
    { source: "**", headers: [{ key: "X-Frame-Options", value: "DENY" }, csp] }] } };
  assert.equal(globalCspHeader(firebase), csp);
  assert.equal(globalCspHeader({}), undefined);
});
test("replaces only the script-src inline-script hashes, sorted after 'self'", () => {
  const [old1, old2, a, b] = ["old1()", "old2()", "a()", "b()"].map(hash);
  const policy = `default-src 'self'; script-src 'self' ${old1} ${old2} https://apis.google.com 'nonce-x'; style-src 'self' ${old1}; object-src 'none'`;
  assert.equal(withInlineScriptHashes(policy, [b, a]),
    `default-src 'self'; script-src 'self' ${[a, b].sort().join(" ")} https://apis.google.com 'nonce-x'; style-src 'self' ${old1}; object-src 'none'`);
  // A final, unterminated script-src and a policy with no hashes yet.
  assert.equal(withInlineScriptHashes("script-src 'self' https://a.test", [a]), `script-src 'self' ${a} https://a.test`);
  // A hash-like source that is not a SHA-256 of the form the build writes is kept.
  assert.equal(withInlineScriptHashes("script-src 'self' 'sha256-short='", [a]), `script-src 'self' ${a} 'sha256-short='`);
});
test("declines a policy whose script-src the build does not write", () => {
  assert.equal(withInlineScriptHashes("default-src 'self'; script-src-elem 'self'", []), null);
  assert.equal(withInlineScriptHashes("script-src https://a.test 'self'", []), null);
});
