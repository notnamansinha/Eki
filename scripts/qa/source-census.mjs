import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { registeredOperations } from '../verify-openapi.mjs';

export function inspectSource(filename, text, ts) {
  const ast = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const controls = []; const tests = []; const dependencies = []; const databaseSites = [];
  const location = node => ({ path: filename, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 });
  function walk(node, suites = []) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) dependencies.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node)) {
      const call = node.expression.getText(ast);
      const title = node.arguments[0];
      if (/^(describe|it|test)(\.|$)/.test(call) && title && ts.isStringLiteralLike(title)) {
        if (/^describe(\.|$)/.test(call)) suites = [...suites, title.text];
        else tests.push({ ...location(node), name: [...suites, title.text].join(' > '),
          declaration: call, executionStatus: 'NOT_RUN' });
      }
      if (/^(collection|collectionGroup|doc|ref|setDoc|updateDoc|deleteDoc|onSnapshot|onValue|runTransaction)$/.test(call) ||
        /\.(collection|doc|set|update|remove|transaction|on)$/.test(call)) {
        databaseSites.push({ ...location(node), call, classification: 'STATIC_CANDIDATE_REVIEW_REQUIRED' });
      }
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const open = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = open.tagName.getText(ast);
      const attrs = open.attributes.properties.filter(ts.isJsxAttribute);
      const events = attrs.map(attr => attr.name.getText(ast)).filter(name => /^on[A-Z]/.test(name));
      if (/^(button|input|textarea|select|a|summary|AdvancedMarker|CustomSelect|InAppSelect|ConfirmModal|AlertModal)$/.test(tag) || events.length) {
        const label = attrs.find(attr => attr.name.getText(ast) === 'aria-label');
        controls.push({ ...location(open), controlId: `${filename}:${location(open).line}:${tag}`, tag, events,
          literalAccessibleName: label?.initializer && ts.isStringLiteralLike(label.initializer) ? label.initializer.text : null,
          runtimeCensusStatus: 'NOT_RUN', matrix: 'C01-C22', coverageStatus: 'NOT_COVERED' });
      }
    }
    ts.forEachChild(node, child => walk(child, suites));
  }
  walk(ast); return { controls, tests, dependencies, databaseSites };
}

export function sourceCensus(root) {
  const require = createRequire(resolve(root, 'backend/package.json')); const ts = require('typescript');
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  const production = files.filter(file => /^(frontend\/src\/|backend\/src\/)/.test(file) && /\.tsx?$/.test(file) && !/\.(test|spec)\./.test(file));
  const testFiles = files.filter(file => /\.(test|spec)\.(mjs|[jt]sx?)$/.test(file));
  const scanned = [...new Set([...production, ...testFiles])].map(file => ({ path: file,
    ...inspectSource(file, readFileSync(resolve(root, file), 'utf8'), ts) }));
  const pageFiles = production.filter(file => /^frontend\/src\/app\/.*page\.tsx$/.test(file));
  const pages = pageFiles.map(file => ({ path: file, route: `/${file.replace(/^frontend\/src\/app\//, '').replace(/\/?page\.tsx$/, '').split('/').filter(part => part && !/^\(.*\)$/.test(part)).join('/')}` }));
  const firmwareText = readFileSync(resolve(root, 'hardware/platformio.ini'), 'utf8');
  return { mode: 'STATIC_ONLY', files: files.length, productionFiles: production,
    pages, operations: registeredOperations(root).map(item => ({ ...item, matrix: 'H01-H18', coverageStatus: 'NOT_COVERED' })),
    controls: scanned.filter(item => production.includes(item.path)).flatMap(item => item.controls),
    tests: scanned.flatMap(item => item.tests), testFiles,
    databaseSites: scanned.filter(item => production.includes(item.path)).flatMap(item => item.databaseSites),
    dependencies: scanned.filter(item => production.includes(item.path)).map(item => ({ path: item.path, imports: item.dependencies })),
    firmwareModes: [...firmwareText.matchAll(/^\[env:([^\]]+)\]/gm)].map(match => match[1]),
    firmwareTestFiles: files.filter(file => /^hardware\/test\/.*\.cpp$/.test(file)),
    limitations: ['Static JSX sites do not enumerate rendered states, loop records or non-JSX controls.',
      'Literal test declarations exclude computed titles and runtime parameter expansion; describe is not counted as a test.',
      'Database call sites are conservative candidates, not proven Firebase writes.',
      'Dependencies are import edges, not a complete runtime call graph.'] };
}
