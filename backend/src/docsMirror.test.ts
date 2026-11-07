import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
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
      .replaceAll("](backend/", "](../backend/")
      .replaceAll("](frontend/", "](../frontend/")
      .replaceAll("](LICENSE)", "](../../LICENSE)")
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
  } else if (/^(backend|deploy|e2e|frontend|hardware|qa)\//.test(source)) {
    // The mirror sits one folder deeper, under docs/, so a link written as
    // "../" repeated once per source folder level, then "docs/<path>", needs
    // the same "../" run followed by "<path>". Dropping "docs/" from the
    // "../docs/" suffix does that at any depth: "../../docs/x" becomes "../../x".
    content = content.replaceAll("../docs/", "../");
  }
  return content;
}

const linkTargets = (content: string) =>
  [...content.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1].split("#")[0]);

describe("repository documentation mirrors", () => {
  for (const source of documentationSources()) {
    const mirror = mirrorPath(source);
    it(`keeps ${mirror} synchronized with ${source}`, () => {
      expect(normalizedFile(mirror)).toBe(expectedMirror(source));
    });
  }

  it("resolves every link into docs/ to the same file from the mirror", () => {
    const broken: string[] = [];
    for (const source of documentationSources()) {
      const mirror = mirrorPath(source);
      const sourceTargets = linkTargets(normalizedFile(source));
      const mirrorTargets = linkTargets(normalizedFile(mirror));
      expect(mirrorTargets).toHaveLength(sourceTargets.length);
      sourceTargets.forEach((target, index) => {
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return;
        const fromSource = resolve(repositoryRoot, dirname(source), target);
        if (!relative(resolve(repositoryRoot, "docs"), fromSource).match(/^[^.]/)) return;
        if (!existsSync(fromSource)) return;
        const fromMirror = resolve(repositoryRoot, dirname(mirror), mirrorTargets[index]);
        if (fromMirror !== fromSource) broken.push(`${mirror}: ${mirrorTargets[index]} (source ${target})`);
      });
    }
    expect(broken).toEqual([]);
  });
});
