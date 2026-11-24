import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRoot } from './acceptance-catalog.mjs';
import { safetyPreflight } from './safety-preflight.mjs';
import { describeDirty, workingTreeState } from './working-tree.mjs';

if (process.argv.length > 2) throw Error('Soak uses a fixed five-trial budget');
safetyPreflight(process.env);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
const { dirty, ignoredChanges } = workingTreeState(repositoryRoot);
const startedAt = new Date().toISOString(); const trials = [];
for (let index = 0; index < 5; index++) {
  const start = performance.now();
  const result = spawnSync(process.execPath, ['--expose-gc', 'scripts/benchmark-work-admission.mjs'],
    { cwd: repositoryRoot, encoding: 'utf8', timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
  let observation = null;
  try { observation = JSON.parse(result.stdout); } catch { /* failed output remains blocked */ }
  const accepted = result.status === 0 && observation?.fifo === true && observation.rounds?.length === 5
    && observation.rounds.at(-1).submissions === 250_000 && observation.retainedHeapGrowth < 4 * 1024 * 1024;
  trials.push({ index, durationMs: performance.now() - start, accepted, exitCode: result.status,
    error: result.error?.code ?? null, observation, stderr: result.stderr });
  if (!accepted) break;
}
const accepted = !dirty && trials.length === 5 && trials.every(item => item.accepted);
const report = { schemaVersion: 1, sourceCommit, dirty, ignoredChanges, startedAt, finishedAt: new Date().toISOString(),
  workflowRunId: process.env.GITHUB_RUN_ID ?? null, node: process.version,
  accepted, trials, totalSubmissions: trials.reduce((sum, item) => sum + (item.observation?.rounds?.at(-1)?.submissions ?? 0), 0),
  scope: 'Synthetic stalled-dependency production admission helpers, recovery and FIFO. Five independent processes, not a duration soak or fleet latency benchmark.',
  realProvidersExecuted: false, physicalMotionExecuted: false };
const directory = resolve(repositoryRoot, 'artifacts/qa'); mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, 'soak-report.json'), JSON.stringify(report, null, 2) + '\n');
const markdown = `# Bounded admission campaign\n\nSource: ${sourceCommit}; dirty: ${describeDirty({ dirty, ignoredChanges })}; trials: ${trials.length}/5; accepted: ${accepted}.\n\n`
  + `Total synthetic submissions: ${report.totalSubmissions}; measured trial durations (ms): ${trials.map(item => Math.round(item.durationMs)).join(', ')}.\n\n${report.scope}\n`;
writeFileSync(resolve(directory, 'soak-report.md'), markdown);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
console.log(markdown);
if (!accepted) process.exitCode = 1;
