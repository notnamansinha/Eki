import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRoot } from './acceptance-catalog.mjs';
import { safetyPreflight } from './safety-preflight.mjs';
import { removeGeneratedDemoConfig } from './emulator-environment.mjs';
import { describeDirty, workingTreeState } from './working-tree.mjs';
import { canonicalCount, canonicalStatus } from './dast-plan.mjs';
import {
  BACKEND_SCOPE, DEFAULT_RECEIVER_PORT, HTTP_SCOPE, SERVICE_NAME, STATUS_ERROR,
  assertRelayRun, backendSources, checkSelectors, createOtlpReceiver, dashboardSelectors, familyCollisions, flattenLogs, flattenMetrics,
  flattenSpans, histogramBuckets, latestSeries, metricCatalogFromExport, metricCatalogFromSource, redact, relayPayload, requestTraces, samplingBand,
  sameCounts, scanCanaries, serverSpans, statusCounts, structuredLines, totalsBy, traceparent,
} from './observability-drill.mjs';

/**
 * Observability drill (qa/OBSERVABILITY_DRILL.md): the compiled backend on the
 * disposable emulator stack exports OTLP/HTTP JSON to a loopback receiver in
 * this process, which checks traces, metrics, logs and redaction.
 *
 *   node scripts/qa/run-observability-drill.mjs                     local drill; started by
 *                                                                   `npm run qa:observability`
 *                                                                   inside the emulators
 *   node scripts/qa/run-observability-drill.mjs --relay --dry-run   validates a relay to a
 *                                                                   remote collector; sends nothing
 *   node scripts/qa/run-observability-drill.mjs --relay             the same drill, also relaying
 *                                                                   each clean payload to the
 *                                                                   confirmed remote collector
 */
const args = process.argv.slice(2);
const usage = [[], ['--relay'], ['--relay', '--dry-run'], ['--relay-in-emulators']];
if (!usage.some(form => JSON.stringify(form) === JSON.stringify(args))) {
  throw new Error('Usage: node scripts/qa/run-observability-drill.mjs [--relay [--dry-run]]');
}
const mode = args[0]?.startsWith('--relay') ? 'relay' : 'local';
const dryRun = args.includes('--dry-run');
const outer = args[0] === '--relay';

const BACKEND = 'http://127.0.0.1:3116';
const CONTROL = 'http://127.0.0.1:3117';
const AUTH = 'http://127.0.0.1:9095/identitytoolkit.googleapis.com/v1';
// Synthetic fixture values from e2e/emulator/backend.mjs and providers.mjs.
const DEVICE_SECRET = 'synthetic-browser-device-only';
const PROVIDER_KEY = 'synthetic-emulator-provider-only';
const FIXTURE_PASSWORD = 'SyntheticOnly123!';
// Planted coordinates near the fixture route. Their five-decimal prefixes are
// the canaries, so a rounded or truncated copy is found as well.
const LATITUDE = 23.0000432;
const LONGITUDE = 72.0000812;
const receiverPort = Number(process.env.EKI_OBS_RECEIVER_PORT || DEFAULT_RECEIVER_PORT);
if (!Number.isInteger(receiverPort) || receiverPort < 1024 || receiverPort > 65535) throw new Error('EKI_OBS_RECEIVER_PORT: a port from 1024 to 65535');

