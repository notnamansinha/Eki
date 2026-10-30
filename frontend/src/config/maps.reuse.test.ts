import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const VIS_GL = "@vis.gl/react-google-maps";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".tsx") && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

/** Local names for the vis.gl <Map> component: aliased named imports and `NS.Map`. */
function mapTagNames(file: ts.SourceFile) {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== VIS_GL) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) names.add(`${bindings.name.text}.Map`);
    else for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === "Map") names.add(element.name.text);
    }
  }
  return names;
}

function attribute(element: ts.JsxOpeningLikeElement, name: string) {
  return element.attributes.properties.find(
    (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

function expressionText(attr: ts.JsxAttribute | undefined) {
  const initializer = attr?.initializer;
  return initializer && ts.isJsxExpression(initializer) ? initializer.expression?.getText() : undefined;
}

describe("Google Maps reuse contract", () => {
  it("every Google map element reuses the cached instance with the shared map id and options", () => {
    let matched = 0;
    for (const path of sourceFiles(SRC)) {
      const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const tags = mapTagNames(file);
      if (tags.size === 0) continue;
      const visit = (node: ts.Node) => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && tags.has(node.tagName.getText())) {
          matched++;
          const where = `${path}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
          const reuse = attribute(node, "reuseMaps");
          expect(reuse, `${where} must set reuseMaps`).toBeDefined();
          expect(reuse?.initializer === undefined || expressionText(reuse) === "true", `${where} reuseMaps must be true`).toBe(true);
          expect(expressionText(attribute(node, "mapId")), `${where} must use mapId={MAPS_MAP_ID}`).toBe("MAPS_MAP_ID");
          expect(node.attributes.properties.some(property =>
            ts.isJsxSpreadAttribute(property) && property.expression.getText() === "MAP_OPTIONS"), `${where} must spread MAP_OPTIONS`).toBe(true);
          // These are part of vis.gl's cache key; any difference splits the cache.
          expect(attribute(node, "renderingType"), `${where} must not set renderingType`).toBeUndefined();
          expect(attribute(node, "colorScheme"), `${where} must not set colorScheme`).toBeUndefined();
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(matched).toBeGreaterThanOrEqual(3);
  });
});
