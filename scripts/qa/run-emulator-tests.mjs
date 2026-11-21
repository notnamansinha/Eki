import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { safetyPreflight } from './safety-preflight.mjs';
import { emulatorTestMap } from '../../qa/emulator-test-map.mjs';
import { removeGeneratedDemoConfig } from './emulator-environment.mjs';
import { verifiedEmulatorTargets } from './evidence-inputs.mjs';
import { describeDirty, workingTreeState } from './working-tree.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = resolve(root, 'artifacts/qa'); mkdirSync(directory, { recursive: true });
const json = resolve(directory, 'emulator-vitest.json');
rmSync(json, { force: true }); rmSync(resolve(directory, 'emulator-junit.xml'), { force: true });
const report = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  ...workingTreeState(root),
  startedAt: new Date().toISOString(), timezone: 'Asia/Calcutta', level: 'L2',
  workflowRunId: process.env.GITHUB_RUN_ID ?? null, node: process.version, platform: process.platform,
  java: spawnSync('java', ['-version'], { encoding: 'utf8', timeout: 5000 }).stderr?.trim() ?? null,
  firebaseTools: '15.14.0',
  verdict: 'BLOCKED', physicalMotionExecuted: false, realProvidersExecuted: false, osNetworkSandboxVerified: false };
try {
  report.generatedDemoConfigRemoved = removeGeneratedDemoConfig(process.env);
  safetyPreflight(process.env);
  if (process.env.GCLOUD_PROJECT !== 'demo-eki-qa' || process.env.EKI_QA_CONFIRM_DISPOSABLE !== '1' ||
    process.env.EKI_QA_EXTERNAL_PROVIDERS !== 'mock') throw new Error('Disposable demo setup required');
  const response = await fetch('http://127.0.0.1:4405/emulators', { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error('Emulator hub unavailable');
  const targets = await response.json();
  report.emulatorTargets = verifiedEmulatorTargets(targets);
  const require = createRequire(resolve(root, 'backend/package.json'));
  const script = require('./package.json').scripts['test:rules-integration'];
  const args = script.replace(/^vitest /, '').split(' ');
  const cli = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  const guard = pathToFileURL(resolve(root, 'scripts/qa/network-guard.mjs')).href;
  const result = spawnSync(process.execPath, [cli, ...args,
    '--reporter=default', '--reporter=json', '--reporter=junit',
    `--outputFile.json=${json}`, `--outputFile.junit=${resolve(directory, 'emulator-junit.xml')}`],
  { cwd: resolve(root, 'backend'), encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: `--import=${guard}` } });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  writeFileSync(resolve(directory, 'emulator-run.log'), (result.stdout ?? '') + (result.stderr ?? ''));
  report.exitCode = result.status; report.runnerError = result.error?.code ?? null;
  if (existsSync(json)) {
    const observed = JSON.parse(readFileSync(json, 'utf8'));
    const assertions = observed.testResults.flatMap(file => file.assertionResults);
    if (observed.numTotalTests !== assertions.length || !assertions.length) throw new Error('Emulator assertion census inconsistent/empty');
    report.counts = { discovered: observed.numTotalTests, passed: observed.numPassedTests,
      failed: observed.numFailedTests, blocked: assertions.filter(test => !['passed', 'failed'].includes(test.status)).length };
    report.assertions = observed.testResults.flatMap(file => file.assertionResults.map(test => ({
      path: file.name.replaceAll('\\', '/').replace(root.replaceAll('\\', '/') + '/', ''),
      name: [...test.ancestorTitles, test.title].join(' > '), status: test.status,
      durationMs: test.duration ?? null, failureMessages: test.failureMessages ?? [],
    })));
    report.cases = emulatorTestMap.map(mapping => ({ caseId: mapping.caseId, scope: mapping.scope, level: 'L2',
      status: mapping.tests.every(link => report.assertions.some(test => test.path === link.path && test.name === link.name && test.status === 'passed'))
        ? 'PARTIAL' : mapping.tests.some(link => report.assertions.some(test => test.path === link.path && test.name === link.name && test.status === 'failed')) ? 'FAIL' : 'BLOCKED' }));
    report.verdict = result.status === 0 && report.counts.failed === 0 && report.counts.blocked === 0 && report.cases.every(item => item.status === 'PARTIAL')
      ? 'GREEN_FOR_EXECUTED_EMULATOR_SCOPE' : report.counts.failed ? 'RED' : 'BLOCKED';
  }
} catch (error) { report.setupError = error.message; console.error(`Emulator QA blocked: ${error.message}`); }
report.finishedAt = new Date().toISOString();
writeFileSync(resolve(directory, 'emulator-report.json'), JSON.stringify(report, null, 2) + '\n');
const markdown = ['# Disposable emulator execution', '', `Commit: ${report.sourceCommit}; dirty: ${describeDirty(report)}; verdict: ${report.verdict}.`,
  `Observed L2 assertions: ${JSON.stringify(report.counts ?? { blocked: 'setup/runner unavailable' })}.`,
  '', '| Case | Observed scope status |', '| --- | --- |', ...(report.cases ?? []).map(item => `| ${item.caseId} | ${item.status} at L2 |`),
  '', 'Demo namespaces, explicit loopback emulator targets and a preloaded Node socket/DNS guard confine this suite’s SDK transport.',
  'This is not an OS sandbox for arbitrary native code or subprocesses. Application bootstrap/provider/cloud/physical acceptance is separate.',
  '', report.setupError ? `Setup: ${report.setupError}` : '', ''].join('\n');
writeFileSync(resolve(directory, 'emulator-report.md'), markdown);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
if (report.verdict !== 'GREEN_FOR_EXECUTED_EMULATOR_SCOPE') process.exitCode = 1;
