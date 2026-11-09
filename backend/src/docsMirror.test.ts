import { existsSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import {
  documentationSources,
  expectedMirror,
  mirrorContent,
  mirrorPath,
  normalizedFile,
} from "../../scripts/sync-documentation-mirrors.mjs";

const repositoryRoot = resolve(__dirname, "../..");
const sources: string[] = documentationSources();
const sourceSet = new Set(sources);

// Links are read with markdown-it, not with the sync script's own matcher, so a
// rewrite rule that is wrong in the script cannot also be wrong in this check.
const markdown = new MarkdownIt({ html: true });
type Token = ReturnType<MarkdownIt["parse"]>[number];

function linkTargets(content: string): string[] {
  return markdown.parse(content, {}).flatMap((token: Token) =>
    (token.children ?? []).flatMap((child: Token) => {
      if (child.type === "link_open") return [child.attrGet("href") ?? ""];
      if (child.type === "image") return [child.attrGet("src") ?? ""];
      return [];
    }),
  );
}

function filePart(target: string) {
  const path = target.split(/[?#]/, 1)[0];
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

const isRelative = (target: string) =>
  Boolean(filePart(target)) && !target.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(target);

const repositoryPath = (absolute: string) => relative(repositoryRoot, absolute).split(sep).join("/");

describe("repository documentation mirrors", () => {
  for (const source of sources) {
    const mirror = mirrorPath(source);
    it(`keeps ${mirror} synchronized with ${source}`, () => {
      expect(normalizedFile(mirror)).toBe(expectedMirror(source, sourceSet));
    });
  }

  it("resolves every relative link in a mirror to the file the source links to, or to its mirror", () => {
    const broken: string[] = [];
    for (const source of sources) {
      const mirror = mirrorPath(source);
      const sourceTargets = linkTargets(normalizedFile(source));
      const mirrorTargets = linkTargets(normalizedFile(mirror));
      expect(mirrorTargets, mirror).toHaveLength(sourceTargets.length);
      sourceTargets.forEach((target, index) => {
        if (!isRelative(target)) {
          if (mirrorTargets[index] !== target) broken.push(`${mirror}: ${mirrorTargets[index]} (source ${target})`);
          return;
        }
        const fromSource = resolve(repositoryRoot, dirname(source), filePart(target));
        // A link that is broken in the source is reported by documentation-quality.test.mjs.
        if (!existsSync(fromSource)) return;
        const fromMirror = resolve(repositoryRoot, dirname(mirror), filePart(mirrorTargets[index]));
        const linked = repositoryPath(fromSource);
        const allowed = [fromSource];
        if (sourceSet.has(linked)) allowed.push(resolve(repositoryRoot, mirrorPath(linked)));
        if (!allowed.includes(fromMirror)) broken.push(`${mirror}: ${mirrorTargets[index]} (source ${target})`);
      });
    }
    expect(broken).toEqual([]);
  });
});

describe("mirror link rewriting", () => {
  const known = new Set(["hardware/keys/README.md", "backend/README.md", "deploy/vps/README.md", "SECURITY.md"]);
  const mirrored = (source: string, content: string) => mirrorContent(source, content, known);

  it("gives every root document links into any folder", () => {
    expect(
      mirrored(
        "SECURITY.md",
        "[keys](hardware/keys/README.md) [server](backend/src/server.ts) [docs](docs/GLOSSARY.md#a) [licence](LICENSE)",
      ),
    ).toBe(
      "[keys](../hardware/keys/README.md) [server](../../backend/src/server.ts) [docs](../GLOSSARY.md#a) [licence](../../LICENSE)",
    );
  });

  it("points links to files that have no mirror back at the source folder", () => {
    expect(
      mirrored(
        "backend/README.md",
        "[a](openapi.json) [b](./openapi.json#/paths/~1api~1v2~1routes) [c](Dockerfile) [d](.env.example) [e](src/)",
      ),
    ).toBe(
      "[a](../../backend/openapi.json) [b](../../backend/openapi.json#/paths/~1api~1v2~1routes) " +
        "[c](../../backend/Dockerfile) [d](../../backend/.env.example) [e](../../backend/src/)",
    );
  });

  it("rewrites link destinations but never code", () => {
    const source = [
      "Read [the runbook](../../docs/operations/X.md#steps) and run `cp ../../docs/operations/x.md .`.",
      "",
      "```sh",
      "cp ../../docs/operations/x.md .",
      "cat [not](a/link.md)",
      "```",
      "",
      "    [indented](../../docs/code.md)",
      "",
      "[ref]: <../../docs/route guide.md>",
    ].join("\n");
    expect(mirrored("deploy/vps/README.md", source)).toBe(
      source
        .replace("](../../docs/operations/X.md#steps)", "](../../operations/X.md#steps)")
        .replace("[ref]: <../../docs/route guide.md>", "[ref]: <../../route guide.md>"),
    );
  });

  it("leaves external, absolute and same-page links alone", () => {
    const source = "[a](https://example.com/x.md) [b](#section) [c](/absolute) [d](mailto:a@b.c)";
    expect(mirrored("backend/README.md", source)).toBe(source);
  });
});
