import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from './acceptance-catalog.mjs';

const require = createRequire(resolve(repositoryRoot, 'backend/package.json'));
const { load } = require('js-yaml');
const files = ['.github/workflows/deep-qa.yml', '.github/workflows/weekly-reliability.yml'];
const allowedActions = new Set([
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
  'actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97',
  'actions/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd',
  'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  'actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333',
]);

export function verifyIsolatedWorkflow(workflow) {
  if (JSON.stringify(workflow.permissions) !== JSON.stringify({ contents: 'read' })
      || !workflow.concurrency?.group || workflow.concurrency.cancel_in_progress === true
      || workflow.concurrency['cancel-in-progress'] !== false) throw Error('Read-only permissions and bounded overlap required');
  if (Object.keys(workflow.on ?? {}).sort().join(',') !== 'push,schedule,workflow_dispatch'
      || ![JSON.stringify(['codex/qa-nightly-reliability']), JSON.stringify(['codex/qa-nightly-reliability', 'codex/qa-api-boundaries', 'codex/qa-native-evidence', 'codex/qa-reviewed-unit-evidence', 'codex/qa-component-evidence', 'codex/qa-http-unit-evidence'])].includes(JSON.stringify(workflow.on.push.branches))
      || !Array.isArray(workflow.on.schedule) || workflow.on.schedule.length !== 1) throw Error('Only trusted schedule and owned dry-run events permitted');
  if (Object.keys(workflow.jobs ?? {}).sort().join(',') !== 'report,resolve,suites'
      || workflow.jobs.suites.needs !== 'resolve'
      || workflow.jobs.suites.strategy?.['max-parallel'] !== 2
      || workflow.jobs.suites.strategy?.['fail-fast'] !== false
      || JSON.stringify(workflow.jobs.report.needs) !== JSON.stringify(['resolve', 'suites'])
      || workflow.jobs.report.if !== "always() && needs.resolve.result == 'success'") throw Error('Required immutable-source suite/report dependency graph missing');
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (!Number.isInteger(job['timeout-minutes']) || job['timeout-minutes'] > 15 || job['timeout-minutes'] < 1
        || job.permissions || job.environment) throw Error('Job needs bounded time and no elevated environment');
    for (const step of job.steps) {
      if (step.uses && !allowedActions.has(step.uses)) throw Error('Unreviewed or unpinned action');
      if (/secrets\.|codex-action|codex exec|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|firebase deploy|gcloud |fly deploy/i.test(JSON.stringify(step)))
        throw Error('Secrets, inference or deployment path in isolated QA');
      if (step.uses?.startsWith('actions/checkout@') && (step.with?.ref !== '${{ needs.resolve.outputs.source-sha }}'
          || step.with?.['persist-credentials'] !== false)) throw Error('Every checkout must use resolved immutable source without credentials');
      if (step.uses?.startsWith('actions/upload-artifact@') && step.with?.['retention-days'] !== 7) throw Error('Artifact retention must be bounded');
    }
    if (name === 'resolve') {
      const script = job.steps.find(step => step.uses?.startsWith('actions/github-script@'))?.with?.script ?? '';
      for (const fragment of ["ref: 'heads/main'", "context.ref !== 'refs/heads/main'", "context.ref !== 'refs/heads/codex/qa-nightly-reliability'", '/^[a-f0-9]{40}$/'])
        if (!script.includes(fragment)) throw Error('Trusted revision resolution guard missing');
    }
  }
  return { accepted: true, scope: 'Declared permissions, trusted revision resolution, action pins, budgets and dependency graph; hosted execution is separate.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 2) throw Error('Workflow check uses fixed reviewed files');
  for (const file of files) console.log(JSON.stringify({ file, ...verifyIsolatedWorkflow(load(readFileSync(resolve(repositoryRoot, file), 'utf8'))) }));
}
