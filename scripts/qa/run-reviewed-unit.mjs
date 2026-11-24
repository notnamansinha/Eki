import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from './acceptance-catalog.mjs';
import { safetyPreflight } from './safety-preflight.mjs';
import { summarizeVitest } from './run-gnss.mjs';
import { reviewedUnitFiles, reviewedUnitTestMap } from '../../qa/reviewed-unit-test-map.mjs';
import { describeDirty, workingTreeState } from './working-tree.mjs';

if (process.argv.length > 2) throw Error('Reviewed unit evidence uses fixed source-attributed files');
safetyPreflight(process.env);
const directory = resolve(repositoryRoot, 'artifacts/qa'); mkdirSync(directory, { recursive: true });
const report = { schemaVersion: 1, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(),
  ...workingTreeState(repositoryRoot),
  startedAt: new Date().toISOString(), workflowRunId: process.env.GITHUB_RUN_ID ?? null, level: 'L1',
  verdict: 'BLOCKED', realProvidersExecuted: false, physicalMotionExecuted: false, node: process.version,
  scope: 'Reviewed backend/frontend pure, mocked, loopback Express and React/jsdom files only. Route HTTP responses use real handlers; SDK/datastores/GPS and component HTTP/selected children are mocked. Real SDK authentication, persistence and complete browser acceptance remain separate.' };
const executions = [];
for (const workspace of ['backend', 'frontend']) {
  const require = createRequire(resolve(repositoryRoot, workspace, 'package.json'));
  const jsonPath = resolve(directory, `reviewedUnit-${workspace}-vitest.json`);
  const junitPath = resolve(directory, `reviewedUnit-${workspace}-junit.xml`);
  rmSync(jsonPath, { force: true }); rmSync(junitPath, { force: true });
  const cli = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  const result = spawnSync(process.execPath, [cli, 'run', ...reviewedUnitFiles[workspace], '--maxWorkers=1', '--no-file-parallelism',
    '--reporter=default', '--reporter=json', '--reporter=junit', `--outputFile.json=${jsonPath}`, `--outputFile.junit=${junitPath}`],
  { cwd: resolve(repositoryRoot, workspace), encoding: 'utf8', timeout: 120_000, maxBuffer: 6 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(resolve(repositoryRoot, 'scripts/qa/network-guard.mjs')).href}` } });
  writeFileSync(resolve(directory, `reviewedUnit-${workspace}-run.log`), (result.stdout ?? '') + (result.stderr ?? ''));
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  let observation = null, evidenceError = null;
  try {
    observation = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const files = observation.testResults.map(item => relative(resolve(repositoryRoot, workspace), item.name).replaceAll('\\', '/')).sort();
    if (JSON.stringify(files) !== JSON.stringify([...reviewedUnitFiles[workspace]].sort())) throw Error('Reviewed file census mismatch');
  } catch (error) { evidenceError = error.message; }
  executions.push({ workspace, files: reviewedUnitFiles[workspace], exitCode: result.status, error: result.error?.code ?? null,
    vitest: require('vitest/package.json').version, observation, evidenceError });
}
report.executions = executions.map(({ observation, ...item }) => item);
try {
  if (executions.some(item => !item.observation || item.evidenceError)) throw Error('Missing or mismatched reviewed workspace observations');
  const combined = { testResults: executions.flatMap(item => item.observation.testResults),
    numTotalTests: executions.reduce((sum, item) => sum + item.observation.numTotalTests, 0),
    numPassedTests: executions.reduce((sum, item) => sum + item.observation.numPassedTests, 0),
    numFailedTests: executions.reduce((sum, item) => sum + item.observation.numFailedTests, 0) };
  Object.assign(report, summarizeVitest(combined, repositoryRoot, reviewedUnitTestMap));
  // Vitest may retain a literal %p template for every parameter row. Preserve
  // each observed row by position; this is not an inferred parameter identity.
  report.assertions = report.assertions.map((item, observationIndex) => ({ ...item, observationIndex }));
  report.runnerExitCode = executions.every(item => item.exitCode === 0) ? 0 : 1;
  report.verdict = report.runnerExitCode === 0 && report.counts.passed === report.counts.discovered
    && report.cases.every(item => item.status === 'PARTIAL') ? 'GREEN_FOR_REVIEWED_UNIT_SCOPE' : report.counts.failed ? 'RED' : 'BLOCKED';
} catch (error) { report.evidenceError = error.message; }
report.finishedAt = new Date().toISOString();
writeFileSync(resolve(directory, 'reviewedUnit-report.json'), JSON.stringify(report, null, 2) + '\n');
const markdown = `# Reviewed unit execution observations\n\nSource: ${report.sourceCommit}; dirty: ${describeDirty(report)}; level L1; verdict: ${report.verdict}.\n\n`
  + `Assertions: ${JSON.stringify(report.counts ?? {})}; reviewed workspace files: ${executions.reduce((sum, item) => sum + item.files.length, 0)}.\n\n`
  + `${report.scope}\n${report.evidenceError ?? ''}\n`;
writeFileSync(resolve(directory, 'reviewedUnit-report.md'), markdown);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
if (report.verdict !== 'GREEN_FOR_REVIEWED_UNIT_SCOPE') process.exitCode = 1;
