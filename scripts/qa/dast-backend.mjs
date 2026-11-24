import Module from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safetyPreflight } from './safety-preflight.mjs';

/**
 * The disposable emulator backend (e2e/emulator/backend.mjs) for the local
 * DAST profile. Only scripts/qa/run-dast.mjs starts it, with the loopback
 * network guard preloaded.
 *
 * The backend allows each verified user 200 reads and 30 mutations a minute
 * and each IP 1,000 requests a minute. An active scan sends thousands of
 * requests with one identity, so at those budgets almost every payload would
 * be answered by the limiter with 429 and never reach a handler. This wrapper
 * raises those two browser budgets by ADMISSION_SCALE before the server reads
 * them. Every other control, including the route-compute and place-search
 * limiters, keeps its production value. The limiters themselves are covered by
 * the backend tests and stay at their production values on staging.
 */
export const ADMISSION_SCALE = 1000;

safetyPreflight(process.env, { mode: 'emulator' });
if (process.env.EKI_QA_DAST !== '1') throw new Error('The DAST backend runs only under scripts/qa/run-dast.mjs');
if (!globalThis.__ekiQaNetworkGuard?.enabled) throw new Error('The DAST backend needs the preloaded loopback guard');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const target = resolve(root, 'backend/dist/lib/browserAdmission.js');
// The module imports the backend's Firebase Admin setup, which must not run
// before the fixture initializes its emulator app. So patch its exports when
// the server first loads it, not here. backend/dist/server.js reads the
// exports at call time, so the replacements are the functions it mounts.
const load = Module._load;
let patched = false;
Module._load = function patchBrowserAdmission(request, parent, isMain) {
  const exports = load.call(this, request, parent, isMain);
  if (!patched && String(request).endsWith('browserAdmission') && Module._resolveFilename(request, parent, isMain) === target) {
    const { createBrowserAdmission, createBrowserIngressLimiter } = exports;
    exports.createBrowserIngressLimiter = replicas => createBrowserIngressLimiter(replicas, 1000 * ADMISSION_SCALE);
    exports.createBrowserAdmission = replicas => createBrowserAdmission(replicas, { read: 200 * ADMISSION_SCALE, mutation: 30 * ADMISSION_SCALE });
    patched = true;
    Module._load = load;
  }
  return exports;
};

await import('../../e2e/emulator/backend.mjs');
if (!patched) throw new Error('The backend did not load browserAdmission; the DAST budgets were not applied');
