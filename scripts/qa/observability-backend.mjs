import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLoopbackUrl, safetyPreflight } from './safety-preflight.mjs';

/**
 * The disposable emulator backend (e2e/emulator/backend.mjs) with
 * OpenTelemetry started in the order backend/src/bootstrap.ts uses: the SDK
 * first, then the console bridge, then the application. Only
 * scripts/qa/run-observability-drill.mjs starts it, with the loopback network
 * guard preloaded and OTLP pointed at its loopback receiver.
 */
safetyPreflight(process.env, { mode: 'emulator' });
if (process.env.EKI_QA_OBSERVABILITY !== '1') throw new Error('The observability backend runs only under scripts/qa/run-observability-drill.mjs');
if (!globalThis.__ekiQaNetworkGuard?.enabled) throw new Error('The observability backend needs the preloaded loopback guard');
assertLoopbackUrl(process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '', 'OTEL_EXPORTER_OTLP_ENDPOINT');
for (const signal of ['TRACES', 'METRICS', 'LOGS']) {
  if (process.env[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`]) throw new Error(`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT must be unset`);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Fail rather than drift if the production entry point changes its order.
const bootstrap = readFileSync(resolve(root, 'backend/dist/bootstrap.js'), 'utf8');
const positions = ['startTelemetry)()', 'installConsoleBridge', './server'].map(token => bootstrap.indexOf(token));
if (positions.some(position => position < 0) || positions[0] > positions[1] || positions[1] > positions[2]) {
  throw new Error('backend/dist/bootstrap.js no longer starts telemetry, then the console bridge, then the server; update this wrapper');
}
const require = createRequire(resolve(root, 'backend/package.json'));
const { startTelemetry } = require(resolve(root, 'backend/dist/instrumentation.js'));
if (await startTelemetry() !== true) throw new Error('OpenTelemetry did not start');
require(resolve(root, 'backend/dist/lib/logger.js')).installConsoleBridge();
await import('../../e2e/emulator/backend.mjs');
