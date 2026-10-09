// Static source census only: this never imports application modules or runs tests.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';

const dir = process.env.EKI_QA_RESEARCH_DIR || path.join(os.tmpdir(), 'eki-az-qa-2026-10-03');
const ledger = JSON.parse(fs.readFileSync(path.join(dir, 'files.json'), 'utf8'));
for (const file of ledger) {
  if (file.binary) continue;
  const text = fs.readFileSync(path.join(dir, 'files', file.path), 'utf8').replace(/\r\r\n/g, '\n').replace(/\r\n/g, '\n');
  file.headings = [...text.matchAll(/^#{1,4}\s+(.+)$/gm)].map(m => m[1]);
  if (!/\.(tsx?|mjs|cjs|js)$/.test(file.path)) continue;
  const ast = ts.createSourceFile(file.path, text, ts.ScriptTarget.Latest, true);
  file.imports = [];
  file.functions = [];
  file.constants = [];
  file.controls = [];
  file.testNames = [];
  const line = node => ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
  function walk(node) {
    if (ts.isImportDeclaration(node)) file.imports.push(node.moduleSpecifier.text);
    if (ts.isFunctionDeclaration(node) && node.name) file.functions.push({name: node.name.text, line: line(node)});
    if (ts.isVariableDeclaration(node) && node.initializer && /^[A-Z][A-Z_0-9]+$/.test(node.name.getText(ast))) file.constants.push({name: node.name.getText(ast), value: node.initializer.getText(ast).slice(0, 350), line: line(node)});
    if (ts.isCallExpression(node) && /^(test|it|describe)(\.|$)/.test(node.expression.getText(ast)) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) file.testNames.push({name: node.arguments[0].text, line: line(node)});
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const open = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = open.tagName.getText(ast);
      const knownControl = /^(button|input|textarea|select|option|a|summary|AdvancedMarker|CustomSelect|InAppSelect|ConfirmModal|AlertModal)$/.test(tag);
      const eventBearing = open.attributes.properties.some(attr =>
        ts.isJsxAttribute(attr) && /^on[A-Z]/.test(attr.name.getText(ast)));
      if (knownControl || eventBearing) {
        const attrs = {};
        for (const attr of open.attributes.properties) if (ts.isJsxAttribute(attr)) attrs[attr.name.getText(ast)] = attr.initializer?.getText(ast).slice(0, 500) || 'true';
        const children = ts.isJsxElement(node) ? node.children.map(c => c.getText(ast)).join(' ').replace(/\s+/g, ' ').trim().slice(0, 300) : '';
        file.controls.push({tag, line: line(node), attrs, text: children, kind: knownControl ? 'control' : 'event/state boundary'});
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
}
fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(ledger, null, 2));
console.log(JSON.stringify({files: ledger.length, lines: ledger.reduce((n, f) => n + f.lines, 0), controls: ledger.reduce((n, f) => n + (f.controls?.length || 0), 0), declaredTests: ledger.reduce((n, f) => n + (f.testNames?.length || 0), 0)}));
