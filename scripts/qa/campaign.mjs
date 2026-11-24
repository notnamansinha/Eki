import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from './acceptance-catalog.mjs';
import { safetyPreflight } from './safety-preflight.mjs';
import { workingTreeState } from './working-tree.mjs';

export function campaignSeeds(commit, day) {
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^\d{4}-\d{2}-\d{2}$/.test(day)
      || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw Error('Invalid campaign provenance');
  let rotating = (Number.parseInt(commit.slice(0, 8), 16) ^ Number(day.replaceAll('-', ''))) >>> 0;
  if ([42, 0].includes(rotating)) rotating++;
  return [42, 0, rotating];
}

export function runCampaign(suite, env = process.env) {
  if (!['gnss', 'emulator', 'browser', 'api', 'native', 'reviewedUnit'].includes(suite)) throw Error('Only named isolated QA suites are supported');
  safetyPreflight(env);
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  const { dirty, ignoredChanges } = workingTreeState(repositoryRoot);
  if (dirty) throw Error('Campaign requires a clean checkout');
  const day = env.EKI_QA_CAMPAIGN_DAY ?? new Date().toISOString().slice(0, 10);
  const seeds = campaignSeeds(sourceCommit, day);
  const directory = resolve(repositoryRoot, 'artifacts/qa'); mkdirSync(directory, { recursive: true });
  const startedAt = new Date().toISOString(); const observations = [];
  const commands = suite === 'gnss' ? seeds.map(seed => ({ args: ['scripts/qa/run-gnss.mjs'], seed, timeout: 150_000 }))
    : suite === 'reviewedUnit' ? [{ args: ['scripts/qa/run-reviewed-unit.mjs'], timeout: 300_000 }]
      : suite === 'native' ? [{ args: ['scripts/qa/run-native.mjs'], timeout: 360_000 }]
      : [{ args: ['scripts/run-rules-emulator.mjs', ...(suite === 'browser' ? ['--browser'] : suite === 'api' ? ['--api'] : [])], timeout: suite === 'browser' ? 480_000 : 390_000 }];
  for (const command of commands) {
    const result = spawnSync(process.execPath, command.args, { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
      timeout: command.timeout, env: { ...env, ...(command.seed === undefined ? {} : { EKI_QA_SEED: String(command.seed) }) } });
    process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
    let report = null;
    try { report = JSON.parse(readFileSync(resolve(directory, `${suite}-report.json`), 'utf8')); } catch { /* blocked */ }
    const accepted = result.status === 0 && report?.sourceCommit === sourceCommit && report.dirty === false
      && report.physicalMotionExecuted === false && report.realProvidersExecuted === false
      && report.counts?.discovered > 0 && report.counts.passed === report.counts.discovered;
    observations.push({ seed: command.seed ?? null, accepted, exitCode: result.status, error: result.error?.code ?? null, report });
    if (command.seed !== undefined) for (const filename of ['report.json', 'report.md', 'junit.xml', 'vitest.json', 'run.log']) {
      try { copyFileSync(resolve(directory, `gnss-${filename}`), resolve(directory, `gnss-seed-${command.seed}-${filename}`)); } catch { /* missing evidence remains blocked */ }
    }
    if (!accepted) break;
  }
  // The aggregate uses the fixed regression seed; additional seeds stay distinct.
  if (suite === 'gnss' && observations[0]?.report) copyFileSync(resolve(directory, 'gnss-seed-42-report.json'), resolve(directory, 'gnss-report.json'));
  const report = { schemaVersion: 1, sourceCommit, dirty, ignoredChanges, suite, day, seeds: suite === 'gnss' ? seeds : [],
    startedAt, finishedAt: new Date().toISOString(), workflowRunId: env.GITHUB_RUN_ID ?? null,
    accepted: observations.length === commands.length && observations.every(item => item.accepted), observations,
    physicalMotionExecuted: false, realProvidersExecuted: false };
  writeFileSync(resolve(directory, `campaign-${suite}.json`), JSON.stringify(report, null, 2) + '\n');
  if (!report.accepted) process.exitCode = 1;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2); if (args.length !== 1) throw Error('Supply exactly one fixed suite name');
  runCampaign(args[0]);
}
