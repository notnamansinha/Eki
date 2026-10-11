import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { attachMappings, buildCatalog, historicalLedger, parseRequirements, repositoryRoot,
  reportMarkdown, scanDocument, tableCells, validateCatalog, validateRequirementIds } from './qa/acceptance-catalog.mjs';
import { inspectSource } from './qa/source-census.mjs';
import { assertLoopbackUrl, safetyPreflight } from './qa/safety-preflight.mjs';
import { checkCoverageBudget, criticalSource } from './qa/coverage-budget.mjs';

const root = repositoryRoot;
const plan = readFileSync(resolve(root, 'docs/testing/WEBAPP_A_Z_AB_TESTING_PLAN.md'), 'utf8');
const ledger = readFileSync(resolve(root, 'docs/testing/WEBAPP_A_Z_AB_TESTING.md'), 'utf8');
const parsed = parseRequirements(plan.split(/\r?\n/));
const ts = createRequire(resolve(root, 'backend/package.json'))('typescript');

test('imports all exact feature and universal IDs and preserves full oracles', () => {
  validateRequirementIds(parsed.cases);
  assert.equal(parsed.cases.filter(item => item.kind === 'feature').length, 351);
  assert.equal(parsed.cases.filter(item => item.kind === 'matrix').length, 40);
  assert.equal(parsed.cases.filter(item => item.kind === 'experiment').length, 8);
  const geometry = parsed.cases.find(item => item.caseId === 'ROUTE24');
  assert.equal(geometry.oracle, 'Current context wins; repair not overwrite newer route; billable calls bounded');
  assert.ok(parsed.supplements.some(item => item.text.includes('cached and read-only')));
  assert.equal(parsed.simulations.length, 20);
  assert.ok(parsed.simulations.some(item => item.profile === 'outage120'));
});

test('intentional dropped, duplicated and unknown requirements fail the coverage contract', () => {
  assert.throws(() => validateRequirementIds(parsed.cases.filter(item => item.caseId !== 'AUTH01')), /Missing requirement AUTH01/);
  assert.throws(() => validateRequirementIds([...parsed.cases, parsed.cases[0]]), /Duplicate requirement C01/);
  assert.throws(() => validateRequirementIds([...parsed.cases, { caseId: 'GNSS99' }]), /Unknown requirements/);
});

test('malformed oracle columns fail rather than silently shortening a case', () => {
  assert.throws(() => parseRequirements(['## 5. Features', '| AUTH01 | action | oracle | extra |']), /malformed requirement/);
  assert.throws(() => parseRequirements(['## 5. Features', '| AUTH01 | action | |']), /malformed requirement/);
  assert.deepEqual(tableCells('| AUTH01 | `a|b` and escaped \\| | independent oracle |'),
    ['AUTH01', '`a|b` and escaped \\|', 'independent oracle']);
});

test('historical appendix rows cannot duplicate current acceptance definitions', () => {
  const source = ['## 5. Feature catalog', '| AUTH01 | action | oracle |', '## Appendix A. History',
    '## 5. Copied historical specification', '| AUTH01 | obsolete | obsolete |'];
  assert.equal(parseRequirements(source).cases.length, 1);
});

test('ledger is complete and history is explicitly separate from current evidence', () => {
  const history = historicalLedger(ledger.split(/\r?\n/));
  assert.equal(history.size, 351);
  assert.equal(history.get('AUTH01').currentEvidence, false);
  assert.throws(() => historicalLedger(ledger.split(/\r?\n/).filter(line => !line.startsWith('| AUTH01 |'))), /Missing requirement AUTH01/);
  assert.throws(() => historicalLedger([...ledger.split(/\r?\n/), '| AUTH01 | duplicate | PASS |']), /Duplicate ledger/);
});