const evidenceDirectory = resolve(repositoryRoot, 'artifacts/qa');
const name = mode === 'local' ? 'observability' : 'observability-relay';
const workDirectory = resolve(evidenceDirectory, name);
const reportBase = resolve(evidenceDirectory, `${name}${dryRun ? '-plan' : '-report'}`);
const git = gitArgs => execFileSync('git', gitArgs, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
// Package manifests are read from disk: some packages do not export ./package.json.
const version = name => {
  for (const directory of ['backend/node_modules', 'node_modules']) {
    try { return JSON.parse(readFileSync(resolve(repositoryRoot, directory, name, 'package.json'), 'utf8')).version; } catch { /* next */ }
  }
  return null;
};

const report = {
  schemaVersion: 1, mode, dryRun,
  sourceCommit: git(['rev-parse', 'HEAD']),
  ...workingTreeState(repositoryRoot),
  startedAt: new Date().toISOString(), finishedAt: null,
  workflowRunId: process.env.GITHUB_RUN_ID ?? null, node: process.version, platform: process.platform, firebaseTools: '15.14.0',
  openTelemetry: Object.fromEntries(['@opentelemetry/sdk-node', '@opentelemetry/sdk-metrics', '@opentelemetry/instrumentation-http',
    '@opentelemetry/instrumentation-express', '@opentelemetry/exporter-trace-otlp-http'].map(name => [name, version(name)])),
  target: 'Compiled backend (backend/dist) on 127.0.0.1:3116 with disposable Auth, Firestore and RTDB emulators (demo-eki-qa)',
  receiver: `http://127.0.0.1:${receiverPort}`,
  relay: null, phases: [], findings: [], verdict: 'BLOCKED', setupError: null,
};
const secrets = [DEVICE_SECRET, PROVIDER_KEY, FIXTURE_PASSWORD];

// ---- relay entry: guard, dry run, then the emulator launcher ----------------

function relaySummary(relay) {
  return { origin: relay.origin, signalPaths: Object.fromEntries(Object.entries(relay.signalUrls).map(([signal, url]) => [signal, new URL(url).pathname])),
    headerNames: relay.headerNames };
}

if (outer) {
  mkdirSync(evidenceDirectory, { recursive: true });
  let exitCode = 1;
  try {
    const relay = assertRelayRun(process.env);
    secrets.push(...Object.values(relay.headers));
    report.relay = relaySummary(relay);
    if (dryRun) {
      report.plan = { phases: ['always (sampler parentbased_traceidratio 1, sampled parents)'], requests: phasePlan('always').map(({ label, method, path, count }) => ({ label, method, path, count })),
        resource: 'OTEL_NODE_RESOURCE_DETECTORS=env; OTEL_RESOURCE_ATTRIBUTES=deployment.environment=drill,service.version=<commit>',
        canaryKinds: ['bearer-token', 'uid', 'email', 'device-secret', 'provider-key', 'latitude', 'longitude', 'search-text'],
        rule: 'A payload with any canary is not forwarded and fails the run.' };
      report.verdict = 'DRY_RUN';
      exitCode = 0;
    } else {
      if (report.dirty) throw new Error('A relay run needs a clean checkout so the evidence names the harness commit');
      exitCode = await new Promise(done => {
        const child = spawn(process.execPath, ['scripts/run-rules-emulator.mjs', '--observability-relay'], { cwd: repositoryRoot, stdio: 'inherit' });
        child.once('exit', code => done(code ?? 1));
        child.once('error', () => done(1));
      });
      process.exit(exitCode);
    }
  } catch (error) {
    report.setupError = redact(error.message, secrets);
  }
  report.finishedAt = new Date().toISOString();
  writeFileSync(`${reportBase}.json`, JSON.stringify(report, null, 2) + '\n');
  const summary = `# Observability relay ${dryRun ? 'plan' : 'run'}\n\nSource ${report.sourceCommit}; dirty: ${describeDirty(report)}; verdict: ${report.verdict}.\n\n`
    + (report.relay ? `Collector origin: ${report.relay.origin}; header names: ${report.relay.headerNames.join(', ') || 'none'}.\n\n` : '')
    + (report.setupError ? `Setup: ${report.setupError}\n\n` : '')
    + (report.plan ? `Requests: ${report.plan.requests.map(item => `${item.count}x ${item.label}`).join(', ')}. Nothing was sent.\n` : '');
  writeFileSync(`${reportBase}.md`, summary);
  console.log(summary);
  process.exit(exitCode);
}

// ---- the drill inside the emulators ------------------------------------------

rmSync(workDirectory, { recursive: true, force: true });
mkdirSync(workDirectory, { recursive: true });

const sleep = ms => new Promise(done => setTimeout(done, ms));
const hex = bytes => randomBytes(bytes).toString('hex');

// Only canonical values from a response reach the report: the status from the
// fixed list of codes, and body fields through canonicalCount.
async function getJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  return { status: canonicalStatus(response.status), body: await response.json().catch(() => null) };
}
const control = (path, method = 'GET') => getJson(`${CONTROL}${path}`, { method, headers: { 'User-Agent': 'eki-observability-drill-control' } });

