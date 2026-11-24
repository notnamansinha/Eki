import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildCatalog, repositoryRoot } from './acceptance-catalog.mjs';
import { gnssTestMap } from '../../qa/gnss-test-map.mjs';
import { emulatorTestMap } from '../../qa/emulator-test-map.mjs';
import { browserTestMap } from '../../qa/browser-test-map.mjs';
import { apiTestMap } from '../../qa/api-test-map.mjs';
import { nativeTestMap } from '../../qa/native-test-map.mjs';
import { reviewedUnitTestMap } from '../../qa/reviewed-unit-test-map.mjs';
import { describeDirty } from './working-tree.mjs';

export const evidenceFamilies = [
  { name: 'gnss', level: 'L1', verdict: 'GREEN_FOR_UNIT_SCOPE', mappings: gnssTestMap },
  { name: 'emulator', level: 'L2', verdict: 'GREEN_FOR_EXECUTED_EMULATOR_SCOPE', mappings: emulatorTestMap },
  { name: 'browser', level: 'L3', verdict: 'GREEN_FOR_EXECUTED_BROWSER_SCOPE', mappings: browserTestMap },
  { name: 'api', level: 'L2', verdict: 'GREEN_FOR_EXECUTED_API_SCOPE', mappings: apiTestMap },
  { name: 'native', level: 'L1', verdict: 'GREEN_FOR_NATIVE_SCOPE', mappings: nativeTestMap },
  { name: 'reviewedUnit', level: 'L1', verdict: 'GREEN_FOR_REVIEWED_UNIT_SCOPE', mappings: reviewedUnitTestMap },
];

// Observed suite success never closes the full source oracle. Historical,
// changed-working-tree and invented identities cannot become current evidence.
export function combineExecutionEvidence(catalog, reports, families = evidenceFamilies) {
  const observed = new Map(catalog.cases.map(item => [item.caseId, []]));
  const suites = families.map(family => {
    const report = reports[family.name]; const reasons = [];
    if (!report) return { name: family.name, level: family.level, accepted: false, reasons: ['Missing execution report'] };
    if (report.sourceCommit !== catalog.sourceCommit || report.dirty !== false || catalog.dirty)
      reasons.push('Source SHA/clean-working-tree provenance mismatch');
    if (report.level !== family.level || report.physicalMotionExecuted !== false || report.realProvidersExecuted !== false)
      reasons.push('Invalid evidence level/provider/physical boundary');
    if (family.name === 'native' && (report.actualBoardExecuted !== false || report.nativeTarget !== 'native'))
      reasons.push('Native host evidence cannot claim an actual board target');
    const counts = report.counts;
    if (!counts || !Number.isSafeInteger(counts.discovered) || counts.discovered < 1
      || Object.values(counts).some(value => !Number.isSafeInteger(value) || value < 0)
      || counts.discovered !== counts.passed + counts.failed + (counts.blocked ?? counts.skipped ?? 0) + (counts.flaky ?? 0))
      reasons.push('Invalid or empty observed counts');
    const assertions = family.level === 'L3' ? report.tests : report.assertions;
    if (!Array.isArray(assertions) || assertions.length !== counts?.discovered) reasons.push('Missing observed assertion identities');
    else {
      const validIdentity = item => item && typeof item.path === 'string' && typeof item.name === 'string'
        && (family.level !== 'L3' || (typeof item.project === 'string' && Array.isArray(item.results)));
      const indexedObservations = family.name === 'reviewedUnit';
      if (indexedObservations && !assertions.every((item, index) => item?.observationIndex === index))
        reasons.push('Missing/duplicate/noncontiguous reviewed observation position');
      const identities = assertions.map(item => `${item?.path}|${item?.name}|${item?.project ?? ''}|${indexedObservations ? item?.observationIndex : ''}`);
      if (!assertions.every(validIdentity) || new Set(identities).size !== identities.length) reasons.push('Invalid/duplicate observed identity');
      const passed = assertions.filter(item => family.level === 'L3' ? item?.status === 'expected'
        && item.results?.length === 1 && item.results[0].status === 'passed' && item.results[0].retry === 0
        : ['PASS', 'passed'].includes(item?.status)).length;
      const failed = assertions.filter(item => ['FAIL', 'failed', 'unexpected'].includes(item?.status)).length;
      if (passed !== counts.passed || failed !== counts.failed) reasons.push('Counts disagree with individual observations');
    }
    if (!Array.isArray(report.cases) || report.cases.some(item => !item || typeof item.caseId !== 'string')
        || new Set(report.cases?.map(item => item?.caseId)).size !== report.cases?.length)
      reasons.push('Missing/duplicate case observations');
    const timestamp = Date.parse(report.startedAt), end = Date.parse(report.finishedAt);
    if (!Number.isFinite(timestamp) || !Number.isFinite(end) || end < timestamp) reasons.push('Invalid execution timestamps');
    if (reasons.length) return { name: family.name, level: family.level, accepted: false, reasons, counts };
    const permitted = family.mappings.filter(mapping => family.level !== 'L3' || !report.scope || report.scope === 'all'
      || mapping.tests.some(link => link.name.includes(report.scope === 'providers' ? 'provider quota' : 'admin live service controls')));
    if (family.level === 'L3' && !['all', 'providers', 'service'].includes(report.scope ?? 'all')) reasons.push('Unknown browser scope');
    const expected = new Map(permitted.map(item => [item.caseId, item]));
    if (report.cases.length !== expected.size) reasons.push('Mapped execution case census mismatch');
    const derived = [];
    for (const claim of report.cases) {
      const mapping = expected.get(claim.caseId);
      if (!mapping || !observed.has(claim.caseId) || claim.level !== family.level || claim.scope !== mapping.scope) {
        reasons.push('Unknown/mismatched claimed case scope'); continue;
      }
      const links = mapping.tests.filter(link => link.level === family.level);
      const matched = links.map(link => assertions.filter(item => item.name === link.name &&
        (family.level === 'L3' ? `e2e/${item.path.replaceAll('\\', '/')}` : item.path) === link.path));
      const passing = links.length > 0 && (family.level === 'L3' ? matched.every(items => items.length === 2
        && items.map(item => item.project).sort().join(',') === 'desktop,mobile'
        && items.every(item => item.status === 'expected' && item.results.length === 1 && item.results[0].status === 'passed' && item.results[0].retry === 0))
        : matched.every(items => items.length === 1 && ['PASS', 'passed'].includes(items[0].status)));
      const failed = matched.some(items => items.some(item => ['FAIL', 'failed', 'unexpected'].includes(item.status)));
      const status = passing ? 'PARTIAL' : failed ? 'FAIL' : 'BLOCKED';
      if (claim.status !== status) reasons.push('Claim disagrees with observed assertions');
      derived.push({ caseId: claim.caseId, level: family.level, status, scope: claim.scope });
    }
    if (!reasons.length) for (const item of derived) observed.get(item.caseId).push(item);
    const fullScope = family.level !== 'L3' || (report.scope ?? 'all') === 'all';
    if (!fullScope) reasons.push('Only a targeted browser subset was executed');
    const green = report.verdict === family.verdict && counts.passed === counts.discovered
      && (report.runnerExitCode ?? report.exitCode) === 0;
    if (!green) reasons.push('Execution runner is not green for its declared scope');
    return { name: family.name, level: family.level, accepted: reasons.length === 0, reasons, counts,
      startedAt: report.startedAt, finishedAt: report.finishedAt, workflowRunId: report.workflowRunId ?? null };
  });
  const cases = catalog.cases.map(item => {
    const evidence = observed.get(item.caseId);
    const status = evidence.some(value => value.status === 'FAIL') ? 'FAIL' : evidence.some(value => value.status === 'PARTIAL') ? 'PARTIAL'
      : evidence.length ? 'BLOCKED' : item.tests.length ? 'NOT_RUN' : 'NOT_COVERED';
    return { ...item, latestExecutionStatus: status, latestExecutionCommit: evidence.length ? catalog.sourceCommit : null,
      executionEvidence: evidence, remainingGate: item.remainingGate };
  });
  return { schemaVersion: 1, sourceCommit: catalog.sourceCommit, dirty: catalog.dirty, ignoredChanges: catalog.ignoredChanges ?? [],
    generatedAt: new Date().toISOString(), timezone: 'Asia/Calcutta',
    requiredHarnessExecution: suites.every(item => item.accepted) ? 'PASS' : 'BLOCKED',
    softwareRelease: 'NOT_RELEASE_READY', vehicleFieldDeployment: 'NOT_VERIFIED', completeFeatureCases: 0,
    counts: Object.fromEntries(['PARTIAL', 'FAIL', 'BLOCKED', 'NOT_RUN', 'NOT_COVERED'].map(status => [status, cases.filter(item => item.latestExecutionStatus === status).length])),
    suites, cases, inventory: catalog.inventory, documents: catalog.documents };
}

