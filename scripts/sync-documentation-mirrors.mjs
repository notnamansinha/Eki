import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputEol = process.platform === "win32" ? "\r\n" : "\n";

function normalizedFile(path) {
  return readFileSync(resolve(repositoryRoot, path), "utf8")
    .replace(/\r\n/g, "\n")
    .trimEnd();
}

function documentationSources() {
  return execFileSync("git", ["ls-files"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((path) => !path.startsWith("docs/"))
    .filter((path) => path.toLowerCase().endsWith(".md") || path.endsWith("/README"));
}

function mirrorPath(source) {
  if (source.startsWith(".github/")) {
    return `docs/github/${source.slice(".github/".length)}`;
  }
  if (!source.includes("/")) return `docs/repository/${source}`;
  return `docs/${source}`;
}

function expectedMirror(source) {
  let content = normalizedFile(source);
  if (source === "README.md") {
    content = content
      .replaceAll("](docs/", "](../")
      .replaceAll("](backend/", "](../backend/")
      .replaceAll("](frontend/", "](../frontend/")
      .replaceAll("](LICENSE)", "](../../LICENSE)")
      .replaceAll("](hardware/", "](../hardware/");
  } else if (!source.includes("/")) {
    content = content
      .replaceAll("](docs/", "](../")
      .replaceAll("](.github/", "](../../.github/");
  } else if (source === "hardware/README.md") {
    content = content
      .replaceAll("](../docs/hardware/", "](")
      .replaceAll("](../docs/operations/", "](../operations/")
      .replaceAll("](../docs/", "](../")
      .replaceAll("](../backend/", "](../../backend/")
      .replaceAll("](../frontend/", "](../../frontend/");
  } else if (/^(backend|deploy|e2e|frontend|hardware|qa)\//.test(source)) {
    // The mirror sits one folder deeper, under docs/, so a link written as
    // "../" repeated once per source folder level, then "docs/<path>", needs
    // the same "../" run followed by "<path>". Dropping "docs/" from the
    // "../docs/" suffix does that at any depth: "../../docs/x" becomes "../../x".
    // backend/src/docsMirror.test.ts checks that every such link resolves.
    content = content.replaceAll("../docs/", "../");
  }
  if (source.startsWith("backend/")) {
    content = content.replaceAll("](openapi.json)", "](../../backend/openapi.json)");
  }
  return content;
}

for (const source of documentationSources()) {
  const target = resolve(repositoryRoot, mirrorPath(source));
  mkdirSync(dirname(target), { recursive: true });
  const content = expectedMirror(source).replaceAll("\n", outputEol);
  writeFileSync(target, `${content}${outputEol}`, "utf8");
}
