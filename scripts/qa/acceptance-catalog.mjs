import { createReadStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sourceCensus } from './source-census.mjs';
import { testMap } from '../../qa/test-map.mjs';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const categoryCounts = Object.freeze({ AUTH: 18, PAX: 26, BOARD: 22, MAP: 30,
  GNSS: 36, TRIP: 28, OPS: 18, ROUTE: 26, FLEET: 15, CHAT: 14, FEED: 15,
  SET: 8, HIST: 7, DATA: 14, SEC: 13, API: 11, OBS: 8, FW: 22, WEB: 12, REL: 8 });
export const statuses = ['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'NOT_AUTOMATED',
  'PARTIAL', 'NOT_COVERED', 'NOT_APPLICABLE', 'FLAKY'];
const planPath = 'docs/testing/WEBAPP_A_Z_AB_TESTING_PLAN.md';
const ledgerPath = 'docs/testing/WEBAPP_A_Z_AB_TESTING.md';
const featurePattern = new RegExp(`^(${Object.keys(categoryCounts).join('|')})\\d{2}$`);

// Escaped pipes and code-span pipes belong to a cell, not a new column.
export function tableCells(line) {
  if (!line.startsWith('|') || !line.trimEnd().endsWith('|')) return null;
  const cells = []; let cell = ''; let code = false; let escaped = false;
  for (const ch of line.slice(1, line.lastIndexOf('|'))) {
    if (escaped) { cell += `\\${ch}`; escaped = false; }
    else if (ch === '\\') escaped = true;
    else if (ch === '`') { code = !code; cell += ch; }
    else if (ch === '|' && !code) { cells.push(cell.trim()); cell = ''; }
    else cell += ch;
  }
  if (escaped) cell += '\\';
  cells.push(cell.trim()); return cells;
}

