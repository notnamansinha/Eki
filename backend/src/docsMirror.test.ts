import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(__dirname, "../..");

function normalizedFile(path: string) {
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

function mirrorPath(source: string) {
  if (source.startsWith(".github/")) {
    return `docs/github/${source.slice(".github/".length)}`;
  }
  if (!source.includes("/")) return `docs/repository/${source}`;
  return `docs/${source}`;
}

function expectedMirror(source: string) {
  let content = normalizedFile(source);
  if (source === "README.md") {
    content = content
      .replaceAll("](docs/", "](../")
      .replaceAll("](backend/", "](../backend/");
  } else if (source === "hardware/README.md") {
    content = content.replaceAll("](../docs/hardware/", "](");
  } else if (/^(backend|frontend|hardware)\//.test(source)) {
    content = content.replaceAll("../docs/", "../");
  }
  return content;
}

describe("repository documentation mirrors", () => {
  for (const source of documentationSources()) {
    const mirror = mirrorPath(source);
    it(`keeps ${mirror} synchronized with ${source}`, () => {
      expect(normalizedFile(mirror)).toBe(expectedMirror(source));
    });
  }
});
