import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRoot } from './acceptance-catalog.mjs';
import { sourceCensus } from './source-census.mjs';
import { summarizeNative } from './native-evidence.mjs';
import { safetyPreflight } from './safety-preflight.mjs';
import { describeDirty, workingTreeState } from './working-tree.mjs';

if (process.argv.length > 2) throw Error('Only the fixed native host target is permitted');
safetyPreflight(process.env);
const directory = resolve(repositoryRoot, 'artifacts/qa'); mkdirSync(directory, { recursive: true });
const rawPath = resolve(directory, 'native-platformio.json');
for (const path of [rawPath, resolve(directory, 'native-junit.xml')]) rmSync(path, { force: true });
const report = { schemaVersion: 1, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(),
  ...workingTreeState(repositoryRoot),
  startedAt: new Date().toISOString(), workflowRunId: process.env.GITHUB_RUN_ID ?? null, level: 'L1',
  verdict: 'BLOCKED', physicalMotionExecuted: false, realProvidersExecuted: false, actualBoardExecuted: false,
  nativeTarget: 'native', node: process.version };
try {
  const version = spawnSync('platformio', ['--version'], { encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, PLATFORMIO_SETTING_ENABLE_TELEMETRY: 'false' } });
  report.platformio = version.stdout?.trim();
  if (version.status !== 0 || !/^PlatformIO Core, version 6\.2\.0$/.test(report.platformio)) throw Error('Pinned PlatformIO 6.2.0 required');
  const result = spawnSync('platformio', ['test', '--project-dir', 'hardware', '-e', 'native', '--json-output-path', rawPath,
    '--junit-output-path', resolve(directory, 'native-junit.xml')],
  { cwd: repositoryRoot, encoding: 'utf8', timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PLATFORMIO_SETTING_ENABLE_TELEMETRY: 'false' } });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  writeFileSync(resolve(directory, 'native-run.log'), (result.stdout ?? '') + (result.stderr ?? ''));
  report.runnerExitCode = result.status; report.runnerError = result.error?.code ?? null;
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
  Object.assign(report, summarizeNative(raw, repositoryRoot, sourceCensus(repositoryRoot).firmwareTests));
  report.verdict = result.status === 0 && report.counts.passed === report.counts.discovered && report.diagnostics.length === 0 ? 'GREEN_FOR_NATIVE_SCOPE'
    : report.counts.failed ? 'RED' : 'BLOCKED';
} catch (error) { report.evidenceError = error.message; }
report.finishedAt = new Date().toISOString();
writeFileSync(resolve(directory, 'native-report.json'), JSON.stringify(report, null, 2) + '\n');
const markdown = `# Native firmware policy observations\n\nSource: ${report.sourceCommit}; dirty: ${describeDirty(report)}; level L1; verdict: ${report.verdict}.\n\n`
  + `Assertions: ${JSON.stringify(report.counts ?? {})}. ${report.evidenceError ?? ''}\n\n`
  + 'Only the native host target executed. No actual board, flash/OTA/provisioning, RF, power, clock or live-motion acceptance. Journal codec is an explicit deterministic stand-in, not AES-GCM evidence.\n';
writeFileSync(resolve(directory, 'native-report.md'), markdown);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
if (report.verdict !== 'GREEN_FOR_NATIVE_SCOPE') process.exitCode = 1;
