import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildCatalog, repositoryRoot } from './acceptance-catalog.mjs';
import { combineExecutionEvidence, evidenceFamilies } from './execution-report.mjs';
import { campaignSeeds } from './campaign.mjs';

export function validateCampaign(catalog, campaign, family, runId = null) {
  const reasons = [];
  if (!campaign || campaign.sourceCommit !== catalog.sourceCommit || campaign.dirty !== false || catalog.dirty
      || campaign.suite !== family.name || campaign.accepted !== true
      || campaign.physicalMotionExecuted !== false || campaign.realProvidersExecuted !== false
      || (runId && campaign.workflowRunId !== runId)) return ['Missing, failed or mismatched campaign provenance'];
  let seeds;
  try { seeds = campaignSeeds(catalog.sourceCommit, campaign.day); } catch { return ['Invalid campaign seed provenance']; }
  const expectedSeeds = family.name === 'gnss' ? seeds : [null];
  if (!Array.isArray(campaign.observations) || campaign.observations.length !== expectedSeeds.length
      || JSON.stringify(campaign.seeds) !== JSON.stringify(family.name === 'gnss' ? seeds : [])) return ['Missing campaign observations'];
  for (const [index, item] of campaign.observations.entries()) {
    if (item.seed !== expectedSeeds[index] || item.accepted !== true || item.exitCode !== 0
        || (family.name === 'gnss' && String(item.report?.seed) !== String(item.seed))
        || (runId && item.report?.workflowRunId !== runId)) reasons.push('Incorrect, failed or stale seed observation');
    const aggregate = combineExecutionEvidence(catalog, { [family.name]: item.report }, [family]);
    if (aggregate.requiredHarnessExecution !== 'PASS') reasons.push(...aggregate.suites[0].reasons);
  }
  return reasons;
}

async function main() {
  if (process.argv.length > 2) throw Error('Campaign report takes no arguments');
  const catalog = await buildCatalog(); const directory = resolve(repositoryRoot, 'artifacts/qa'); mkdirSync(directory, { recursive: true });
  const suites = evidenceFamilies.map(family => {
    let campaign;
    try { campaign = JSON.parse(readFileSync(resolve(directory, `campaign-${family.name}.json`), 'utf8')); } catch { /* blocked */ }
    return { suite: family.name, reasons: validateCampaign(catalog, campaign, family, process.env.GITHUB_RUN_ID ?? null) };
  });
  const result = spawnSync(process.execPath, ['scripts/qa/execution-report.mjs'], { cwd: repositoryRoot, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  const accepted = result.status === 0 && suites.every(item => !item.reasons.length);
  const report = { sourceCommit: catalog.sourceCommit, dirty: catalog.dirty, ignoredChanges: catalog.ignoredChanges ?? [], generatedAt: new Date().toISOString(), accepted, suites,
    executionReportExitCode: result.status, softwareRelease: 'NOT_RELEASE_READY', vehicleFieldDeployment: 'NOT_VERIFIED' };
  writeFileSync(resolve(directory, 'campaign-summary.json'), JSON.stringify(report, null, 2) + '\n');
  const markdown = `# Nightly campaign observations\n\nSource: ${catalog.sourceCommit}; required recorded campaigns: ${accepted ? 'PASS' : 'BLOCKED'}.\n\n`
    + suites.map(item => `- ${item.suite}: ${item.reasons.length ? item.reasons.join('; ') : 'observed green at this source and workflow run'}`).join('\n')
    + '\n\nSoftware release NOT_RELEASE_READY; physical field deployment NOT_VERIFIED.\n';
  writeFileSync(resolve(directory, 'campaign-summary.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
  if (!accepted) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
