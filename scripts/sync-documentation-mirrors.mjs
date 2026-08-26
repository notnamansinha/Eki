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
      .replaceAll("](hardware/", "](../hardware/");
  } else if (!source.includes("/")) {
    content = content.replaceAll("](docs/", "](../");
  } else if (source === "hardware/README.md") {
    content = content
      .replaceAll("](../docs/hardware/", "](")
      .replaceAll("](../docs/operations/", "](../operations/")
      .replaceAll("](../docs/", "](../")
      .replaceAll("](../backend/", "](../../backend/")
      .replaceAll("](../frontend/", "](../../frontend/");
  } else if (/^(backend|frontend|hardware)\//.test(source)) {
    content = content.replaceAll("../docs/", "../");
  }
  return content;
}

for (const source of documentationSources()) {
  const target = resolve(repositoryRoot, mirrorPath(source));
  mkdirSync(dirname(target), { recursive: true });
  const content = expectedMirror(source).replaceAll("\n", outputEol);
  writeFileSync(target, `${content}${outputEol}`, "utf8");
}
