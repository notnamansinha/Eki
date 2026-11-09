import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";

// Generates docs/ mirrors of every tracked Markdown document outside docs/.
// backend/src/docsMirror.test.ts imports these functions, so each rewrite rule
// exists once and the test's independent link check is the real check on it.

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const outputEol = process.platform === "win32" ? "\r\n" : "\n";

/** The text of a repository file with LF line endings and no trailing whitespace. */
export function normalizedFile(path) {
  return readFileSync(resolve(repositoryRoot, path), "utf8")
    .replace(/\r\n/g, "\n")
    .trimEnd();
}

/** Tracked Markdown documents outside docs/, which are the mirror sources. */
export function documentationSources() {
  return execFileSync("git", ["ls-files"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((path) => !path.startsWith("docs/"))
    .filter((path) => path.toLowerCase().endsWith(".md") || path.endsWith("/README"));
}

/** The docs/ path that mirrors the repository path `source`. */
export function mirrorPath(source) {
  if (source.startsWith(".github/")) {
    return `docs/github/${source.slice(".github/".length)}`;
  }
  if (!source.includes("/")) return `docs/repository/${source}`;
  return `docs/${source}`;
}

/** `value` with percent-encoding decoded, or unchanged if it is malformed. */
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Rewrites one link destination written in `source` so that it reaches the
 * same place from `mirror`. A link to another mirrored document points at that
 * document's mirror, so the docs/ tree stays self-contained; every other
 * relative link points back at the file or folder the author linked.
 */
function rewriteDestination(destination, source, mirror, sources) {
  if (!destination || destination.startsWith("#") || destination.startsWith("/")) return destination;
  if (/^[a-z][a-z0-9+.-]*:/i.test(destination)) return destination;
  const suffixAt = destination.search(/[?#]/);
  const path = suffixAt === -1 ? destination : destination.slice(0, suffixAt);
  const suffix = suffixAt === -1 ? "" : destination.slice(suffixAt);
  if (!path) return destination;
  const target = posix.normalize(posix.join(posix.dirname(source), path));
  if (target === ".." || target.startsWith("../")) return destination;
  const decoded = safeDecode(target);
  const from = posix.dirname(mirror);
  // mirrorPath only changes the leading folder, so the author's percent-encoding is kept.
  let rewritten = sources.has(decoded) ? posix.relative(from, mirrorPath(target)) : posix.relative(from, target) || ".";
  if (path.endsWith("/") && !rewritten.endsWith("/")) rewritten += "/";
  return `${rewritten}${suffix}`;
}

/** Handles the `<path with spaces>` destination form. */
function rewriteWrapped(destination, ...context) {
  if (destination.startsWith("<") && destination.endsWith(">")) {
    return `<${rewriteDestination(destination.slice(1, -1), ...context)}>`;
  }
  return rewriteDestination(destination, ...context);
}

// A destination may start on the line after `](` or `]:`, behind blockquote markers.
const destinationGap = String.raw`[ \t]*(?:\n[ \t>]*)?`;
// One level of balanced parentheses is allowed, as CommonMark does.
const destination = String.raw`<[^>\n]*>|[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*`;
// One attribute of an inline HTML tag.
const htmlAttribute = String.raw`\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>\x60]+|'[^']*'|"[^"]*"))?`;

// Matched from left to right, so whichever starts first wins, as in CommonMark:
// an escaped character, a code span, an unmatched backtick run, an inline HTML
// tag or comment, or an inline link destination. Only the last is rewritten.
// \x60 is a backtick.
const inlineSyntax = new RegExp(
  [
    String.raw`\\[!-/:-@[-\x60{-~]`,
    String.raw`(\x60+)(?!\x60)[\s\S]*?(?<!\x60)\1(?!\x60)`,
    String.raw`\x60+`,
    String.raw`<[A-Za-z][A-Za-z0-9-]*(?:${htmlAttribute})*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>|<!--[\s\S]*?-->`,
    String.raw`(\]\(${destinationGap})(${destination})`,
  ].join("|"),
  "g",
);

// A reference definition may sit inside blockquotes or list items.
const definitionSyntax = new RegExp(
  String.raw`^((?:[ \t]*(?:>|[-+*][ \t]|\d{1,9}[.)][ \t]))*[ \t]*\[[^\]\n]+\]:${destinationGap})(<[^>\n]*>|\S+)`,
  "gm",
);

const markdown = new MarkdownIt({ html: true });
const containers = new Set(["blockquote_open", "bullet_list_open", "ordered_list_open", "list_item_open"]);
const inlineBlocks = new Set(["paragraph_open", "heading_open", "tr_open"]);

/**
 * Splits `content` into runs of lines: Markdown text (a paragraph, heading or
 * table row), reference definitions, or anything else, which is copied as is.
 * markdown-it decides; it emits no block for a reference definition, so a
 * non-blank line that no block covers holds one.
 */
function lineRuns(content) {
  const lines = content.split("\n");
  const covered = new Array(lines.length).fill(false);
  const textEnd = new Map();
  for (const token of markdown.parse(content, {})) {
    if (!token.map || containers.has(token.type)) continue;
    covered.fill(true, token.map[0], token.map[1]);
    if (inlineBlocks.has(token.type)) textEnd.set(token.map[0], token.map[1]);
  }
  /** Whether `line` is part of a reference definition. */
  const definition = (line) => line < lines.length && !covered[line] && !/^[ \t>]*$/.test(lines[line]);
  const runs = [];
  for (let start = 0; start < lines.length; ) {
    let end = start + 1;
    let kind = "other";
    if (textEnd.has(start)) {
      kind = "text";
      end = textEnd.get(start);
    } else if (definition(start)) {
      kind = "definitions";
      while (definition(end)) end += 1;
    }
    runs.push({ kind, text: lines.slice(start, end).join("\n") });
    start = end;
  }
  return runs;
}

/** The mirror text for `content`, which is the normalized text of `source`. */
export function mirrorContent(source, content, sources = new Set(documentationSources())) {
  const context = [source, mirrorPath(source), sources];
  return lineRuns(content)
    .map(({ kind, text }) => {
      if (kind === "text") {
        return text.replace(inlineSyntax, (match, ticks, open, inline) =>
          open ? `${open}${rewriteWrapped(inline, ...context)}` : match,
        );
      }
      if (kind === "definitions") {
        return text.replace(
          definitionSyntax,
          (match, label, reference) => `${label}${rewriteWrapped(reference, ...context)}`,
        );
      }
      return text;
    })
    .join("\n");
}

/** The mirror text for the tracked document `source`. */
export function expectedMirror(source, sources = new Set(documentationSources())) {
  return mirrorContent(source, normalizedFile(source), sources);
}

/** Writes the mirror of every documentation source. */
export function syncDocumentationMirrors() {
  const sources = new Set(documentationSources());
  for (const source of sources) {
    const target = resolve(repositoryRoot, mirrorPath(source));
    mkdirSync(dirname(target), { recursive: true });
    const content = expectedMirror(source, sources).replaceAll("\n", outputEol);
    writeFileSync(target, `${content}${outputEol}`, "utf8");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  syncDocumentationMirrors();
}
