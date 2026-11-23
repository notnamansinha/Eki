import { readdirSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safetyPreflight } from './safety-preflight.mjs';

/**
 * The disposable emulator backend (e2e/emulator/backend.mjs) for the local load
 * and fault drills (qa/LOAD_DRILLS.md). Only scripts/qa/run-load.mjs starts it,
 * with the loopback network guard preloaded. Every production budget, limiter
 * and worker keeps its value. The wrapper adds two things:
 *
 * - Every 5 s it appends this process's memory and active libuv resource counts
 *   to EKI_LOAD_RESOURCE_LOG, so the runner can measure growth across the soak
 *   without sending the process any message.
 * - With EKI_LOAD_FIRESTORE_PROXY set, the fixture's Firestore client connects
 *   to that loopback Toxiproxy listener, which forwards to the Firestore
 *   emulator, so the dependency drill can cut Firestore off from the API.
 */
safetyPreflight(process.env, { mode: 'emulator' });
if (process.env.EKI_QA_LOAD !== '1') throw new Error('The load backend runs only under scripts/qa/run-load.mjs');
if (!globalThis.__ekiQaNetworkGuard?.enabled) throw new Error('The load backend needs the preloaded loopback guard');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const resourceLog = process.env.EKI_LOAD_RESOURCE_LOG ?? '';
const fromEvidence = relative(resolve(root, 'artifacts/qa'), resourceLog);
if (!isAbsolute(resourceLog) || fromEvidence.startsWith('..') || isAbsolute(fromEvidence)) {
  throw new Error('EKI_LOAD_RESOURCE_LOG must name a file under artifacts/qa');
}

// Asynchronous and serialized: a slow disk must never block the event loop of
// the process under test. The sample is taken when the timer fires, so a gap
// between samples means the event loop itself was blocked.
let writing = Promise.resolve();
function sample() {
  const memory = process.memoryUsage();
  const resources = process.getActiveResourcesInfo();
  let fds = null;
  try { fds = readdirSync('/proc/self/fd').length; } catch { /* only Linux exposes the descriptor table */ }
  const line = JSON.stringify({
    at: Date.now(), pid: process.pid, rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal,
    external: memory.external, activeResources: resources.length,
    sockets: resources.filter(type => /^(TCP|Pipe|UDP|TTY)/.test(type)).length, fds,
  }) + '\n';
  writing = writing.then(() => appendFile(resourceLog, line)).catch(() => { /* a lost sample shows as a gap */ });
}
sample();
setInterval(sample, 5_000).unref();

const proxy = process.env.EKI_LOAD_FIRESTORE_PROXY;
let rerouted = 0;
if (proxy !== undefined) {
  if (!/^127\.0\.0\.1:18\d{3}$/.test(proxy)) throw new Error('EKI_LOAD_FIRESTORE_PROXY must be 127.0.0.1:<18000 to 18999>');
  // firebase-admin re-exports this class, and both resolve to the same module.
  const { Firestore } = createRequire(resolve(root, 'backend/package.json'))('@google-cloud/firestore');
  const settings = Firestore.prototype.settings;
  const port = Number(proxy.split(':')[1]);
  // FIRESTORE_EMULATOR_HOST overrides settings.host, and the fixture's preflight
  // requires it to name the emulator port. Swap it for this one call only. The
  // client keeps the port it resolved at construction unless one is passed.
  Firestore.prototype.settings = function settingsThroughProxy(value) {
    const emulator = process.env.FIRESTORE_EMULATOR_HOST;
    process.env.FIRESTORE_EMULATOR_HOST = proxy;
    try {
      const result = settings.call(this, { ...value, host: proxy, port });
      if (this._settings?.servicePath !== '127.0.0.1' || this._settings?.port !== port) {
        throw new Error('The Firestore client did not take the dependency proxy address');
      }
      rerouted += 1;
      return result;
    } finally {
      process.env.FIRESTORE_EMULATOR_HOST = emulator;
    }
  };
}

await import('../../e2e/emulator/backend.mjs');
if (proxy !== undefined && rerouted !== 1) throw new Error('The fixture did not configure Firestore once; the dependency proxy was not applied');
