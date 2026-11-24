import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRoot } from './acceptance-catalog.mjs';
import { safetyPreflight } from './safety-preflight.mjs';
import { describeDirty, workingTreeState } from './working-tree.mjs';

if (process.argv.length > 2) throw Error('Mutation targets the reviewed pure payload module only');
safetyPreflight(process.env);
const directory = resolve(repositoryRoot, 'artifacts/qa'); mkdirSync(directory, { recursive: true });
const rawPath = resolve(directory, 'mutation/report.json'); rmSync(rawPath, { force: true });
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
const { dirty, ignoredChanges } = workingTreeState(repositoryRoot);
const startedAt = new Date().toISOString();
const child = spawnSync(process.execPath, ['node_modules/@stryker-mutator/core/bin/stryker.js', 'run', 'qa/stryker.config.mjs'],
  { cwd: repositoryRoot, encoding: 'utf8', timeout: 600_000, maxBuffer: 12 * 1024 * 1024 });
process.stdout.write(child.stdout ?? ''); process.stderr.write(child.stderr ?? '');
writeFileSync(resolve(directory, 'mutation-run.log'), (child.stdout ?? '') + (child.stderr ?? ''));
let raw = null;
try { raw = JSON.parse(readFileSync(rawPath, 'utf8')); } catch { /* missing report stays blocked */ }
const mutants = Object.entries(raw?.files ?? {}).flatMap(([path, file]) => (file.mutants ?? []).map(item => ({ path, ...item })));
const statuses = ['Killed', 'Survived', 'Timeout', 'NoCoverage', 'CompileError', 'RuntimeError', 'Ignored', 'Pending'];
const counts = Object.fromEntries(statuses.map(status => [status, mutants.filter(item => item.status === status).length]));
const testFiles = Object.keys(raw?.testFiles ?? {});
const expectedFiles = ['backend/src/services/telemetryPayload.test.ts', 'backend/src/services/qaGnssProperties.test.ts'];
const selectionObserved = expectedFiles.every(path => testFiles.some(file => file.replaceAll('\\', '/').endsWith(path)));
const observedTests = Object.values(raw?.testFiles ?? {}).reduce((sum, file) => sum + (file.tests?.length ?? 0), 0);
const valid = mutants.length > 0 && mutants.every(item => statuses.includes(item.status))
  && new Set(mutants.map(item => `${item.path}|${item.id}`)).size === mutants.length && selectionObserved && observedTests >= 31;
const accepted = child.status === 0 && valid && !dirty && counts.Pending === 0;
const report = { schemaVersion: 1, sourceCommit, dirty, ignoredChanges, startedAt, finishedAt: new Date().toISOString(),
  workflowRunId: process.env.GITHUB_RUN_ID ?? null, node: process.version, runnerExitCode: child.status,
  runnerError: child.error?.code ?? null, baselineObserved: accepted,
  verdict: accepted ? 'MUTATION_BASELINE_OBSERVED' : 'BLOCKED', mutants: mutants.length, counts, testFiles, selectionObserved, observedTests,
  remainingCandidates: mutants.filter(item => ['Survived', 'NoCoverage', 'Timeout', 'CompileError', 'RuntimeError'].includes(item.status)),
  scope: 'Pure telemetry payload validator only; survivors require review. No complete feature or fleet acceptance.',
  realProvidersExecuted: false, physicalMotionExecuted: false };
writeFileSync(resolve(directory, 'mutation-report.json'), JSON.stringify(report, null, 2) + '\n');
const markdown = `# Selective mutation baseline\n\nSource: ${sourceCommit}; dirty: ${describeDirty({ dirty, ignoredChanges })}; verdict: ${report.verdict}.\n\nMutants: ${mutants.length}; ${JSON.stringify(counts)}.\n\n${report.scope}\n`;
writeFileSync(resolve(directory, 'mutation-report.md'), markdown);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
if (!accepted) process.exitCode = 1;