export function parseRequirements(lines, source = planPath) {
  const cases = []; const simulations = []; const supplements = []; const supplementalTables = [];
  let section = ''; let zone = ''; let simulationTable = false; let appendix = false;
  for (const [index, line] of lines.entries()) {
    if (/^#{1,3} /.test(line)) {
      section = line; simulationTable = false;
      if (/^## Appendix /.test(line)) appendix = true;
      if (/^## 4\./.test(line)) zone = 'matrix';
      else if (/^## 5\./.test(line)) zone = 'feature';
      else if (/^## 6\./.test(line)) zone = 'simulation';
      else if (/^## 11\./.test(line)) zone = 'experiment';
      else if (/^## /.test(line)) zone = '';
    }
    // Historical PR/comment headings can resemble sections 4/5. Never import
    // them back into the active specification after the appendix boundary.
    if (appendix) continue;
    if (/^\| Profile \|/.test(line) && zone === 'simulation') simulationTable = true;
    const cells = tableCells(line);
    if (cells) {
      const [id, action, oracle, guardrails] = cells;
      const kind = zone === 'feature' && featurePattern.test(id) ? 'feature'
        : zone === 'matrix' && /^(C|H)\d{2}$/.test(id) ? 'matrix'
        : zone === 'experiment' && /^AB\d{2}$/.test(id) ? 'experiment' : null;
      if (kind) {
        if (cells.length !== (kind === 'experiment' ? 4 : 3) || !action || !oracle) {
          throw new Error(`${source}:${index + 1}: malformed requirement ${id}`);
        }
        cases.push({ caseId: id, kind, title: action, oracle, ...(guardrails ? { guardrails } : {}),
          source, sourceLine: index + 1, sourceSection: section });
      } else if (simulationTable && !['Profile', '---'].includes(id) && !/^[- ]+$/.test(id)) {
        if (cells.length !== 3) throw new Error(`${source}:${index + 1}: malformed simulation`);
        simulations.push({ profile: id.replace(/outage\s+(\d+)/, 'outage$1'), action,
          oracle, source, sourceLine: index + 1 });
      } else if (!appendix) {
        supplementalTables.push({ source, sourceLine: index + 1, sourceSection: section, cells });
      }
    }
    // Preserve prose boundaries/overrides in addition to abbreviated table rows.
    if (!appendix && line.trim() && !cells) supplements.push({ line: index + 1, text: line });
  }
  return { cases, simulations, supplements, supplementalTables };
}

export function validateRequirementIds(cases) {
  const ids = new Set();
  for (const item of cases) {
    if (ids.has(item.caseId)) throw new Error(`Duplicate requirement ${item.caseId}`);
    ids.add(item.caseId);
  }
  for (const [prefix, count] of Object.entries({ ...categoryCounts, C: 22, H: 18, AB: 8 })) {
    for (let n = 1; n <= count; n++) {
      const id = `${prefix}${String(n).padStart(2, '0')}`;
      if (!ids.delete(id)) throw new Error(`Missing requirement ${id}`);
    }
  }
  if (ids.size) throw new Error(`Unknown requirements: ${[...ids].join(', ')}`);
}

export function historicalLedger(lines) {
  const result = new Map();
  for (const [index, line] of lines.entries()) {
    const cells = tableCells(line);
    if (!cells || !featurePattern.test(cells[0])) continue;
    if (result.has(cells[0])) throw new Error(`Duplicate ledger requirement ${cells[0]}`);
    if (cells.length !== 3 || !/^(NOT_RUN|PARTIAL|PASS|FAIL|BLOCKED)\b/.test(cells[2])) {
      throw new Error(`Invalid historical ledger row ${cells[0]}`);
    }
    result.set(cells[0], { status: cells[2].split(/\s/)[0], note: cells[2], source: ledgerPath,
      sourceLine: index + 1, currentEvidence: false });
  }
  validateRequirementIds([...result.keys()].map(caseId => ({ caseId })).concat(
    [...Array.from({ length: 22 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 18 }, (_, i) => `H${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 8 }, (_, i) => `AB${String(i + 1).padStart(2, '0')}`)]
      .map(caseId => ({ caseId }))));
  return result;
}

export async function scanDocument(filename) {
  const bytes = createReadStream(filename); const hash = createHash('sha256'); let size = 0;
  bytes.on('data', chunk => { hash.update(chunk); size += chunk.length; });
  const lines = []; const headings = [];
  for await (const line of createInterface({ input: bytes, crlfDelay: Infinity })) {
    lines.push(line);
    if (/^#{1,4} /.test(line)) headings.push({ line: lines.length, text: line });
  }
  return { lines, manifest: { bytes: size, sha256: hash.digest('hex'),
    lineCount: lines.length, fullyScanned: true, headings } };
}

export function attachMappings(requirements, mappings, inventory) {
  const byId = new Map(mappings.map(mapping => [mapping.caseId, mapping]));
  if (byId.size !== mappings.length) throw new Error('Duplicate test mapping');
  const knownIds = new Set(requirements.map(item => item.caseId));
  for (const mapping of mappings) {
    if (!knownIds.has(mapping.caseId)) throw new Error(`Unknown mapped case ${mapping.caseId}`);
    if (!mapping.scope || !Array.isArray(mapping.tests) || !mapping.tests.length) throw new Error('Mapping needs scope and tests');
    for (const link of mapping.tests) {
      if (!['L0', 'L1', 'L2', 'L3', 'L4', 'L5'].includes(link.level) || !link.semantics ||
        !inventory.tests.some(test => test.path === link.path && test.name === link.name)) {
        throw new Error(`Missing or unjustified mapped test for ${mapping.caseId}`);
      }
    }
  }
  return requirements.map(item => {
    const mapping = byId.get(item.caseId);
    return { ...item, requirementType: item.kind, priority: ['AUTH', 'BOARD', 'GNSS', 'TRIP', 'DATA', 'SEC'].includes(
      item.caseId.replace(/\d+$/, '')) ? 'P0' : 'P1', priorityBasis: 'Conservative catalog triage; refine per oracle during review',
    evidenceRequired: item.kind === 'feature' ? ['L1', 'L2', 'L3'] : item.kind === 'matrix' ? ['L0', 'L1', 'L2', 'L3'] : ['L4'],
    evidenceRequirementStatus: 'PROPOSED_REVIEW_REQUIRED', tests: mapping?.tests ?? [],
    mappingScope: mapping?.scope ?? null, latestExecutionStatus: mapping ? 'NOT_RUN' : 'NOT_COVERED',
    latestExecutionCommit: null, remainingGate: 'Full current-source oracle mapping and execution; provider/physical requirements require separate observed evidence' };
  });
}

export function validateCatalog(catalog) {
  if (catalog.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(catalog.sourceCommit) ||
      typeof catalog.dirty !== 'boolean' || !Array.isArray(catalog.cases)) throw new Error('Invalid catalog schema');
  validateRequirementIds(catalog.cases);
  for (const item of catalog.cases) {
    if (!item.title || !item.oracle || !item.source || !Number.isInteger(item.sourceLine) || item.sourceLine < 1 ||
      !['feature', 'matrix', 'experiment'].includes(item.kind) || !['P0', 'P1', 'P2'].includes(item.priority) ||
      !Array.isArray(item.tests) || !Array.isArray(item.evidenceRequired) || !item.evidenceRequired.length ||
      !statuses.includes(item.latestExecutionStatus) || !item.remainingGate) throw new Error(`Invalid case schema ${item.caseId}`);
    // This builder imports definitions only. No execution statuses may be synthesized here.
    if (item.latestExecutionCommit !== null || item.latestExecutionStatus !== (item.tests.length ? 'NOT_RUN' : 'NOT_COVERED')) {
      throw new Error(`Unobserved execution claim for ${item.caseId}`);
    }
  }
  return catalog;
}

export async function buildCatalog(root = repositoryRoot, mappings = testMap) {
  const plan = await scanDocument(resolve(root, planPath));
  const ledger = await scanDocument(resolve(root, ledgerPath));
  const strategyPath = 'docs/testing/TEST_STRATEGY.md';
  const strategy = await scanDocument(resolve(root, strategyPath));
  const requirements = parseRequirements(plan.lines); validateRequirementIds(requirements.cases);
  const history = historicalLedger(ledger.lines); const inventory = sourceCensus(root);
  const generator = readFileSync(resolve(root, 'docs/testing/simulations/generate-gnss.mjs'), 'utf8');
  const profileDefinition = /const profiles = new Set\(\[([\s\S]*?)\]\)/.exec(generator);
  if (!profileDefinition) throw new Error('Generator profile declaration needs explicit inventory support');
  const profiles = [...profileDefinition[1].matchAll(/'([a-z][a-z0-9-]*)'/g)].map(match => match[1]);
  if (requirements.simulations.length !== profiles.length ||
      new Set(requirements.simulations.map(item => item.profile)).size !== profiles.length ||
      profiles.some(profile => !requirements.simulations.some(item => item.profile === profile))) {
    throw new Error('Generator profiles and plan simulations differ');
  }
  for (const item of requirements.simulations) if (!profiles.includes(item.profile)) throw new Error(`Unknown generator profile ${item.profile}`);
  const cases = attachMappings(requirements.cases, mappings, inventory).map(item => ({ ...item,
    historical: history.get(item.caseId) ?? null }));
  const documentedSimulations = strategy.lines.flatMap((line, index) => {
    const cells = tableCells(line);
    if (!cells || !/^SIM-\d{2}$/.test(cells[0])) return [];
    if (cells.length !== 3 || !cells[1] || !cells[2]) throw new Error('Malformed documented simulation');
    return [{ caseId: cells[0], action: cells[1], oracle: cells[2], source: strategyPath,
      sourceLine: index + 1, tests: [], latestExecutionStatus: 'NOT_COVERED' }];
  });
  const simulationIds = new Set(documentedSimulations.map(item => item.caseId));
  if (simulationIds.size !== 20 || documentedSimulations.length !== 20 ||
    Array.from({ length: 20 }, (_, i) => `SIM-${String(i + 1).padStart(2, '0')}`).some(id => !simulationIds.has(id))) {
    throw new Error('Documented SIM-01 through SIM-20 changed; review the inventory contract');
  }
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  return validateCatalog({ schemaVersion: 1, generatedAt: new Date().toISOString(), timezone: 'Asia/Calcutta',
    environment: { platform: process.platform, architecture: process.arch, node: process.version,
      workflowRunId: process.env.GITHUB_RUN_ID ?? null, applicationTestsExecuted: false },
    sourceCommit: git(['rev-parse', 'HEAD']),
    dirty: Boolean(git(['status', '--porcelain', '--untracked-files=all'])),
    documents: { [planPath]: plan.manifest, [ledgerPath]: ledger.manifest, [strategyPath]: strategy.manifest },
    cases, simulations: requirements.simulations, documentedSimulations,
    supplements: requirements.supplements, supplementalTables: requirements.supplementalTables, inventory });
}

export function reportMarkdown(catalog) {
  const lines = ['# Eki acceptance coverage (static definitions)', '', `Source commit: ${catalog.sourceCommit}`,
    `Working tree dirty: ${catalog.dirty}. No application acceptance execution imported.`, '',
    'Verdict: **NOT_RELEASE_READY**. Static census is L0; declarations and historical records are not current passes.', '',
    '| Category | Defined | Mapped, not run | Unmapped | Historical partial |', '| --- | ---: | ---: | ---: | ---: |'];
  for (const prefix of [...Object.keys(categoryCounts), 'C', 'H', 'AB']) {
    const rows = catalog.cases.filter(item => item.caseId.replace(/\d+$/, '') === prefix);
    const mapped = rows.filter(item => item.tests.length).length;
    lines.push(`| ${prefix} | ${rows.length} | ${mapped} | ${rows.length - mapped} | ${rows.filter(item => item.historical?.status === 'PARTIAL').length} |`);
  }
  lines.push('', `Feature denominator: 351; universal matrices: 40; experiment protocols: 8; total definitions: ${catalog.cases.length}.`,
    `Current completed cases: 0. Declared named tests: ${catalog.inventory.tests.length} (not executed counts).`,
    `Current routes: ${catalog.inventory.pages.length}; HTTP operations: ${catalog.inventory.operations.length}; static control sites: ${catalog.inventory.controls.length}.`,
    `Additional documented simulations: ${catalog.documentedSimulations.length} (SIM-01 through SIM-20), all NOT_COVERED. GNSS generator profiles: ${catalog.simulations.length}.`,
    '', '## Remaining gates', '', 'Rendered control census, reviewed source-to-oracle mappings, emulator-backed execution,',
    'passenger/admin complete browser flows, controlled OAuth/Maps/cloud checks, physical GNSS/RF/power/thermal/OTA acceptance.',
    '', 'All proposed priorities and evidence requirements need case-specific review. No denominator is silently excluded.', '');
  return lines.join('\n');
}

async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Only --check is supported');
  const catalog = await buildCatalog();
  if (!process.argv.includes('--check')) {
    const output = resolve(repositoryRoot, 'artifacts/qa'); mkdirSync(output, { recursive: true });
    writeFileSync(resolve(output, 'qa-report.json'), `${JSON.stringify(catalog, null, 2)}\n`);
    const markdown = reportMarkdown(catalog); writeFileSync(resolve(output, 'qa-report.md'), markdown);
    if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
  }
  console.log(JSON.stringify({ sourceCommit: catalog.sourceCommit, dirty: catalog.dirty,
    featureCases: 351, matrixCases: 40, experimentProtocols: 8, simulations: catalog.simulations.length,
    planBytes: catalog.documents[planPath].bytes, planFullyScanned: true,
    operations: catalog.inventory.operations.length, controls: catalog.inventory.controls.length,
    declaredTests: catalog.inventory.tests.length, verdict: 'NOT_RELEASE_READY' }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
