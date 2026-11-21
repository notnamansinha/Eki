import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "parse5";

// Inline-script hashes of the static export, and where scripts/update-csp.mjs
// keeps them in firebase.json. The QA clean-tree check
// (scripts/qa/working-tree.mjs) uses the same functions, so it recognises
// exactly the hashes the build writes and nothing else.

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

function htmlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(target);
    return entry.isFile() && entry.name.endsWith(".html") ? [target] : [];
  });
}

/** Every inline-script hash in the HTML files below `directory` (the export), sorted. */
export function exportedInlineScriptHashes(directory) {
  const hashes = new Set();
  for (const file of htmlFiles(directory)) {
    for (const hash of inlineScriptHashes(readFileSync(file, "utf8"))) hashes.add(hash);
  }
  return [...hashes].sort();
}

/** The global (`**`) Content-Security-Policy header in firebase.json, or undefined. */
export function globalCspHeader(firebase) {
  const globalHeaders = firebase?.hosting?.headers?.find((entry) => entry?.source === "**");
  return globalHeaders?.headers?.find((header) => header?.key === "Content-Security-Policy");
}

/** Matches directive `name` with its sources and the separator before it. */
export function cspDirectivePattern(name) {
  return new RegExp(`(^|;\\s*)${name} [^;]*`);
}

// The form inlineScriptHashes() writes: SHA-256 in base64 is 43 characters and one "=".
const INLINE_SCRIPT_HASH = /^'sha256-[A-Za-z0-9+/]{43}='$/;

/**
 * `policy` with the inline-script hashes in its script-src replaced by
 * `hashes`, sorted, directly after 'self'. Every other source and directive is
 * kept as it is. Returns null when script-src is missing or does not start
 * with 'self'.
 */
export function withInlineScriptHashes(policy, hashes) {
  const match = cspDirectivePattern("script-src").exec(policy);
  if (!match) return null;
  const [self, ...sources] = match[0].slice(match[1].length + "script-src ".length).split(" ");
  if (self !== "'self'") return null;
  const directive = ["script-src", self, ...[...hashes].sort(),
    ...sources.filter((source) => !INLINE_SCRIPT_HASH.test(source))].join(" ");
  return `${policy.slice(0, match.index)}${match[1]}${directive}${policy.slice(match.index + match[0].length)}`;
}
