import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRoot } from './qa/acceptance-catalog.mjs';
import {
  VISUAL_CONFIG, VISUAL_IMAGE, VISUAL_IMAGE_TAG, assertImageMatches, dockerRunArgs, imageVersion,
  installedPlaywrightVersions, parseVisualArgs, playwrightArgs, publishedPort,
} from './qa/visual-plan.mjs';

const baselines = resolve(repositoryRoot, 'e2e/visual/baselines');
const PROJECTS = ['phone', 'tablet', 'desktop'];

test('the browser image is pinned by digest and matches the installed Playwright', () => {
  assert.match(VISUAL_IMAGE, /^mcr\.microsoft\.com\/playwright@sha256:[0-9a-f]{64}$/);
  // A Playwright upgrade without a new image fails here, not as a connection error mid-run.
  assert.doesNotThrow(() => assertImageMatches(installedPlaywrightVersions(repositoryRoot)));
  assert.equal(imageVersion(VISUAL_IMAGE_TAG), installedPlaywrightVersions(repositoryRoot).test);
});

test('a version mismatch names both versions and the file to update', () => {
  assert.throws(() => assertImageMatches({ test: '1.65.0', core: '1.65.0' }, 'v1.64.1-noble'),
    /VISUAL_IMAGE_MISMATCH: the baseline image is Playwright 1\.64\.1 but @playwright\/test 1\.65\.0, playwright-core 1\.65\.0 is installed.*visual-plan\.mjs/);
  assert.throws(() => imageVersion('latest'), /Unexpected Playwright image tag/);
});

test('arguments: --update is the only runner flag and snapshots are never updated by pass-through', () => {
  assert.deepEqual(parseVisualArgs([]), { update: false, passthrough: [] });
  assert.deepEqual(parseVisualArgs(['--update', '--', '-g', 'not found', '--project=phone']),
    { update: true, passthrough: ['-g', 'not found', '--project=phone'] });
  assert.throws(() => parseVisualArgs(['--project=phone']), /Unknown option: --project=phone/);
  assert.throws(() => parseVisualArgs(['--', '--update-snapshots=all']), /Use --update/);
  assert.throws(() => parseVisualArgs(['--', '-u']), /Use --update/);
});

test('a comparison run never writes baselines; an update run rewrites only those that differ', () => {
  assert.deepEqual(playwrightArgs({ update: false, passthrough: [] }), ['test', '--config', VISUAL_CONFIG, '--update-snapshots=none']);
  assert.deepEqual(playwrightArgs({ update: true, passthrough: ['-g', 'not found'] }),
    ['test', '--config', VISUAL_CONFIG, '--update-snapshots=changed', '-g', 'not found']);
});

test('the browser server is published on loopback only and fetches nothing', () => {
  const args = dockerRunArgs({ name: 'eki-visual-1', playwrightCorePath: '/repo/node_modules/playwright-core' });
  assert.equal(args[args.indexOf('--publish') + 1], '127.0.0.1::3000');
  assert.ok(args.includes('--rm') && args.includes('--init'));
  assert.equal(args[args.indexOf('--user') + 1], 'pwuser');
  assert.match(args[args.indexOf('--mount') + 1], /,readonly$/);
  assert.ok(args.includes(VISUAL_IMAGE));
  assert.ok(!args.some(arg => /npx|npm/.test(arg)), 'the server is the mounted playwright-core, not a download');
  assert.equal(publishedPort('127.0.0.1:55012\n'), 55012);
  assert.throws(() => publishedPort('0.0.0.0:55012'), /not published on 127\.0\.0\.1/);
});

test('the configuration refuses to run outside the pinned browser and keeps baselines platform-free', () => {
  const config = readFileSync(resolve(repositoryRoot, VISUAL_CONFIG), 'utf8');
  assert.match(config, /if \(!wsEndpoint\) \{\s*throw new Error/);
  assert.match(config, /snapshotPathTemplate: "\{testDir\}\/baselines\/\{projectName\}\/\{arg\}\{ext\}"/);
  assert.doesNotMatch(config, /\{platform\}/);
});

test('every project has the same reviewed states, each with a screenshot and an accessibility tree', () => {
  const states = project => readdirSync(resolve(baselines, project)).sort();
  const touchOnly = ['passenger-live-routes.aria.yml', 'passenger-live-routes.png'];
  for (const project of PROJECTS) {
    const files = states(project);
    const pngs = files.filter(file => file.endsWith('.png')).map(file => file.slice(0, -'.png'.length));
    const trees = files.filter(file => file.endsWith('.aria.yml')).map(file => file.slice(0, -'.aria.yml'.length));
    assert.deepEqual(pngs, trees, `${project}: every screenshot has an accessibility tree`);
    assert.equal(files.length, pngs.length * 2, `${project}: no other files`);
  }
  assert.deepEqual(states('phone'), states('tablet'));
  assert.deepEqual(states('desktop'), states('phone').filter(file => !touchOnly.includes(file)));
});