async function signIn(email, password) {
  const { status, body } = await getJson(`${AUTH}/accounts:signInWithPassword?key=synthetic-only`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (status !== 200 || typeof body?.idToken !== 'string') throw new Error(`Demo identity could not sign in (HTTP ${status})`);
  secrets.push(body.idToken);
  return body.idToken;
}

/** A fresh emulator account whose UID, e-mail and ID token are canaries. */
async function signUpCanary() {
  const email = `obs.drill.${hex(6)}@example.invalid`;
  const password = `Drill-${hex(8)}`;
  const { status, body } = await getJson(`${AUTH}/accounts:signUp?key=synthetic-only`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (status !== 200 || typeof body?.idToken !== 'string' || typeof body.localId !== 'string') throw new Error(`Canary account sign-up failed (HTTP ${status})`);
  secrets.push(body.idToken, body.localId, email, password);
  return { uid: body.localId, email, token: body.idToken };
}

/**
 * The requests of one phase. `always` sends every request with a sampled W3C
 * parent, so each one is a request ID the receiver must see. `default` runs
 * the backend's own sampler on root requests and adds sampled and unsampled
 * parents.
 */
function phasePlan(phase) {
  const traced = { traced: true, sampled: true };
  if (phase === 'always') return [
    { label: 'buses', method: 'GET', path: '/api/buses', auth: 'canary', count: 10, ...traced },
    { label: 'profile-bootstrap', method: 'POST', path: '/api/users/bootstrap', auth: 'canary', count: 1, ...traced },
    { label: 'routes-list', method: 'GET', path: '/api/routes-list', auth: 'canary', count: 5, ...traced },
    { label: 'device-telemetry', method: 'POST', path: '/api/devices/qa_device/telemetry', auth: 'device', count: 3, ...traced },
    { label: 'tampered-token', method: 'GET', path: '/api/buses', auth: 'tampered', count: 1, ...traced },
    { label: 'place-search', method: 'GET', path: '/api/places/search?q=<search-text>', auth: 'admin', provider: 'valid', count: 1, ...traced },
    { label: 'place-search-quota', method: 'GET', path: '/api/places/search?q=<search-text>', auth: 'admin', provider: 'rate-limit', count: 3, ...traced },
    { label: 'place-search-timeout', method: 'GET', path: '/api/places/search?q=<search-text>', auth: 'admin', provider: 'timeout', count: 1, ...traced },
  ];
  return [
    { label: 'buses-root', method: 'GET', path: '/api/buses', auth: 'canary', count: 150 },
    { label: 'unauthenticated-root', method: 'GET', path: '/api/buses', auth: 'none', count: 250 },
    { label: 'place-search-quota-root', method: 'GET', path: '/api/places/search?q=<search-text>', auth: 'admin', provider: 'rate-limit', count: 18 },
    { label: 'parent-sampled', method: 'GET', path: '/api/buses', auth: 'canary', count: 10, traced: true, sampled: true },
    { label: 'parent-unsampled', method: 'GET', path: '/api/buses', auth: 'canary', count: 10, traced: true, sampled: false },
  ];
}

async function startBackend(phase, sampler, logs) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(OTEL_|EKI_OBS_)/.test(key)) delete env[key];
  Object.assign(env, {
    PORT: '3116', WORKER_ENABLED: 'false', NODE_ENV: 'development', CORS_ORIGIN: 'http://127.0.0.1:3115', LOG_LEVEL: 'info',
    EKI_QA_OBSERVABILITY: '1', OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${receiverPort}`, OTEL_SERVICE_NAME: SERVICE_NAME,
    // Spans leave every 500 ms instead of 5 s; metrics keep the SDK's fixed 30 s interval.
    OTEL_BSP_SCHEDULE_DELAY: '500', ...sampler,
    ...(mode === 'relay' ? { OTEL_NODE_RESOURCE_DETECTORS: 'env',
      OTEL_RESOURCE_ATTRIBUTES: `deployment.environment=drill,service.version=${report.sourceCommit.slice(0, 12)}` } : {}),
  });
  const child = spawn(process.execPath, ['--import', './scripts/qa/network-guard.mjs', 'scripts/qa/observability-backend.mjs'],
    { cwd: repositoryRoot, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { logs.stdout += chunk; });
  child.stderr.on('data', chunk => { logs.stderr += chunk; });
  const exit = new Promise(done => child.once('exit', code => done(code)));
  const deadline = Date.now() + 60_000;
  for (;;) {
    let ready = false;
    try {
      ready = (await control('/evidence')).body?.fixtureProcessId === child.pid
        && (await fetch(`${BACKEND}/live`, { signal: AbortSignal.timeout(2_000) })).status === 200;
    } catch { /* starting */ }
    if (ready) break;
    if (child.exitCode !== null || Date.now() > deadline) {
      child.kill();
      throw new Error(`The ${phase} backend did not start; see ${workDirectory}/${phase}-backend.log`);
    }
    await sleep(250);
  }
  return {
    child, exit,
    async stop() {
      if (child.exitCode === null) {
        if (child.connected) child.send({ type: 'eki-qa-shutdown', pid: child.pid }, error => { if (error) child.kill('SIGTERM'); });
        else child.kill('SIGTERM');
      }
      const backstop = setTimeout(() => child.kill('SIGKILL'), 15_000);
      const code = await exit;
      clearTimeout(backstop);
      return code;
    },
  };
}

async function runPhase(phase, receiver, relayState) {
  const sampler = phase === 'always' ? { OTEL_TRACES_SAMPLER: 'parentbased_traceidratio', OTEL_TRACES_SAMPLER_ARG: '1' } : {};
  const entry = { phase, sampler: phase === 'always' ? 'parentbased_traceidratio, argument 1 (set by the drill)' : 'unset: the backend default applies',
    backendExitCode: null, requests: [], checks: [], observations: {} };
  report.phases.push(entry);
  receiver.payloads.length = 0;
  if (relayState) relayState.results.length = 0;
  const logs = { stdout: '', stderr: '' };
  // Fixed canaries exist before the backend starts, so a relay scans its
  // start-up exports too; the account and search canaries join after sign-up.
  const canaries = [{ kind: 'device-secret', value: DEVICE_SECRET }, { kind: 'provider-key', value: PROVIDER_KEY },
    { kind: 'latitude', value: LATITUDE.toFixed(5) }, { kind: 'longitude', value: LONGITUDE.toFixed(5) }];
  if (relayState) relayState.canaries = canaries;
  const backend = await startBackend(phase, sampler, logs);
  let transport = null;
  const requests = entry.requests;
  let lastRequestAt = 0;
  try {
    const admin = await signIn('qa_admin@example.invalid', FIXTURE_PASSWORD);
    const canary = await signUpCanary();
    const searchText = `obsdrill-${hex(6)}`;
    secrets.push(searchText);
    canaries.push({ kind: 'bearer-token', value: canary.token }, { kind: 'uid', value: canary.uid }, { kind: 'email', value: canary.email },
      { kind: 'search-text', value: searchText });
    const tampered = `${canary.token.slice(0, -4)}${canary.token.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`;
    secrets.push(tampered);
    const authorization = { canary: `Bearer ${canary.token}`, admin: `Bearer ${admin}`, tampered: `Bearer ${tampered}`, device: `Device ${DEVICE_SECRET}` };
    let telemetrySequence = 1;
    let searches = 0;

    const send = async item => {
      const traceId = item.traced ? hex(16) : null;
      const headers = { 'User-Agent': `eki-observability-drill/${phase}/${item.label}` };
      if (authorization[item.auth]) headers.Authorization = authorization[item.auth];
      if (traceId) headers.traceparent = traceparent(traceId, hex(8), item.sampled);
      let path = item.path;
      let body;
      if (path.includes('<search-text>')) path = path.replace('<search-text>', encodeURIComponent(`${searchText} ${++searches}`));
      if (item.label === 'device-telemetry') {
        const now = Date.now();
        telemetrySequence++;
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify({ seq: telemetrySequence, lat: LATITUDE, lng: LONGITUDE, heading: 0, gpsHdop: 1,
          motionState: 'stopped', speed: 0, timestamp: now, deviceSentAt: now });
      }
      const started = Date.now();
      let status = 'error';
      try {
        const response = await fetch(`${BACKEND}${path}`, { method: item.method, headers, body, signal: AbortSignal.timeout(15_000), redirect: 'error' });
        status = canonicalStatus(response.status) ?? 'error';
        await response.arrayBuffer();
      } catch { /* recorded as error */ }
      lastRequestAt = Date.now();
      requests.push({ label: item.label, method: item.method, path: item.path, status, traceId, sampledParent: traceId ? item.sampled : null,
        durationMs: lastRequestAt - started });
    };

    for (const item of phasePlan(phase)) {
      if (item.provider) await control(`/providers/places/${item.provider}`, 'POST');
      // Batches of 10 keep the burst within what the emulators answer in time.
      for (let sent = 0; sent < item.count; sent += 10) {
        const batch = Array.from({ length: Math.min(10, item.count - sent) }, () => item);
        if (item.label === 'device-telemetry') for (const one of batch) await send(one);
        else await Promise.all(batch.map(send));
      }
      if (item.provider) await control('/providers/places/valid', 'POST');
    }
    // Wait for one periodic metric export after the last request (30 s
    // interval), so the evidence does not rest on the shutdown flush alone.
    const exportDeadline = Date.now() + 40_000;
    while (!receiver.payloads.some(payload => payload.signal === 'metrics' && payload.receivedAt > lastRequestAt) && Date.now() < exportDeadline) await sleep(250);
    entry.observations.periodicMetricExportAfterLastRequest = receiver.payloads.some(payload => payload.signal === 'metrics' && payload.receivedAt > lastRequestAt);
    const { body: state } = await control('/evidence');
    const executed = state?.providers?.externalNetworkExecuted;
    transport = { deniedConnections: canonicalCount(state?.transport?.deniedConnections),
      providerDeniedRequests: canonicalCount(state?.providers?.deniedRequests),
      externalNetworkExecuted: executed === false ? false : executed === true ? true : null };
  } finally {
    entry.backendExitCode = await backend.stop();
    await sleep(500);
    writeFileSync(resolve(workDirectory, `${phase}-backend.log`), redact(`${logs.stdout}\n--- stderr ---\n${logs.stderr}`, secrets));
  }
  const payloads = [...receiver.payloads];
  writeFileSync(resolve(workDirectory, `${phase}-otlp.json`),
    JSON.stringify(payloads.map(({ signal, receivedAt, body }) => ({ signal, receivedAt, body }))) + '\n');
  evaluatePhase(entry, { payloads, logs, canaries, transport, relayResults: relayState?.results ?? null });
}

// ---- evaluation --------------------------------------------------------------

function check(entry, id, description, pass, detail) {
  entry.checks.push({ id, description, pass: Boolean(pass), detail });
}

function evaluatePhase(entry, { payloads, logs, canaries, transport, relayResults }) {
  const { requests } = entry;
  const spans = flattenSpans(payloads);
  const metrics = flattenMetrics(payloads);
  const logRecords = flattenLogs(payloads);
  const appSpans = serverSpans(spans).filter(span => String(span.attributes['user_agent.original'] ?? '').startsWith('eki-observability-drill/'));
  const traced = requestTraces(requests, spans);
  const failed = requests.filter(request => typeof request.status === 'number' && request.status >= 500);
  const expected = statusCounts(requests);
  const counter = totalsBy(latestSeries(metrics, 'http.server.request.count', BACKEND_SCOPE), 'http.response.status_code');
  const histogram = totalsBy(latestSeries(metrics, 'http.server.request.duration', BACKEND_SCOPE), 'http.response.status_code');
  const httpHistogram = totalsBy(latestSeries(metrics, 'http.server.request.duration', HTTP_SCOPE), 'http.response.status_code');
  const stdout = structuredLines(logs.stdout);
  const requestTraceIds = new Set(requests.map(request => request.traceId).filter(Boolean));
  const correlatedStdout = logs.stdout.split(/\r?\n/).filter(line => { try { return requestTraceIds.has(JSON.parse(line).trace_id); } catch { return false; } }).length;
  const backendLogs = logRecords.filter(record => record.resource['service.name'] === SERVICE_NAME);
  const sources = [
    ...['traces', 'metrics', 'logs'].map(signal => ({ name: `otlp-${signal}`, text: payloads.filter(payload => payload.signal === signal).map(payload => payload.text).join('\n') })),
    { name: 'stdout', text: logs.stdout }, { name: 'stderr', text: logs.stderr },
  ];
  const leaks = scanCanaries(sources, canaries);
  const selfTest = scanCanaries([{ name: 'control', text: canaries.map(item => item.value).join('\n') }], canaries);
  const delivered = ['buses', 'buses-root', 'device-telemetry', 'place-search', 'place-search-quota', 'place-search-quota-root']
    .filter(label => requests.some(request => request.label === label))
    .map(label => ({ label, statuses: statusCounts(requests.filter(request => request.label === label)) }));
  const resourceKeys = [...new Set(spans.flatMap(span => Object.keys(span.resource)))].sort();

  entry.observations = {
    ...entry.observations,
    sent: requests.length, statuses: expected, payloads: Object.fromEntries(['traces', 'metrics', 'logs'].map(signal => [signal, payloads.filter(payload => payload.signal === signal).length])),
    spans: spans.length, serverSpans: appSpans.length, logRecords: backendLogs.length,
    metricTotalsByStatus: { [`${BACKEND_SCOPE}:http.server.request.count`]: counter, [`${BACKEND_SCOPE}:http.server.request.duration`]: histogram, [`${HTTP_SCOPE}:http.server.request.duration`]: httpHistogram },
    stdout: { lines: stdout.lines, json: stdout.json, withTraceId: stdout.withTraceId, correlatedToRequests: correlatedStdout, unstructured: stdout.unstructured.map(line => redact(line, secrets)) },
    stderrLines: logs.stderr.split(/\r?\n/).filter(line => line.trim()).length,
    resourceKeys, serviceNames: [...new Set(spans.map(span => span.resource['service.name']))],
    histograms: histogramBuckets(metrics), catalog: metricCatalogFromExport(metrics).map(({ scope, name, unit, type, monotonic, attributeKeys }) => ({ scope, name, unit, type, monotonic, attributeKeys })),
    collisions: familyCollisions(metricCatalogFromExport(metrics)), canaryDelivery: delivered, transport,
  };

  const coverage = traced.filter(item => item.sampledParent);
  check(entry, 'trace-per-request', 'Every request sent with a sampled traceparent has a server span with service.name=eki-backend and that trace ID',
    coverage.every(item => item.exported), `${coverage.filter(item => item.exported).length}/${coverage.length}`);
  const failedTraced = traced.filter(item => typeof item.status === 'number' && item.status >= 500 && item.sampledParent);
  if (failedTraced.length) {
    check(entry, 'error-span', 'Each sampled 5xx request has a server span with status ERROR and its response status code',
      failedTraced.every(item => item.spanStatus === STATUS_ERROR && item.responseStatusAttribute === item.status),
      failedTraced.map(item => `${item.label} ${item.status}: span status ${item.spanStatus}, exception events ${item.exceptionEvents}`).join('; '));
    entry.observations.exceptionEventsIn5xxTraces = failedTraced.reduce((sum, item) => sum + item.exceptionEvents, 0);
  }
  const errorLogs = failed.map(request => backendLogs.filter(record => record.severityNumber >= 13 && (!request.traceId || record.traceId === request.traceId)).length);
  if (failed.length) {
    const warnings = backendLogs.filter(record => record.severityNumber >= 13 && /^\[Places\]|^Place search failed/.test(String(record.body)));
    const stdoutTraceIds = new Set(logs.stdout.split(/\r?\n/).map(line => { try { return JSON.parse(line).trace_id; } catch { return null; } }).filter(Boolean));
    const failedWithTrace = failed.filter(request => request.traceId);
    check(entry, 'error-log', 'Each 5xx request has a WARN or higher OTLP log record and, when it had a trace ID, a stdout line with that trace_id',
      failed.every((request, index) => errorLogs[index] > 0) && warnings.length >= failed.length
        && failedWithTrace.every(request => stdoutTraceIds.has(request.traceId)),
      `${failed.length} 5xx requests; ${warnings.length} Places warning records, ${warnings.filter(record => record.traceId).length} with a trace ID; `
        + `${failedWithTrace.filter(request => stdoutTraceIds.has(request.traceId)).length}/${failedWithTrace.length} traced 5xx requests found in stdout`);
    entry.observations.errorLogTraceIds = warnings.map(record => record.traceId).filter(Boolean);
    entry.observations.errorLogDetail = warnings.slice(0, 2).map(record => ({ body: redact(String(record.body), secrets).slice(0, 120),
      detailsKeys: (() => { try { return Object.keys(JSON.parse(record.attributes['log.details'] ?? '[]')[0] ?? {}); } catch { return []; } })() }));
  }
  check(entry, 'metric-counts', 'http.server.request.count (eki-backend) totals by status equal the responses the drill received',
    sameCounts(expected, counter), `sent ${JSON.stringify(expected)}; counter ${JSON.stringify(counter)}`);
  check(entry, 'metric-histogram-counts', 'http.server.request.duration (eki-backend) counts by status equal the responses the drill received',
    sameCounts(expected, histogram), JSON.stringify(histogram));
  check(entry, 'periodic-metric-export', 'A periodic metric export arrived after the last request, before shutdown',
    entry.observations.periodicMetricExportAfterLastRequest, String(entry.observations.periodicMetricExportAfterLastRequest));
  check(entry, 'structured-stdout', 'Every backend stdout line is one JSON object with level, time and message, apart from the known start-up banner',
    stdout.lines > 0 && stdout.json + stdout.knownPlain === stdout.lines && stdout.knownPlain <= 1,
    `${stdout.json}/${stdout.lines} JSON; ${stdout.knownPlain} known start-up line; ${stdout.withTraceId} with trace_id`);
  check(entry, 'otlp-logs', 'The backend exported OTLP log records with service.name=eki-backend', backendLogs.length > 0, String(backendLogs.length));
  check(entry, 'canary-scanner', 'The scanner finds every planted canary in a control text', new Set(selfTest.map(item => item.kind.replace(/-part$/, ''))).size === canaries.length,
    `${new Set(selfTest.map(item => item.kind)).size} kinds found`);
  check(entry, 'canary-delivery', 'Canary requests reached the handlers (2xx for the canary account and device, 5xx from the Places handler)',
    delivered.every(item => Object.keys(item.statuses).every(status => /^(2\d\d|50[234])$/.test(status))), JSON.stringify(delivered));
  check(entry, 'redaction', 'No canary appears in any exported span, metric or log, or in backend stdout or stderr',
    leaks.length === 0, leaks.length ? leaks.map(item => `${item.kind} in ${item.source} (${item.count})`).join('; ') : 'none');
  check(entry, 'loopback-only', 'The backend made no non-loopback connection and no real provider call',
    transport?.deniedConnections === 0 && transport.providerDeniedRequests === 0 && transport.externalNetworkExecuted === false, JSON.stringify(transport));
  check(entry, 'backend-exit', 'The backend shut down cleanly after flushing telemetry', entry.backendExitCode === 0, String(entry.backendExitCode));

  if (entry.phase === 'default') {
    const parentIds = new Set(requests.filter(request => request.traceId).map(request => request.traceId));
    const roots = requests.filter(request => !request.traceId);
    const rootSpans = appSpans.filter(span => !parentIds.has(span.traceId));
    const band = samplingBand(roots.length, rootSpans.length, 0.1);
    entry.observations.sampling = band;
    check(entry, 'default-ratio', 'With the sampler unset, the share of exported root traces is consistent with 0.1 (99.9 % band)',
      band.withinBand, `${band.kept}/${band.sent} kept; band ${band.lower} to ${band.upper}`);
    const sampled = traced.filter(item => item.sampledParent === true);
    const unsampled = traced.filter(item => item.sampledParent === false);
    check(entry, 'parent-sampled', 'Requests with a sampled parent are always exported', sampled.every(item => item.exported), `${sampled.filter(item => item.exported).length}/${sampled.length}`);
    check(entry, 'parent-unsampled', 'Requests with an unsampled parent are never exported', unsampled.every(item => !item.exported), `${unsampled.filter(item => item.exported).length}/${unsampled.length}`);
    const failedRoots = roots.filter(request => typeof request.status === 'number' && request.status >= 500);
    const keptErrors = rootSpans.filter(span => Number(span.attributes['http.response.status_code']) >= 500);
    const exportedTraceIds = new Set(spans.map(span => span.traceId));
    const errorLogIds = entry.observations.errorLogTraceIds ?? [];
    entry.observations.errorTraces = { sent: failedRoots.length, kept: keptErrors.length,
      inMetrics: Object.entries(counter).filter(([status]) => Number(status) >= 500).reduce((sum, [, count]) => sum + count, 0),
      errorLogs: errorLogIds.length, errorLogsWhoseTraceWasExported: errorLogIds.filter(id => exportedTraceIds.has(id)).length };
    if (keptErrors.length < failedRoots.length) {
      report.findings.push({ id: 'ERROR_TRACES_DROPPED', detail: `With the default sampler, ${keptErrors.length} of ${failedRoots.length} root 5xx traces were exported. `
        + `Metrics counted ${entry.observations.errorTraces.inMetrics}; the Places handler logged ${errorLogIds.length}, and ${entry.observations.errorTraces.errorLogsWhoseTraceWasExported} of those log records name a trace that was exported` });
    }
  }
  if (entry.observations.exceptionEventsIn5xxTraces === 0) {
    report.findings.push({ id: 'NO_EXCEPTION_EVENT_ON_HANDLED_5XX', detail: `${failedTraced.length} sampled 5xx traces in the ${entry.phase} phase have status ERROR but no exception event; the handlers answer 5xx themselves and only the last-resort error handler records exceptions` });
  }
  const once = (id, detail) => { if (!report.findings.some(finding => finding.id === id && finding.detail === detail)) report.findings.push({ id, detail }); };
  for (const item of histogramBuckets(metrics).filter(bucket => bucket.secondsWithDefaultBuckets)) {
    once('SECONDS_HISTOGRAM_DEFAULT_BUCKETS', `${item.scope}:${item.name} is in seconds with the SDK default bounds ${item.bounds.join(', ')}`);
  }
  for (const collision of entry.observations.collisions) {
    once('PROMETHEUS_FAMILY_COLLISION', `${collision.instruments.join(' and ')} both become ${collision.family}`);
  }
  if (relayResults) {
    const forwarded = relayResults.filter(item => item.forwarded);
    entry.observations.relay = { payloads: relayResults.length, forwarded: forwarded.length,
      statuses: statusCounts(forwarded.map(item => ({ status: item.status }))), refused: relayResults.filter(item => !item.forwarded) };
    check(entry, 'relay', 'Every payload was forwarded to the confirmed collector and accepted with 2xx; none held a canary',
      relayResults.length > 0 && relayResults.every(item => item.forwarded && item.accepted), JSON.stringify(entry.observations.relay));
  }
}

/**
 * The dashboard against what the backend declares and what this run exported.
 * Instruments the run did not exercise (worker runs, durable operations) come
 * from the source catalog with unknown labels, so only their names are checked.
 */
function dashboardCheck(exportedInstruments) {
  const file = 'observability/grafana/eki-backend-dashboard.json';
  const dashboard = JSON.parse(readFileSync(resolve(repositoryRoot, file), 'utf8'));
  const selectors = dashboardSelectors(dashboard, file);
  const declared = metricCatalogFromSource(backendSources(repositoryRoot)).instruments;
  const exported = new Set(exportedInstruments.map(item => `${item.scope}|${item.name}`));
  const notExported = declared.filter(item => !exported.has(`${item.scope}|${item.name}`));
  return { selectors: selectors.length, exportedInstruments: exported.size, declaredButNotExported: notExported.map(item => item.name),
    problems: checkSelectors(selectors, [...exportedInstruments, ...notExported]) };
}

// ---- report ------------------------------------------------------------------

function markdown() {
  const lines = [`# Observability drill (${mode})`, '', `Source ${report.sourceCommit}; dirty: ${describeDirty(report)}; verdict: ${report.verdict}.`, '',
    `Target: ${report.target}. Receiver: ${report.receiver}. Node ${report.node}; OpenTelemetry SDK ${report.openTelemetry['@opentelemetry/sdk-node']}.`, ''];
  if (report.relay) lines.push(`Relay: ${report.relay.origin} (header names: ${report.relay.headerNames.join(', ') || 'none'}).`, '');
  if (report.setupError) lines.push(`Setup: ${report.setupError}`, '');
  for (const phase of report.phases) {
    const observations = phase.observations;
    lines.push(`## Phase ${phase.phase}`, '', `Sampler: ${phase.sampler}. Requests: ${observations.sent ?? phase.requests.length}; statuses ${JSON.stringify(observations.statuses ?? {})}; `
      + `payloads ${JSON.stringify(observations.payloads ?? {})}; server spans ${observations.serverSpans ?? '-'}; OTLP log records ${observations.logRecords ?? '-'}.`, '',
    '| Check | Result | Detail |', '|---|---|---|');
    for (const item of phase.checks) lines.push(`| ${item.id} | ${item.pass ? 'PASS' : 'FAIL'} | ${String(item.detail).replace(/\|/g, '/').slice(0, 300)} |`);
    if (observations.sampling) lines.push('', `Root traces kept: ${observations.sampling.kept}/${observations.sampling.sent} (expected ${observations.sampling.expected.toFixed(1)}, band ${observations.sampling.lower} to ${observations.sampling.upper}). `
      + `5xx root traces kept: ${observations.errorTraces.kept}/${observations.errorTraces.sent}; 5xx in metrics: ${observations.errorTraces.inMetrics}.`);
    lines.push('');
  }
  if (report.dashboard) {
    lines.push('## Dashboard selectors against exported metrics', '', `${report.dashboard.selectors} selectors; ${report.dashboard.exportedInstruments} exported instruments.`, '');
    for (const problem of report.dashboard.problems) lines.push(`- ${problem.where}: ${problem.problem}`);
    if (!report.dashboard.problems.length) lines.push('- No problems');
    lines.push('');
  }
  lines.push('## Findings', '');
  for (const finding of report.findings) lines.push(`- ${finding.id}: ${finding.detail}`);
  if (!report.findings.length) lines.push('- None');
  return redact(lines.join('\n') + '\n', secrets);
}

const receiverRelay = { results: [], canaries: [] };
let receiver;
try {
  removeGeneratedDemoConfig(process.env);
  safetyPreflight(process.env, { mode: 'emulator' });
  const hub = await getJson('http://127.0.0.1:4405/emulators');
  if (hub.status !== 200 || !Object.entries({ firestore: 8085, database: 9005, auth: 9095 })
    .every(([emulator, port]) => hub.body?.[emulator]?.host === '127.0.0.1' && hub.body[emulator].port === port)) {
    throw new Error('Verified emulator targets required');
  }
  let relay = null;
  if (mode === 'relay') {
    relay = assertRelayRun(process.env);
    secrets.push(...Object.values(relay.headers));
    report.relay = relaySummary(relay);
  }
  receiver = createOtlpReceiver({
    onPayload: relay ? async payload => { receiverRelay.results.push(await relayPayload(payload, { relay, canaries: receiverRelay.canaries, timeoutMs: 8_000 })); } : undefined,
  });
  await receiver.listen(receiverPort);
  const phases = mode === 'relay' ? ['always'] : ['always', 'default'];
  for (const phase of phases) await runPhase(phase, receiver, relay ? receiverRelay : null);
  const exported = report.phases.flatMap(phase => phase.observations.catalog ?? []);
  const unique = [...new Map(exported.map(item => [`${item.scope}|${item.name}`, item])).values()];
  report.dashboard = dashboardCheck(unique);
  if (receiver.rejected.length) report.receiverRejected = receiver.rejected;
  report.verdict = report.phases.every(phase => phase.checks.length && phase.checks.every(item => item.pass)) && !receiver.rejected.length ? 'PASS' : 'FAIL';
} catch (error) {
  report.setupError = redact(error.message, secrets).slice(0, 500);
} finally {
  await receiver?.close();
}
report.finishedAt = new Date().toISOString();
writeFileSync(`${reportBase}.json`, redact(JSON.stringify(report, null, 2), secrets) + '\n');
const summary = markdown();
writeFileSync(`${reportBase}.md`, summary);
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
if (report.verdict !== 'PASS') process.exitCode = 1;
