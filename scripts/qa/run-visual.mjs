import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRoot } from './acceptance-catalog.mjs';
import { workingTreeState } from './working-tree.mjs';
import {
  VISUAL_IMAGE, assertImageMatches, dockerRunArgs, installedPlaywrightVersions,
  parseVisualArgs, playwrightArgs, publishedPort,
} from './visual-plan.mjs';

/**
 * Visual and accessibility-tree baselines (qa/VISUAL_BASELINES.md).
 *
 *   node scripts/qa/run-visual.mjs                      compare with the committed baselines
 *   node scripts/qa/run-visual.mjs --update             rewrite the baselines that differ, for review
 *   node scripts/qa/run-visual.mjs -- --project=phone   pass arguments to `playwright test`
 *
 * Tests run on this machine; only the browsers run in the pinned Linux image,
 * so a baseline renders the same on Windows, macOS, Linux and CI.
 */
const options = parseVisualArgs(process.argv.slice(2));
const versions = installedPlaywrightVersions(repositoryRoot);
assertImageMatches(versions);

const git = args => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
const docker = (args, extra = {}) => execFileSync('docker', args, { encoding: 'utf8', ...extra }).trim();
const outputDirectory = resolve(repositoryRoot, 'artifacts/visual');
mkdirSync(outputDirectory, { recursive: true });

const name = `eki-visual-${process.pid}`;
const record = {
  schemaVersion: 1,
  mode: options.update ? 'update' : 'compare',
  sourceCommit: git(['rev-parse', 'HEAD']),
  ...workingTreeState(repositoryRoot),
  startedAt: new Date().toISOString(), finishedAt: null,
  image: VISUAL_IMAGE, playwright: versions.test,
  passthrough: options.passthrough, exitCode: null, setupError: null,
};
const writeRecord = () => writeFileSync(resolve(outputDirectory, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);

function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8' });
    if (/Listening on ws:\/\//.test(`${logs.stdout}${logs.stderr}`)) return;
    if (logs.status !== 0) throw new Error(`The browser container stopped: ${logs.stderr.trim()}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error('The browser server did not start within 60 s.');
}

let exitCode = 1;
let started = false;
try {
  docker(dockerRunArgs({ name, playwrightCorePath: resolve(repositoryRoot, 'node_modules/playwright-core') }), { stdio: ['ignore', 'pipe', 'inherit'] });
  started = true;
  waitForServer();
  const port = publishedPort(docker(['port', name, '3000/tcp']));
  const cli = resolve(repositoryRoot, 'node_modules/@playwright/test/cli.js');
  const run = spawnSync(process.execPath, [cli, ...playwrightArgs(options)], {
    cwd: repositoryRoot, stdio: 'inherit',
    env: { ...process.env, EKI_VISUAL_WS_ENDPOINT: `ws://127.0.0.1:${port}/` },
  });
  exitCode = run.status ?? 1;
} catch (error) {
  record.setupError = error instanceof Error ? error.message : String(error);
  console.error(record.setupError);
} finally {
  if (started) spawnSync('docker', ['stop', name], { stdio: 'ignore' });
  record.exitCode = exitCode;
  record.finishedAt = new Date().toISOString();
  writeRecord();
}
process.exit(exitCode);
