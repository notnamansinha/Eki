import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRoot } from './acceptance-catalog.mjs';
import { describeDirty, workingTreeState } from './working-tree.mjs';

if (process.argv.length > 2) throw Error('Weekly report takes no arguments');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
const { dirty, ignoredChanges } = workingTreeState(repositoryRoot);
const directory = resolve(repositoryRoot, 'artifacts/qa'); mkdirSync(directory, { recursive: true });
const suites = ['mutation', 'soak'].map(suite => {
  let report;
  try { report = JSON.parse(readFileSync(resolve(directory, `${suite}-report.json`), 'utf8')); } catch { /* blocked */ }
  const accepted = !dirty && report?.sourceCommit === sourceCommit && report.dirty === false
    && report.physicalMotionExecuted === false && report.realProvidersExecuted === false
    && (!process.env.GITHUB_RUN_ID || report.workflowRunId === process.env.GITHUB_RUN_ID)
    && (suite === 'mutation' ? report.baselineObserved === true && report.mutants > 0
      && report.counts?.Pending === 0 && report.runnerExitCode === 0
      : report.accepted === true && report.trials?.length === 5 && report.trials.every(item => item.accepted === true && item.exitCode === 0));
  return { suite, accepted, report };
});
const accepted = suites.every(item => item.accepted);
const report = { sourceCommit, dirty, ignoredChanges, generatedAt: new Date().toISOString(), baselineObserved: accepted, suites,
  softwareRelease: 'NOT_RELEASE_READY', vehicleFieldDeployment: 'NOT_VERIFIED' };
writeFileSync(resolve(directory, 'weekly-summary.json'), JSON.stringify(report, null, 2) + '\n');
const markdown = `# Weekly reliability baseline\n\nSource: ${sourceCommit}; dirty: ${describeDirty({ dirty, ignoredChanges })}; baseline observed: ${accepted}.\n\n`
  + suites.map(item => `- ${item.suite}: ${item.accepted ? 'current-source baseline observed' : 'BLOCKED'}`).join('\n')
  + '\n\nMutation survivors are retained for review. Admission submissions measure synthetic helpers, not live vehicle latency or long-duration fleet health. Software release NOT_RELEASE_READY; physical field deployment NOT_VERIFIED.\n';
writeFileSync(resolve(directory, 'weekly-summary.md'), markdown);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
console.log(markdown);
if (!accepted) process.exitCode = 1;
