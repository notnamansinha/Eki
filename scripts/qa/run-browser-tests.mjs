import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safetyPreflight } from './safety-preflight.mjs';
import { removeGeneratedDemoConfig } from './emulator-environment.mjs';
import { browserTestMap } from '../../qa/browser-test-map.mjs';
import { classifyBrowserCase } from './browser-evidence.mjs';
import { verifiedEmulatorTargets } from './evidence-inputs.mjs';
import { describeDirty, workingTreeState } from './working-tree.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = resolve(root, 'artifacts/qa'); mkdirSync(directory, { recursive: true });
for (const path of ['browser-playwright.json', 'browser-progress.json', 'browser-junit.xml', 'browser-run.log', 'browser-results']) rmSync(resolve(directory, path), { force: true, recursive: true });
const report = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  ...workingTreeState(root),
  startedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  workflowRunId: process.env.GITHUB_RUN_ID ?? null, level: 'L3', verdict: 'BLOCKED',
  providers: 'synthetic map SDK and in-memory Routes/Places HTTP responses; real local Auth/Firestore/RTDB emulators', realProvidersExecuted: false, physicalMotionExecuted: false,
  fullNextProductionExportExecuted: false, appCheckAttestationExecuted: false, osNetworkSandboxVerified: false };
try {
  const scope = process.env.EKI_QA_BROWSER_SCOPE ?? 'all';
  if (!['all', 'providers', 'service'].includes(scope)) throw new Error('Unknown bounded browser scope');
  report.scope = scope;
  removeGeneratedDemoConfig(process.env); safetyPreflight(process.env, { mode: 'emulator' });
  const response = await fetch('http://127.0.0.1:4405/emulators', { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error('Emulator hub unavailable');
  const targets = await response.json();
  report.emulatorTargets = verifiedEmulatorTargets(targets);
  const require = createRequire(resolve(root, 'package.json'));
  const cli = require.resolve('@playwright/test/cli');
  const result = spawnSync(process.execPath, [cli, 'test', '--config', 'playwright.emulator.config.ts'], {
    // Forty serial mobile/desktop executions can exceed five minutes on a
    // supported Windows host. Keep a finite budget below the launcher deadline
    // while allowing the complete report and shutdown to finish.
    cwd: root, env: process.env, encoding: 'utf8', timeout: 6 * 60_000, maxBuffer: 8 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  writeFileSync(resolve(directory, 'browser-run.log'), (result.stdout ?? '') + (result.stderr ?? ''));
  report.exitCode = result.status; report.runnerError = result.error?.code ?? null;
  const progressPath = resolve(directory, 'browser-progress.json');
  if (existsSync(progressPath)) report.partialProgress = JSON.parse(readFileSync(progressPath, 'utf8'));
  const json = resolve(directory, 'browser-playwright.json');
  if (!existsSync(json)) throw new Error('Browser runner produced no observed report');
  const observed = JSON.parse(readFileSync(json, 'utf8'));
  const flatten = suites => suites.flatMap(suite => [...(suite.specs ?? []), ...flatten(suite.suites ?? [])]);
  report.tests = flatten(observed.suites).flatMap(spec => spec.tests.map(test => ({ name: spec.title, path: spec.file,
    project: test.projectName, status: test.status, annotations: test.annotations,
    results: test.results.map(result => ({ status: result.status, durationMs: result.duration, retry: result.retry, errors: result.errors })) })));
  report.browserVersions = [...new Set(report.tests.flatMap(test => (test.annotations ?? []).filter(item => item.type === 'browser-version').map(item => item.description)))];
  report.counts = { discovered: report.tests.length, passed: observed.stats.expected, failed: observed.stats.unexpected,
    skipped: observed.stats.skipped, flaky: observed.stats.flaky };
  if (report.tests.length !== Object.values(report.counts).slice(1).reduce((a, b) => a + b, 0) || !report.tests.length) throw new Error('Browser assertion census inconsistent/empty');
  report.cases = browserTestMap.filter(mapping => scope === 'all' || mapping.tests.some(link =>
    link.name.includes(scope === 'providers' ? 'provider quota' : 'admin live service controls'))).map(mapping => {
    return { caseId: mapping.caseId, scope: mapping.scope, level: 'L3',
      status: classifyBrowserCase(mapping, report.tests) };
  });
  report.verdict = result.status === 0 && report.counts.failed === 0 && report.counts.skipped === 0 && report.counts.flaky === 0
    && report.cases.every(item => item.status === 'PARTIAL')
    ? 'GREEN_FOR_EXECUTED_BROWSER_SCOPE' : report.counts.failed ? 'RED' : 'BLOCKED';
} catch (error) { report.setupError = error.message; console.error(`Browser QA blocked: ${error.message}`); }
report.finishedAt = new Date().toISOString();
writeFileSync(resolve(directory, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
const markdown = `# Disposable browser acceptance\n\nCommit: ${report.sourceCommit}; dirty: ${describeDirty(report)}; scope: ${report.scope ?? 'setup blocked'}; verdict: ${report.verdict}.\n\nObserved test executions: ${JSON.stringify(report.counts ?? { blocked: 'setup unavailable' })}.\n\nActual passenger components, AuthProvider, database SDKs and backend bootstrap; loopback-only browser routes and backend Node transport guard. Maps/Places responses are synthetic and role verification uses Firebase Auth. No production Next export, real OAuth/Maps, physical motion or OS sandbox claim.\n\n${report.setupError ?? ''}\n`;
writeFileSync(resolve(directory, 'browser-report.md'), markdown);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
if (report.verdict !== 'GREEN_FOR_EXECUTED_BROWSER_SCOPE') process.exitCode = 1;
