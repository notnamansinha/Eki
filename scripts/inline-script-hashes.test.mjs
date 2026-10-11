import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { inlineScriptHashes } from "./inline-script-hashes.mjs";
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