async function main() {
  if (process.argv.length > 2) throw new Error('Execution report takes no CLI arguments');
  const catalog = await buildCatalog(); const reports = {};
  for (const family of evidenceFamilies) {
    try { reports[family.name] = JSON.parse(readFileSync(resolve(repositoryRoot, `artifacts/qa/${family.name}-report.json`), 'utf8')); }
    catch { /* Missing/unreadable evidence remains explicitly blocked. */ }
  }
  const report = combineExecutionEvidence(catalog, reports); const directory = resolve(repositoryRoot, 'artifacts/qa'); mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'execution-report.json'), JSON.stringify(report, null, 2) + '\n');
  const markdown = ['# Current-source execution evidence', '', `Commit: ${report.sourceCommit}; dirty: ${describeDirty(report)}.`,
    `Required harness scopes: ${report.requiredHarnessExecution}; Eki software: ${report.softwareRelease}; vehicle field deployment: ${report.vehicleFieldDeployment}.`,
    `Case counts: ${JSON.stringify(report.counts)}; complete feature cases: 0.`, '',
    '| Suite | Level | Accepted current scope | Blockers |', '| --- | --- | --- |',
    ...report.suites.map(item => `| ${item.name} | ${item.level} | ${item.accepted} | ${item.reasons.join('; ')} |`), '',
    '| Case | Status | Observed levels | Remaining gate |', '| --- | --- | --- | --- |',
    ...report.cases.map(item => `| ${item.caseId} | ${item.latestExecutionStatus} | ${item.executionEvidence.map(value => value.level).join(', ')} | ${item.remainingGate} |`), '',
    'Static declarations and historical ledger notes are not executed evidence. Full oracle, physical/provider and owner approval gates remain separate.', ''].join('\n');
  writeFileSync(resolve(directory, 'execution-report.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
  console.log(JSON.stringify({ sourceCommit: report.sourceCommit, requiredHarnessExecution: report.requiredHarnessExecution, counts: report.counts, softwareRelease: report.softwareRelease }));
  if (report.requiredHarnessExecution !== 'PASS') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
