import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8").replace(/\r\n/g, "\n");

/** Every variable the tracked backend template sets or shows commented out. */
function templateVariables(): string[] {
  return [...read("backend/.env.example").matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map(match => match[1]);
}

/** Backticked names in the "Backend variables" table of docs/CONFIGURATION.md. */
function documentedBackendVariables(): Set<string> {
  const doc = read("docs/CONFIGURATION.md");
  const start = doc.indexOf("## Backend variables");
  const end = doc.indexOf("\n## ", start + 1);
  const table = doc.slice(start, end).split("\n").filter(line => line.startsWith("| `"));
  return new Set(table.flatMap(line => [...line.split("|")[1].matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map(match => match[1])));
}

describe("backend environment documentation", () => {
  it("documents every backend/.env.example variable in the CONFIGURATION.md backend table", () => {
    const documented = documentedBackendVariables();
    const variables = templateVariables();
    expect(variables.length).toBeGreaterThan(20);
    expect(variables.filter(name => !documented.has(name))).toEqual([]);
  });
});
