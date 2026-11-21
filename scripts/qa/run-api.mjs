import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRoot } from './acceptance-catalog.mjs';
import { safetyPreflight } from './safety-preflight.mjs';
import { removeGeneratedDemoConfig } from './emulator-environment.mjs';
import { apiTestMap } from '../../qa/api-test-map.mjs';
import { describeDirty, workingTreeState } from './working-tree.mjs';

const directory = resolve(repositoryRoot, 'artifacts/qa'); mkdirSync(directory, { recursive: true });
for (const file of ['api-junit.xml', 'api-observed.json', 'api-operation-observations.json', 'api-progress.log']) rmSync(resolve(directory, file), { force: true });
const report = { schemaVersion: 1, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(),
  ...workingTreeState(repositoryRoot),
  startedAt: new Date().toISOString(), workflowRunId: process.env.GITHUB_RUN_ID ?? null, node: process.version,
  level: 'L2', verdict: 'BLOCKED', realProvidersExecuted: false, physicalMotionExecuted: false,
  appCheckAttestationExecuted: false, osNetworkSandboxVerified: false };
try {
  if (process.argv.length > 2) throw Error('API acceptance uses fixed protected-operation partitions');
  removeGeneratedDemoConfig(process.env); safetyPreflight(process.env, { mode: 'emulator' });
  const hub = await fetch('http://127.0.0.1:4405/emulators', { signal: AbortSignal.timeout(5000), redirect: 'error' });
  const targets = await hub.json();
  if (!hub.ok || !Object.entries({ firestore: 8085, database: 9005, auth: 9095 }).every(([name, port]) => targets[name]?.host === '127.0.0.1' && targets[name]?.port === port))
    throw Error('Verified emulator targets required');
  const result = spawnSync(process.execPath, ['--import', './scripts/qa/network-guard.mjs', '--test', '--test-concurrency=1',
    '--test-reporter=./scripts/qa/node-json-reporter.mjs', '--test-reporter-destination=stdout',
    '--test-reporter=spec', `--test-reporter-destination=${resolve(directory, 'api-progress.log')}`,
    '--test-reporter=junit', `--test-reporter-destination=${resolve(directory, 'api-junit.xml')}`,
    'scripts/qa/api-authorization.integration.test.mjs'],
  { cwd: repositoryRoot, encoding: 'utf8', timeout: 240_000, maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(resolve(directory, 'api-run.log'), (result.stdout ?? '') + (result.stderr ?? ''));
  report.runnerExitCode = result.status; report.runnerError = result.error?.code ?? null;
  if (result.stdout) {
    const observed = JSON.parse(result.stdout); Object.assign(report, observed);
    writeFileSync(resolve(directory, 'api-observed.json'), JSON.stringify(observed, null, 2) + '\n');
    report.cases = apiTestMap.map(mapping => ({ caseId: mapping.caseId, scope: mapping.scope, level: 'L2',
      status: mapping.tests.every(link => report.assertions.some(item => item.path === link.path && item.name === link.name && item.status === 'PASS')) ? 'PARTIAL'
        : mapping.tests.some(link => report.assertions.some(item => item.path === link.path && item.name === link.name && item.status === 'FAIL')) ? 'FAIL' : 'BLOCKED' }));
    report.operationObservations = JSON.parse(readFileSync(resolve(directory, 'api-operation-observations.json'), 'utf8'));
    if (result.status === 0 && report.counts.discovered === 8 && report.counts.passed === 8 && report.cases.every(item => item.status === 'PARTIAL'))
      report.verdict = 'GREEN_FOR_EXECUTED_API_SCOPE';
    else if (report.counts.failed > 0) report.verdict = 'RED';
  }
} catch (error) { report.setupError = error.message; }
report.finishedAt = new Date().toISOString();
writeFileSync(resolve(directory, 'api-report.json'), JSON.stringify(report, null, 2) + '\n');
const markdown = `# Disposable HTTP authorization scope\n\nSource: ${report.sourceCommit}; dirty: ${describeDirty(report)}; level L2; verdict: ${report.verdict}.\n\n`
  + `Observed assertions: ${JSON.stringify(report.counts ?? {})}; HTTP requests recorded: ${report.operationObservations?.length ?? 0}.\n\n`
  + (report.setupError ? `Setup: ${report.setupError}\n\n` : '')
  + 'Actual backend and local demo Auth/Firestore/RTDB; synthetic providers. Includes saved driver/admin tokens, CLI/HTTP offboarding, case/HEAD admission and device OTA reservations. Cloud staging, physical OTA, token-expiry and real-provider acceptance remain separate. App Check is intentionally removed.\n';
writeFileSync(resolve(directory, 'api-report.md'), markdown); console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
if (report.verdict !== 'GREEN_FOR_EXECUTED_API_SCOPE') process.exitCode = 1;
