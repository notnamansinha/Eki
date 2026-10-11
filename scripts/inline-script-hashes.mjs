import { createHash } from "node:crypto";
import { parse } from "parse5";

/** Hash browser-parsed inline script text from the trusted static export. */
export function inlineScriptHashes(html) {
  const hashes = new Set();
  function visit(node) {
    if (node.tagName === "script" && !node.attrs.some(attr => attr.name === "src")) {
      const text = node.childNodes.map(child => child.value ?? "").join("");
      if (text) hashes.add(`'sha256-${createHash("sha256").update(text).digest("base64")}'`);
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(html));
  return hashes;
}
