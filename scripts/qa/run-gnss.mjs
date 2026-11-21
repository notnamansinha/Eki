import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { safetyPreflight } from './safety-preflight.mjs';
import { gnssTestMap } from '../../qa/gnss-test-map.mjs';
import { describeDirty, workingTreeState } from './working-tree.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const suites = ['src/services/qaGnssProperties.test.ts', 'src/services/qaTelemetrySequences.test.ts'];

export function summarizeVitest(json, rootPath, mappings = gnssTestMap) {
  if (!json || !Array.isArray(json.testResults) || !Number.isInteger(json.numTotalTests)) throw new Error('Invalid Vitest evidence');
  const assertions = json.testResults.flatMap(file => file.assertionResults.map(test => ({
    path: relative(rootPath, file.name).replaceAll('\\', '/'),
    name: [...test.ancestorTitles, test.title].join(' > '),
    status: test.status === 'passed' ? 'PASS' : test.status === 'failed' ? 'FAIL' : 'BLOCKED',
    durationMs: test.duration ?? null, failureMessages: test.failureMessages ?? [],
  })));
  if (assertions.length !== json.numTotalTests || !assertions.length ||
      assertions.filter(item => item.status === 'PASS').length !== json.numPassedTests ||
      assertions.filter(item => item.status === 'FAIL').length !== json.numFailedTests) throw new Error('Inconsistent Vitest counts');
  return { counts: { discovered: assertions.length, passed: json.numPassedTests, failed: json.numFailedTests,
    blocked: assertions.filter(item => item.status === 'BLOCKED').length }, assertions,
    cases: mappings.map(mapping => ({ caseId: mapping.caseId, scope: mapping.scope, level: 'L1',
      status: mapping.tests.every(link => assertions.some(item => item.path === link.path && item.name === link.name && item.status === 'PASS'))
        ? 'PARTIAL' : mapping.tests.some(link => assertions.some(item => item.path === link.path && item.name === link.name && item.status === 'FAIL'))
          ? 'FAIL' : 'BLOCKED',
      remainingGate: 'Complete source oracle and L2/L3 integration; physical/provider acceptance is separate.' })) };
}

function main() {
  if (process.argv.length > 2) throw new Error('Use EKI_QA_SEED and EKI_QA_REPLAY_PATH; CLI arguments are unsupported');
  let configurationError = null;
  try {
    safetyPreflight(process.env);
    const seed = Number(process.env.EKI_QA_SEED ?? 42);
    const replay = process.env.EKI_QA_REPLAY_PATH;
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff ||
        (replay !== undefined && (!Number.isSafeInteger(Number(replay)) || Number(replay) < 0 || Number(replay) >= 400))) {
      throw new Error('EKI_QA_SEED/EKI_QA_REPLAY_PATH: bounded numeric property configuration required');
    }
  } catch (error) { configurationError = error.message; }
  const require = createRequire(resolve(root, 'backend/package.json'));
  const directory = resolve(root, 'artifacts/qa'); mkdirSync(directory, { recursive: true });
  const jsonPath = resolve(directory, 'gnss-vitest.json');
  // Never reuse a stale green report when the child fails before starting.
  rmSync(jsonPath, { force: true });
  rmSync(resolve(directory, 'gnss-junit.xml'), { force: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const { dirty, ignoredChanges } = workingTreeState(root);
  const cli = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  const started = new Date().toISOString();
  const result = configurationError ? { status: null, error: { code: 'QA_CONFIGURATION_BLOCKED' }, stdout: '', stderr: configurationError + '\n' }
    : spawnSync(process.execPath, [cli, 'run', ...suites, '--maxWorkers=1', '--no-file-parallelism',
    '--reporter=default', '--reporter=json', '--reporter=junit', `--outputFile.json=${jsonPath}`,
    `--outputFile.junit=${resolve(directory, 'gnss-junit.xml')}`],
  { cwd: resolve(root, 'backend'), encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  writeFileSync(resolve(directory, 'gnss-run.log'), (result.stdout ?? '') + (result.stderr ?? ''));
  let evidence = null; let evidenceError = null;
  try { if (existsSync(jsonPath)) evidence = summarizeVitest(JSON.parse(readFileSync(jsonPath, 'utf8')), root); }
  catch (error) { evidenceError = error.message; }
  const verdict = result.status === 0 && evidence && evidence.counts.blocked === 0 && evidence.counts.failed === 0 &&
    evidence.cases.every(item => item.status === 'PARTIAL')
    ? 'GREEN_FOR_UNIT_SCOPE' : evidence?.counts.failed ? 'RED' : 'BLOCKED';
  const report = { schemaVersion: 1, sourceCommit: commit, dirty, ignoredChanges, startedAt: started, finishedAt: new Date().toISOString(),
    timezone: 'Asia/Calcutta', workflowRunId: process.env.GITHUB_RUN_ID ?? null, level: 'L1',
    environment: { node: process.version, platform: process.platform, vitest: require('vitest/package.json').version },
    seed: process.env.EKI_QA_SEED ?? '42', replayPath: process.env.EKI_QA_REPLAY_PATH ?? null,
    verdict, runnerExitCode: result.status, runnerError: result.error?.code ?? null, evidenceError, ...evidence,
    completeFeatureCases: 0, physicalMotionExecuted: false, realProvidersExecuted: false };
  writeFileSync(resolve(directory, 'gnss-report.json'), JSON.stringify(report, null, 2) + '\n');
  const markdown = ['# GNSS software execution', '', `Commit: ${commit}; dirty: ${describeDirty({ dirty, ignoredChanges })}; level: L1; verdict: ${verdict}.`,
    `Started: ${started}; Node: ${process.version}; seed: ${report.seed}; replay path: ${report.replayPath ?? 'all'}.`, '',
    `Assertions: ${evidence?.counts.discovered ?? 0} discovered; ${evidence?.counts.passed ?? 0} passed; ${evidence?.counts.failed ?? 0} failed; ${evidence?.counts.blocked ?? 'runner blocked'} blocked.`, '',
    '| Case | Unit status | Tested scope |', '| --- | --- | --- |',
    ...(evidence?.cases ?? []).map(item => `| ${item.caseId} | ${item.status} | ${item.scope} |`), '',
    'Zero full feature acceptance cases are closed by this L1 suite. No actual RF, vehicle motion, provider, browser or emulator observation is claimed.', ''].join('\n');
  writeFileSync(resolve(directory, 'gnss-report.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
  if (verdict !== 'GREEN_FOR_UNIT_SCOPE') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
