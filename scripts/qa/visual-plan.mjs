import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Pure parts of the visual baseline runner (qa/VISUAL_BASELINES.md), kept apart
 * from scripts/qa/run-visual.mjs so scripts/qa-visual.test.mjs can check them.
 *
 * Every baseline is rendered by the browsers inside this image. The tag must
 * equal the installed @playwright/test version: the test runner on the host
 * drives the image's browsers through `playwright run-server`, and the two only
 * connect when their versions match. Bump the tag and digest together with
 * @playwright/test, then regenerate and review the baselines.
 */
export const VISUAL_IMAGE_TAG = 'v1.64.1-noble';
export const VISUAL_IMAGE_DIGEST = 'sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f';
export const VISUAL_IMAGE = `mcr.microsoft.com/playwright@${VISUAL_IMAGE_DIGEST}`;
export const VISUAL_CONFIG = 'playwright.visual.config.ts';
export const SERVER_PORT_IN_CONTAINER = 3000;

const USAGE = 'Usage: node scripts/qa/run-visual.mjs [--update] [-- <playwright test arguments>]';

/** Splits runner flags from arguments passed through to `playwright test`. */
export function parseVisualArgs(args) {
  const separator = args.indexOf('--');
  const own = separator === -1 ? args : args.slice(0, separator);
  const passthrough = separator === -1 ? [] : args.slice(separator + 1);
  for (const arg of own) {
    if (arg !== '--update') throw new Error(`${USAGE}\nUnknown option: ${arg}`);
  }
  if (passthrough.some(arg => arg.startsWith('--update-snapshots') || arg === '-u')) {
    throw new Error(`${USAGE}\nUse --update instead of passing --update-snapshots through.`);
  }
  return { update: own.includes('--update'), passthrough };
}

/** The version the image tag names, for example `1.64.1` for `v1.64.1-noble`. */
export function imageVersion(tag = VISUAL_IMAGE_TAG) {
  const match = /^v(\d+\.\d+\.\d+)-[a-z]+$/.exec(tag);
  if (!match) throw new Error(`Unexpected Playwright image tag ${tag}`);
  return match[1];
}

/** The packages that must match the image, by the key each version is reported under. */
const PLAYWRIGHT_PACKAGES = { test: '@playwright/test', core: 'playwright-core' };

/** Installed versions of the packages that must match the image. */
export function installedPlaywrightVersions(repositoryRoot) {
  const version = name => JSON.parse(readFileSync(resolve(repositoryRoot, 'node_modules', name, 'package.json'), 'utf8')).version;
  return Object.fromEntries(Object.entries(PLAYWRIGHT_PACKAGES).map(([key, name]) => [key, version(name)]));
}

/** Throws unless the host test runner and the image share one Playwright version. */
export function assertImageMatches(versions, tag = VISUAL_IMAGE_TAG) {
  const expected = imageVersion(tag);
  const mismatched = Object.entries(versions).filter(([, version]) => version !== expected);
  if (mismatched.length) {
    const found = mismatched.map(([key, version]) => `${PLAYWRIGHT_PACKAGES[key]} ${version}`).join(', ');
    throw new Error(`VISUAL_IMAGE_MISMATCH: the baseline image is Playwright ${expected} but ${found} is installed. `
      + 'Update VISUAL_IMAGE_TAG and VISUAL_IMAGE_DIGEST in scripts/qa/visual-plan.mjs, then regenerate and review the baselines.');
  }
}

/**
 * `docker run` arguments for the browser server. The published port binds to
 * the host's loopback only, so nothing else on the network can drive the
 * browsers. The server's own playwright-core is the host's installed copy,
 * mounted read-only, so the container fetches nothing from npm.
 */
export function dockerRunArgs({ name, playwrightCorePath }) {
  return [
    'run', '--detach', '--rm', '--init', '--name', name,
    '--publish', `127.0.0.1::${SERVER_PORT_IN_CONTAINER}`,
    '--user', 'pwuser',
    '--mount', `type=bind,source=${playwrightCorePath},target=/opt/playwright-core,readonly`,
    VISUAL_IMAGE,
    'node', '/opt/playwright-core/cli.js', 'run-server', '--port', String(SERVER_PORT_IN_CONTAINER), '--host', '0.0.0.0',
  ];
}

/** `docker port` arguments for the browser server's published port. */
export function dockerPortArgs(name) {
  return ['port', name, `${SERVER_PORT_IN_CONTAINER}/tcp`];
}

/** The host port from `docker port` output such as `127.0.0.1:55012`. */
export function publishedPort(output) {
  const match = /^127\.0\.0\.1:(\d+)$/m.exec(output.trim());
  if (!match) throw new Error(`The browser server is not published on 127.0.0.1: ${output.trim() || '(no output)'}`);
  return Number(match[1]);
}

/**
 * Arguments for `node node_modules/@playwright/test/cli.js`. Calling the CLI
 * through node rather than a shell keeps each passed-through argument whole on
 * every platform. A comparison run never writes a baseline, so a missing
 * baseline fails instead of quietly becoming one.
 */
export function playwrightArgs({ update, passthrough }) {
  return ['test', '--config', VISUAL_CONFIG, `--update-snapshots=${update ? 'changed' : 'none'}`, ...passthrough];
}