test('stream scan consumes every byte including final non-newline UTF-8 content', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'eki-qa-scan-'));
  try {
    const bytes = Buffer.from('# First\r\nहिन्दी\r\n## Final'); const filename = resolve(dir, 'plan.md');
    writeFileSync(filename, bytes);
    const result = await scanDocument(filename);
    assert.equal(result.manifest.bytes, bytes.length);
    assert.equal(result.manifest.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(result.manifest.lineCount, 3);
    assert.equal(result.lines.at(-1), '## Final');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('complete repository census reports declarations without granting acceptance', async () => {
  const catalog = await buildCatalog();
  assert.equal(catalog.cases.length, 399);
  assert.equal(catalog.documents['docs/testing/WEBAPP_A_Z_AB_TESTING_PLAN.md'].bytes, Buffer.byteLength(plan));
  assert.deepEqual(catalog.inventory.pages.map(item => item.route).sort(), ['/', '/admin', '/feedback', '/passenger']);
  assert.ok(catalog.inventory.operations.length >= 71);
  assert.ok(catalog.inventory.controls.length > 100);
  assert.ok(catalog.inventory.firmwareModes.includes('esp32dev-secure'));
  assert.equal(catalog.documentedSimulations.length, 20);
  assert.equal(catalog.documentedSimulations.at(-1).caseId, 'SIM-20');
  assert.ok(catalog.supplementalTables.some(item => item.cells[0] === 'Fresh online device, no armed session'));
  assert.equal(catalog.cases.find(item => item.caseId === 'H17').latestExecutionStatus, 'NOT_RUN');
  assert.equal(catalog.cases.find(item => item.caseId === 'AUTH01').latestExecutionStatus, 'NOT_COVERED');
  assert.ok(catalog.cases.every(item => item.latestExecutionCommit === null));
  assert.match(reportMarkdown(catalog), /Current completed cases: 0/);
  assert.match(reportMarkdown(catalog), /NOT_RELEASE_READY/);
  const forged = structuredClone(catalog); forged.cases[0].latestExecutionStatus = 'PASS';
  assert.throws(() => validateCatalog(forged), /Unobserved execution claim/);
});

test('mappings reject invented tests, unknown cases and missing tested semantics', () => {
  const map = [{ caseId: 'AUTH01', scope: 'validation', tests: [{ path: 'missing.test.ts', name: 'not implemented', level: 'L1', semantics: 'denial' }] }];
  assert.throws(() => attachMappings(parsed.cases, map, { tests: [] }), /Missing or unjustified/);
  assert.throws(() => attachMappings(parsed.cases, [{ ...map[0], caseId: 'AUTH99' }], { tests: [] }), /Unknown mapped/);
  assert.throws(() => attachMappings(parsed.cases, [...map, ...map], { tests: [] }), /Duplicate test mapping/);
});

test('AST census scopes literal tests and detects event-bearing custom controls', () => {
  const text = `describe('identity', () => { it('keeps owner', () => {}); });
    test('root', () => {}); const ui = <CustomThing onClick={handle} aria-label="Open" />;`;
  const found = inspectSource('example.tsx', text, ts);
  assert.deepEqual(found.tests.map(item => item.name), ['identity > keeps owner', 'root']);
  assert.equal(found.controls[0].literalAccessibleName, 'Open');
  assert.equal(found.controls[0].coverageStatus, 'NOT_COVERED');
});

test('critical changes cannot pass solely because an unrelated existing test is present', () => {
  const path = 'backend/src/services/telemetryPayload.ts';
  const tests = [{ path: 'backend/src/services/telemetryPayload.test.ts' }];
  const mapping = [{ sourcePaths: [path], tests }];
  assert.equal(criticalSource(path), true);
  assert.equal(criticalSource(tests[0].path), false);
  assert.equal(criticalSource('firestore.rules'), true);
  assert.throws(() => checkCoverageBudget([path], mapping), /corresponding test change/);
  assert.throws(() => checkCoverageBudget([path, tests[0].path], []), /exact case\/test mapping/);
  assert.equal(checkCoverageBudget([path, tests[0].path], mapping).status, 'PASS');
  assert.equal(checkCoverageBudget(['qa/README.md'], []).status, 'PASS');
});

const emulator = { GCLOUD_PROJECT: 'demo-eki-qa', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085',
  FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9005', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9095',
  FIREBASE_DATABASE_URL: 'http://127.0.0.1:9005/', EKI_QA_BASE_URL: 'http://127.0.0.1:3001/',
  EKI_QA_EXTERNAL_PROVIDERS: 'mock', EKI_QA_CONFIRM_DISPOSABLE: '1' };

test('safe static mode performs configuration validation without pretending runtime isolation', () => {
  const proof = safetyPreflight({}); assert.equal(proof.configAccepted, true);
  assert.equal(proof.runtimeIsolationVerified, false);
  assert.equal(safetyPreflight(emulator, { mode: 'emulator' }).configuredProject, 'demo-eki-qa');
});

test('emulator mode requires all dependencies and explicit disposal/provider configuration', () => {
  for (const key of Object.keys(emulator)) {
    const candidate = { ...emulator }; delete candidate[key];
    assert.throws(() => safetyPreflight(candidate, { mode: 'emulator' }), undefined, key);
  }
});

test('cloud projects and external Firebase targets fail closed without echoing sensitive values', () => {
  for (const key of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID']) {
    assert.throws(() => safetyPreflight({ ...emulator, [key]: 'production-project' }), /approved demo project/);
  }
  const sensitive = 'https://credential:private@example.com/?token=private';
  assert.throws(() => safetyPreflight({ FIREBASE_DATABASE_URL: sensitive }), error => !error.message.includes('private') && /loopback/.test(error.message));
});

test('URL bypasses, DNS names, credentials and redirect parameters are rejected', () => {
  for (const value of ['https://127.0.0.1:9005', 'http://localhost:9005', 'http://127.0.0.1.evil.test:9005',
    'http://2130706433:9005', 'http://0x7f000001:9005', 'http://127.1:9005', 'http://127.0.0.2:9005',
    'http://[::ffff:127.0.0.1]:9005', 'http://user:secret@127.0.0.1:9005', 'http://127.0.0.1:9005/?redirect=cloud',
    'http://127.0.0.1:9005/#cloud', 'http://127.0.0.1', 'http://127.0.0.1:0', 'http://127.0.0.1:65536']) {
    assert.throws(() => assertLoopbackUrl(value), undefined, value);
  }
  assert.equal(assertLoopbackUrl('http://[::1]:9005/').hostname, '[::1]');
});

test('provider credentials and mismatched emulator hosts are forbidden', () => {
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_MAPS_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
    assert.throws(() => safetyPreflight({ [key]: 'sensitive-value' }), error => !error.message.includes('sensitive-value') && error.message.includes(key));
  }
  assert.throws(() => safetyPreflight({ ...emulator, FIRESTORE_EMULATOR_HOST: 'localhost:8085' }), /reserved loopback/);
  assert.throws(() => safetyPreflight({ ...emulator, FIREBASE_DATABASE_URL: 'http://127.0.0.1:9005/live' }), /emulator root/);
  assert.throws(() => safetyPreflight({ ...emulator, EKI_QA_BASE_URL: 'http://127.0.0.1:3001/api' }, { mode: 'emulator' }), /Backend root/);
  assert.throws(() => safetyPreflight({}, { mode: 'live' }), /Unknown safety mode/);
});
