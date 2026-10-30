import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { repositoryRoot } from './qa/acceptance-catalog.mjs';
import { verifyIsolatedWorkflow } from './qa/workflow-policy.mjs';
const { load } = createRequire(resolve(repositoryRoot, 'backend/package.json'))('js-yaml');

test('isolated workflow contract catches elevated permissions untrusted refs inference and unbounded concurrency', () => {
  for (const file of ['deep-qa.yml', 'weekly-reliability.yml']) {
    const workflow = load(readFileSync(resolve(repositoryRoot, '.github/workflows', file), 'utf8'));
    assert.equal(verifyIsolatedWorkflow(workflow).accepted, true);
    for (const mutate of [value => { value.permissions.contents = 'write'; },
      value => { value.jobs.suites.strategy['max-parallel'] = 30; },
      value => { value.jobs.suites.steps[0].with.ref = 'testing'; },
      value => { value.jobs.suites.steps.push({ run: 'codex exec run-tests' }); },
      value => { value.jobs.report.if = 'success()'; },
      value => { value.on.push.branches = ['**']; }]) {
      const invalid = structuredClone(workflow); mutate(invalid);
      assert.throws(() => verifyIsolatedWorkflow(invalid));
    }
  }
});

test('scheduled and manual runs test the default branch, not a retired integration branch', () => {
  for (const file of ['deep-qa.yml', 'weekly-reliability.yml']) {
    const workflow = load(readFileSync(resolve(repositoryRoot, '.github/workflows', file), 'utf8'));
    const resolveStep = workflow.jobs.resolve.steps.find(step => step.uses?.startsWith('actions/github-script@'));
    assert.match(resolveStep.with.script, /getRef\(\{ \.\.\.context\.repo, ref: 'heads\/main' \}\)/);
    assert.doesNotMatch(resolveStep.with.script, /heads\/testing/);
    const retired = structuredClone(workflow);
    const retiredStep = retired.jobs.resolve.steps.find(step => step.uses?.startsWith('actions/github-script@'));
    retiredStep.with.script = retiredStep.with.script.replace("ref: 'heads/main'", "ref: 'heads/testing'");
    assert.throws(() => verifyIsolatedWorkflow(retired), /Trusted revision resolution guard missing/);
  }
});
