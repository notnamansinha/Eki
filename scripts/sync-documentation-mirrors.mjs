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

export function normalizedFile(path) {
  return readFileSync(resolve(repositoryRoot, path), "utf8")
    .replace(/\r\n/g, "\n")
    .trimEnd();
}

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

export function mirrorPath(source) {
  if (source.startsWith(".github/")) {
    return `docs/github/${source.slice(".github/".length)}`;
  }
  if (!source.includes("/")) return `docs/repository/${source}`;
  return `docs/${source}`;
}

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
  let rewritten = sources.has(decoded)
    ? // mirrorPath only moves the folder, so the author's escaped file name is kept.
      posix.join(posix.relative(from, posix.dirname(mirrorPath(decoded))), posix.basename(target))
    : posix.relative(from, target) || ".";
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

// Code spans are matched first so that link-like text inside them is left alone.
// Inline destinations allow one level of balanced parentheses, as CommonMark does.
const inlineSyntax =
  /(`+)[^\n]*?\1|(\]\()(<[^>\n]*>|[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)|^( {0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]*>|\S+)/gm;

const markdown = new MarkdownIt({ html: true });

/** Lines that hold code or raw HTML, where text is never a Markdown link. */
function literalLines(content) {
  const lines = new Set();
  for (const token of markdown.parse(content, {})) {
    if (token.map && (token.type === "fence" || token.type === "code_block" || token.type === "html_block")) {
      for (let line = token.map[0]; line < token.map[1]; line += 1) lines.add(line);
    }
  }
  return lines;
}

/** The mirror text for `content`, which is the normalized text of `source`. */
export function mirrorContent(source, content, sources = new Set(documentationSources())) {
  const mirror = mirrorPath(source);
  const literal = literalLines(content);
  return content
    .split("\n")
    .map((line, index) =>
      literal.has(index)
        ? line
        : line.replace(inlineSyntax, (match, ticks, open, inline, definition, reference) => {
            if (ticks) return match;
            if (open) return `${open}${rewriteWrapped(inline, source, mirror, sources)}`;
            return `${definition}${rewriteWrapped(reference, source, mirror, sources)}`;
          }),
    )
    .join("\n");
}

export function expectedMirror(source, sources = new Set(documentationSources())) {
  return mirrorContent(source, normalizedFile(source), sources);
}

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
