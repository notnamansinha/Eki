import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { resolve } from 'node:path';
import { repositoryRoot } from './acceptance-catalog.mjs';
import { safetyPreflight } from './safety-preflight.mjs';
import { removeGeneratedDemoConfig } from './emulator-environment.mjs';
import {
  DRILLS, DRILL_NAMES, K6_IMAGE, LIMITER_COOLDOWN_S, LOCAL_ACCOUNTS, PEAK_PROFILES, PORTS, PROBE_TIMEOUT_MS, PROFILE_ORDER, REQUESTS_PER_CONNECTION,
  STABLE_MS, TOXIPROXY_IMAGE, analyzeDrill, assertDeployedRun, campaignSeconds, canonicalId, canonicalStatus,
  detectProcessChanges, healthCounters, k6DockerArgs, k6Settings, leaseContinuity, parseK6Summary, parseLeaseDocument,
  parseResourceLog, probeOutcome, profileBounds, redactLog, renderMarkdown, resourceGrowth, selectNames, topology, verdictFor,
} from './load-plan.mjs';
import { plannedSeconds } from '../../qa/k6/profiles.mjs';

/**
 * k6 load profiles and Toxiproxy fault drills against one backend process
 * (issue #518, qa/LOAD_DRILLS.md).
 *
 *   node scripts/qa/run-load.mjs                      local run; started by `npm run qa:load`
 *                                                     inside the disposable emulators
 *   node scripts/qa/run-load.mjs --staging --dry-run  writes the deployed plans only
 *   node scripts/qa/run-load.mjs --staging            runs against the confirmed deployed origin
 */
const args = process.argv.slice(2);
const usage = [[], ['--staging'], ['--staging', '--dry-run']];
if (!usage.some(form => JSON.stringify(form) === JSON.stringify(args))) {
  throw new Error('Usage: node scripts/qa/run-load.mjs [--staging [--dry-run]]');
}
const mode = args[0] === '--staging' ? 'staging' : 'local';
const dryRun = args.includes('--dry-run');
// Locally every request this process makes must stay on literal loopback.
if (mode === 'local') await import('./network-guard.mjs');

const evidenceDirectory = resolve(repositoryRoot, 'artifacts/qa');
const workDirectory = resolve(evidenceDirectory, `load-${mode}`);
const reportBase = resolve(evidenceDirectory, `load-${mode}-report`);
rmSync(workDirectory, { recursive: true, force: true });
mkdirSync(workDirectory, { recursive: true });
// The k6 container runs as a non-root user and writes its summaries here.
try { chmodSync(workDirectory, 0o777); } catch { /* Windows ignores modes */ }

const git = gitArgs => execFileSync('git', gitArgs, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
const LOCAL_SCOPE = 'Bounded local run: one compiled backend process (backend/dist through e2e/emulator/backend.mjs) in front of '
  + 'disposable Auth, Firestore and RTDB emulators, with production limiters and synthetic accounts. Every k6 VU shares one source '
  + 'IP. This is not a capacity measurement and not a duration soak.';
const STAGING_SCOPE = 'Deployed run against one Cloud Run revision. Public probes and unauthenticated API requests from one runner IP; '
  + 'Toxiproxy runs on the runner, between the client and the API.';
const report = {
  schemaVersion: 1, mode, dryRun,
  sourceCommit: git(['rev-parse', 'HEAD']),
  dirty: Boolean(git(['status', '--porcelain', '--untracked-files=all'])),
  startedAt: new Date().toISOString(), finishedAt: null,
  workflowRunId: process.env.GITHUB_RUN_ID ?? null, node: process.version, platform: process.platform,
  dockerServer: null, k6Image: K6_IMAGE, k6Version: null, toxiproxyImage: TOXIPROXY_IMAGE, toxiproxyVersion: null,
  target: mode === 'local' ? `Compiled backend on 127.0.0.1:${PORTS.backend} with disposable emulators (demo-eki-qa)` : null,
  scope: mode === 'local' ? LOCAL_SCOPE : STAGING_SCOPE,
  plannedSeconds: null, settings: null, bounds: null, drillPlans: null,
  profiles: [], drills: [], resources: null, lease: null,
  process: { started: 0, unexpectedExits: mode === 'local' ? 0 : null, expectedChanges: 0, health: null },
  release: null, verdict: 'BLOCKED', setupError: null,
};
const secrets = [];
const cleanups = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));

// ---- Docker -------------------------------------------------------------------

function docker(argv, timeoutMs = 120_000) {
  const result = spawnSync('docker', argv, { cwd: repositoryRoot, encoding: 'utf8', timeout: timeoutMs });
  if (result.status !== 0) {
    throw new Error(`docker ${argv[0]} failed: ${redactLog(String(result.stderr || result.error?.message || '').trim(), secrets).slice(0, 300)}`);
  }
  return result.stdout.trim();
}

function dockerPreflight() {
  report.dockerServer = canonicalId(docker(['version', '--format', '{{.Server.Version}}']));
  for (const image of [K6_IMAGE, TOXIPROXY_IMAGE]) {
    if (spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status !== 0) {
      throw new Error(`Docker image missing; pull it first: docker pull ${image}`);
    }
  }
  report.k6Version = canonicalId(/k6 (v[0-9.]+)/.exec(docker(['run', '--rm', K6_IMAGE, 'version']))?.[1]);
  // Containers named eki-load-* belong to this harness; a killed run can leave Toxiproxy behind.
  const stale = docker(['ps', '-aq', '--filter', 'name=^eki-load-']).split(/\s+/).filter(Boolean);
  if (stale.length) docker(['rm', '-f', ...stale]);
}

/** Runs one command with its output in `logPath`; kills the container when the deadline passes. */
function runLogged(command, argv, logPath, timeoutMs, onTimeout) {
  const log = openSync(logPath, 'w');
  const child = spawn(command, argv, { cwd: repositoryRoot, stdio: ['ignore', log, log] });
  closeSync(log);
  return new Promise(done => {
    const deadline = setTimeout(() => { onTimeout(); child.kill(); }, timeoutMs);
    child.once('error', error => { clearTimeout(deadline); done({ code: null, error: error.code ?? 'spawn failed' }); });
    child.once('exit', code => {
      clearTimeout(deadline);
      writeFileSync(logPath, redactLog(readFileSync(logPath, 'utf8'), secrets));
      done({ code, error: null });
    });
  });
}

// ---- Toxiproxy ------------------------------------------------------------------

let layout = null;
async function toxiproxy(method, path, body) {
  const response = await fetch(`${layout.toxiproxyApi}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5_000), redirect: 'error',
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Toxiproxy ${method} ${path} answered ${canonicalStatus(response.status)}`);
  return text ? JSON.parse(text) : null;
}

async function startToxiproxy() {
  const name = `eki-load-toxiproxy-${process.pid}`;
  docker(['run', '-d', '--rm', '--name', name, ...layout.toxiproxyArgs]);
  cleanups.push(() => {
    // Toxiproxy logs each client and upstream connection: keep them with the evidence.
    const logs = spawnSync('docker', ['logs', '--timestamps', name], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    writeFileSync(resolve(workDirectory, 'toxiproxy.log'), redactLog(`${logs.stdout ?? ''}${logs.stderr ?? ''}`, secrets));
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  });
  const deadline = Date.now() + 30_000;
  for (;;) {
    try { report.toxiproxyVersion = canonicalId((await toxiproxy('GET', '/version'))?.version); break; } catch (error) {
      if (Date.now() > deadline) throw new Error(`Toxiproxy did not start: ${error.message}`);
      await sleep(500);
    }
  }
  for (const proxy of Object.values(layout.proxies)) {
    await toxiproxy('POST', '/proxies', { name: proxy.name, listen: proxy.listen, upstream: proxy.upstream, enabled: true });
  }
}

// ---- probes ---------------------------------------------------------------------------

const ERROR_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ECONNABORTED', 'TIMEOUT'];
/** One GET on the loop's keep-alive connection; `close` replaces the connection after this request. */
function probe(target, item, token, origin, agent, close) {
  return new Promise(done => {
    const at = Date.now() - origin;
    const started = performance.now();
    let finished = false;
    const finish = (status, retryAfter, error) => {
      if (finished) return;
      finished = true;
      const durationMs = Math.round((performance.now() - started) * 10) / 10;
      const clean = canonicalStatus(status ?? null);
      const authenticated = item.kind === 'api' && Boolean(token);
      const { outcome, good } = probeOutcome({ status: clean, retryAfter: Boolean(retryAfter), kind: item.kind, authenticated, durationMs });
      const code = error ? ERROR_CODES.find(candidate => candidate === error.code) ?? (error.message === 'timeout' ? 'TIMEOUT' : 'TRANSPORT') : null;
      done({ at, route: target.route, kind: item.kind, path: item.path, status: clean, error: code, durationMs, outcome, good });
    };
    const request = (target.tls ? https : http).request({
      host: target.host, port: target.port, path: item.path, method: 'GET', agent, timeout: PROBE_TIMEOUT_MS,
      ...(target.tls ? { servername: target.servername } : {}),
      headers: { 'User-Agent': 'eki-qa-load/1', Connection: close ? 'close' : 'keep-alive', ...(target.servername ? { Host: target.servername } : {}),
        ...(item.kind === 'api' && token ? { Authorization: `Bearer ${token}` } : {}) },
    }, response => {
      response.resume();
      response.once('end', () => finish(response.statusCode, response.headers['retry-after']));
      response.once('error', error => finish(null, null, error));
    });
    request.once('timeout', () => request.destroy(new Error('timeout')));
    request.once('error', error => finish(null, null, error));
    request.end();
  });
}

async function runDrill(name, settings, tokens) {
  const plan = DRILLS[name];
  const entry = { drill: name, fault: plan.outage ? `${plan.proxy} proxy disabled (outage)` : `${plan.toxic.type} ${JSON.stringify(plan.toxic.attributes)}, toxicity ${plan.toxic.toxicity}`,
    proxy: plan.proxy, baselineS: plan.baselineS, faultS: plan.faultS, recoveryWindowS: plan.recoveryS,
    startedAt: new Date().toISOString(), analysis: null, observedS: null };
  report.drills.push(entry);
  // The backend itself, without the proxy: the dependency drill's client, and a
  // control for the client-side drills that shows whether the backend stayed healthy.
  const direct = layout.direct;
  const target = plan.proxy === 'firestore' ? { ...direct, route: 'client' } : { ...layout.probe, route: 'client' };
  const items = [...settings.paths.map(path => ({ kind: 'public', path })), ...settings.apiPaths.map(path => ({ kind: 'api', path }))];
  const samples = [];
  const origin = Date.now();
  let stop = false;
  // Three loops of about four requests a second each keep every synthetic
  // account under its 200 reads a minute and the run under 1,000 a minute per IP.
  const agents = [0, 1, 2].map(() => new (target.tls ? https : http).Agent({ keepAlive: true, maxSockets: 1 }));
  const loops = agents.map(async (agent, loop) => {
    for (let turn = 0; !stop; turn++) {
      samples.push(await probe(target, items[(turn + loop) % items.length], tokens[loop % Math.max(tokens.length, 1)] ?? null, origin,
        agent, turn % REQUESTS_PER_CONNECTION === REQUESTS_PER_CONNECTION - 1));
      await sleep(250);
    }
  });
  if (plan.proxy !== 'firestore') {
    const agent = new (direct.tls ? https : http).Agent({ keepAlive: true, maxSockets: 1 });
    agents.push(agent);
    loops.push((async () => {
      while (!stop) {
        samples.push(await probe({ ...direct, route: 'direct' }, { kind: 'public', path: '/health' }, null, origin, agent, false));
        await sleep(500);
      }
    })());
  }
  try {
    await sleep(plan.baselineS * 1000);
    const faultStartMs = Date.now() - origin;
    if (plan.outage) await toxiproxy('POST', `/proxies/${plan.proxy}`, { enabled: false });
    else await toxiproxy('POST', `/proxies/${plan.proxy}/toxics`, plan.toxic);
    await sleep(plan.faultS * 1000);
    if (plan.outage) await toxiproxy('POST', `/proxies/${plan.proxy}`, { enabled: true });
    else await toxiproxy('DELETE', `/proxies/${plan.proxy}/toxics/${plan.toxic.name}`);
    const faultEndMs = Date.now() - origin;
    const deadline = Date.now() + plan.recoveryS * 1000;
    while (Date.now() < deadline) {
      await sleep(1_000);
      // An outage drill ends once /health and every probe have recovered and held.
      if (plan.outage && Date.now() - origin - faultEndMs > STABLE_MS) {
        const interim = analyzeDrill(samples, { faultStartMs, faultEndMs, endMs: Date.now() - origin });
        if (interim.recovered && interim.faultObserved && interim.health.recovered) break;
      }
    }
    stop = true;
    const endMs = Date.now() - origin;
    await Promise.all(loops);
    entry.observedS = Math.round(endMs / 1000);
    entry.timeline = { faultStartMs, faultEndMs, endMs };
    entry.analysis = analyzeDrill(samples, entry.timeline);
  } finally {
    stop = true;
    await Promise.allSettled(loops);
    for (const agent of agents) agent.destroy();
    writeFileSync(resolve(workDirectory, `drill-${name}-samples.json`), JSON.stringify(samples) + '\n');
  }
}

// ---- k6 profiles ----------------------------------------------------------------------

async function runProfile(profile, values, settings, tokensFile) {
  const name = `eki-load-k6-${process.pid}-${profile}`;
  const entry = { profile, peakVus: null, plannedSeconds: plannedSeconds(profile, settings), startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, summary: null };
  entry.peakVus = report.bounds.find(bound => bound.profile === profile)?.peakVus ?? null;
  report.profiles.push(entry);
  const argv = k6DockerArgs({ name, topology: layout, scriptsDir: resolve(repositoryRoot, 'qa/k6'), workDir: workDirectory, profile, values, tokensFile });
  const result = await runLogged('docker', argv, resolve(workDirectory, `k6-${profile}.log`), (entry.plannedSeconds + 120) * 1000,
    () => spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' }));
  entry.finishedAt = new Date().toISOString();
  // k6 exits 99 when a threshold fails; the summary is still complete.
  entry.exitCode = result.code;
  const summaryPath = resolve(workDirectory, `${profile}-summary.json`);
  if (existsSync(summaryPath)) entry.summary = parseK6Summary(JSON.parse(readFileSync(summaryPath, 'utf8')));
  console.log(`${profile}: exit ${result.code}; ${entry.summary ? `p95 ${entry.summary.latencyMs.p95} ms, thresholds ${entry.summary.thresholdsPassed ? 'passed' : 'FAILED'}` : 'no summary'}`);
  if (PEAK_PROFILES.includes(profile)) await sleep(LIMITER_COOLDOWN_S * 1000);
}

// ---- local stack -------------------------------------------------------------------------

async function getJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  return { status: canonicalStatus(response.status), body: await response.json().catch(() => null) };
}

async function authEmulator(method, email) {
  return getJson(`http://127.0.0.1:${PORTS.auth}/identitytoolkit.googleapis.com/v1/accounts:${method}?key=synthetic-only`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'SyntheticOnly123!', returnSecureToken: true }),
  });
}

/** ID tokens for synthetic emulator accounts; created on first use. */
async function syntheticTokens(count) {
  const tokens = [];
  for (let index = 1; index <= count; index++) {
    const email = `load-${String(index).padStart(2, '0')}@example.invalid`;
    let result = await authEmulator('signUp', email);
    if (result.status !== 200) result = await authEmulator('signInWithPassword', email);
    if (result.status !== 200 || typeof result.body?.idToken !== 'string') throw new Error(`Synthetic account ${index} could not sign in`);
    tokens.push(result.body.idToken);
  }
  secrets.push(...tokens);
  return tokens;
}

async function adminToken() {
  const { status, body } = await authEmulator('signInWithPassword', 'qa_admin@example.invalid');
  if (status !== 200 || typeof body?.idToken !== 'string') throw new Error('The fixture administrator could not sign in');
  secrets.push(body.idToken);
  return body.idToken;
}

async function readLease() {
  const { status, body } = await getJson(`http://127.0.0.1:${PORTS.firestore}/v1/projects/demo-eki-qa/databases/(default)/documents/_worker_leases/trip-state-worker`,
    { headers: { Authorization: 'Bearer owner' } });
  return status === 200 ? parseLeaseDocument(body) : null;
}

const backends = [];
async function startBackend(label, extraEnv = {}) {
  const resourceLog = resolve(workDirectory, `backend-${label}-resources.jsonl`);
  const log = openSync(resolve(workDirectory, `backend-${label}.log`), 'w');
  const child = spawn(process.execPath, ['--import', './scripts/qa/network-guard.mjs', 'scripts/qa/load-backend.mjs'], {
    cwd: repositoryRoot, stdio: ['ignore', log, log, 'ipc'],
    env: { ...process.env, PORT: String(PORTS.backend), NODE_ENV: 'development', CORS_ORIGIN: 'http://127.0.0.1:3115',
      EKI_QA_LOAD: '1', EKI_LOAD_RESOURCE_LOG: resourceLog, ...extraEnv },
  });
  closeSync(log);
  const backend = { label, child, resourceLog, stopping: false };
  backend.exit = new Promise(done => child.once('exit', code => {
    if (!backend.stopping) report.process.unexpectedExits += 1;
    done(code);
  }));
  backends.push(backend);
  report.process.started += 1;
  const deadline = Date.now() + 90_000;
  for (;;) {
    try { if ((await getJson(`http://127.0.0.1:${PORTS.control}/evidence`)).body?.fixtureProcessId === child.pid) break; } catch { /* starting */ }
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(`The ${label} backend did not start; see artifacts/qa/load-local/backend-${label}.log`);
    await sleep(500);
  }
  // Ready means /health is 200 and this process holds the worker lease.
  for (;;) {
    const [health, lease] = await Promise.all([getJson(`http://127.0.0.1:${PORTS.backend}/health`).catch(() => ({})), readLease().catch(() => null)]);
    if (health.status === 200 && lease?.ownerId && lease.expiresAtMs > Date.now()) break;
    if (Date.now() > deadline) throw new Error(`The ${label} backend did not become healthy or take the worker lease`);
    await sleep(1_000);
  }
  return backend;
}

async function stopBackend(backend) {
  backend.stopping = true;
  if (backend.child.exitCode !== null) return backend.child.exitCode;
  // Windows ends a child on SIGTERM without running Node handlers; ask the fixture to drain.
  if (backend.child.connected) backend.child.send({ type: 'eki-qa-shutdown', pid: backend.child.pid }, error => { if (error) backend.child.kill('SIGTERM'); });
  else backend.child.kill('SIGTERM');
  const backstop = setTimeout(() => backend.child.kill('SIGKILL'), 15_000);
  const code = await backend.exit;
  clearTimeout(backstop);
  return code;
}

/** Samples /api/health (and the lease locally) until stopped. */
function startSampler(origin, getToken, intervalMs) {
  const healthReads = [];
  const leaseSamples = [];
  let stopped = false;
  const done = (async () => {
    while (!stopped) {
      const at = Date.now();
      const token = getToken();
      const [health, lease] = await Promise.all([
        token ? getJson(`${origin}/api/health`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null) : null,
        mode === 'local' ? readLease().catch(() => null) : null,
      ]);
      if (health?.body && [200, 503].includes(health.status)) healthReads.push({ at, httpStatus: health.status, ...healthCounters(health.body) });
      if (mode === 'local') leaseSamples.push({ at, lease });
      for (let waited = 0; waited < intervalMs && !stopped; waited += 500) await sleep(500);
    }
  })();
  return { healthReads, leaseSamples, stop: async () => { stopped = true; await done; } };
}

async function runLocal() {
  removeGeneratedDemoConfig(process.env);
  safetyPreflight(process.env, { mode: 'emulator' });
  const hub = await getJson('http://127.0.0.1:4405/emulators');
  if (hub.status !== 200 || !Object.entries({ firestore: PORTS.firestore, database: 9005, auth: PORTS.auth })
    .every(([name, port]) => hub.body?.[name]?.host === '127.0.0.1' && hub.body[name].port === port)) {
    throw new Error('Verified emulator targets required');
  }
  const profiles = selectNames(process.env.EKI_LOAD_PROFILES, PROFILE_ORDER, 'EKI_LOAD_PROFILES');
  const drills = selectNames(process.env.EKI_LOAD_DRILLS, DRILL_NAMES, 'EKI_LOAD_DRILLS');
  const { values, settings } = k6Settings('local', process.env);
  Object.assign(report, { settings: values, bounds: profileBounds(profiles, settings), plannedSeconds: campaignSeconds(profiles, drills, settings),
    drillPlans: Object.fromEntries(drills.map(name => [name, DRILLS[name]])) });
  dockerPreflight();
  layout = topology({ platform: process.platform });
  const tokens = await syntheticTokens(LOCAL_ACCOUNTS);
  const tokensFile = 'tokens.json';
  writeFileSync(resolve(workDirectory, tokensFile), JSON.stringify(tokens));
  cleanups.push(() => rmSync(resolve(workDirectory, tokensFile), { force: true }));
  await startToxiproxy();

  const first = await startBackend('main');
  let admin = await adminToken();
  const sampler = startSampler(`http://127.0.0.1:${PORTS.backend}`, () => admin, 15_000);
  const windows = {};
  try {
    for (const profile of profiles) {
      const from = Date.now();
      await runProfile(profile, values, settings, tokensFile);
      windows[profile] = { from, to: Date.now() };
      if (first.child.exitCode !== null) throw new Error(`The backend exited during the ${profile} profile`);
    }
    for (const drill of drills.filter(name => DRILLS[name].proxy === 'api')) await runDrill(drill, settings, tokens);
    if (first.child.exitCode !== null) throw new Error('The backend exited during the client-side drills');
    const mainWindow = { from: Date.now() };
    await stopBackend(first);
    if (drills.includes('dependency')) {
      // A planned restart: the dependency drill needs Firestore behind the proxy from process start.
      report.process.expectedChanges += 1;
      const second = await startBackend('dependency', { EKI_LOAD_FIRESTORE_PROXY: `127.0.0.1:${PORTS.firestoreProxy}` });
      admin = await adminToken();
      const from = Date.now();
      await runDrill('dependency', settings, tokens);
      windows.dependency = { from, to: Date.now() };
      await stopBackend(second);
    }
    windows.main = mainWindow;
  } finally {
    await sampler.stop();
    const inWindow = window => sampler.leaseSamples.filter(sample => window && sample.at >= window.from && sample.at <= window.to);
    report.lease = {
      soak: windows.soak ? leaseContinuity(inWindow(windows.soak)) : null,
      mainProcess: leaseContinuity(sampler.leaseSamples.filter(sample => sample.at <= (windows.main?.from ?? Date.now()))),
      dependencyDrill: windows.dependency ? leaseContinuity(inWindow(windows.dependency)) : null,
    };
    report.process.health = detectProcessChanges(sampler.healthReads);
    if (windows.soak) report.resources = resourceGrowth(parseResourceLog(readFileSync(first.resourceLog, 'utf8')), windows.soak.from, windows.soak.to);
  }
}

// ---- deployed target ------------------------------------------------------------------

async function readRelease(origin, token) {
  const deadline = Date.now() + 90_000;
  for (;;) {
    const { status, body } = await getJson(`${origin}/api/health`, { headers: { Authorization: `Bearer ${token}` } });
    if ([200, 503].includes(status) && body?.release) {
      const { revision, sourceSha } = healthCounters(body);
      return { revision, sourceSha, service: canonicalId(body.release.service), status };
    }
    // A cold instance answers 503 without a body until its first probes succeed.
    if (![502, 503, 504].includes(status) || Date.now() > deadline) throw new Error(`Admin health read failed with HTTP ${status}`);
    await sleep(5_000);
  }
}

async function runStaging() {
  const run = assertDeployedRun(process.env, { dirty: report.dirty, dryRun });
  secrets.push(run.token);
  layout = topology({ platform: process.platform, deployed: { origin: run.origin, host: run.host } });
  Object.assign(report, { target: run.origin, settings: run.values, bounds: profileBounds(run.profiles, run.settings), plannedSeconds: run.plannedSeconds,
    drillPlans: Object.fromEntries(run.drills.map(name => [name, DRILLS[name]])), release: { expectedRevision: run.revision, before: null, after: null } });
  // The exact commands a run would issue; tokens are never part of them.
  writeFileSync(resolve(workDirectory, 'plan.json'), JSON.stringify({
    target: run.origin, expectedRevision: run.revision, profiles: run.profiles, drills: run.drills, plannedSeconds: run.plannedSeconds,
    k6: Object.fromEntries(run.profiles.map(profile => [profile, ['docker', ...k6DockerArgs({ name: `eki-load-k6-<pid>-${profile}`, topology: layout,
      scriptsDir: '<repository>/qa/k6', workDir: '<repository>/artifacts/qa/load-staging', profile, values: run.values })]])),
    toxiproxy: { docker: ['docker', 'run', '-d', '--rm', '--name', 'eki-load-toxiproxy-<pid>', ...layout.toxiproxyArgs], proxies: layout.proxies },
    drills: Object.fromEntries(run.drills.map(name => [name, DRILLS[name]])),
  }, null, 2) + '\n');
  if (dryRun) return;
  dockerPreflight();
  report.release.before = await readRelease(run.origin, run.token);
  if (report.release.before.revision !== run.revision) throw new Error(`The target serves ${report.release.before.revision}, not ${run.revision}`);
  const sampler = startSampler(run.origin, () => run.token, 30_000);
  try {
    for (const profile of run.profiles) await runProfile(profile, run.values, run.settings, null);
    if (run.drills.length) {
      await startToxiproxy();
      for (const drill of run.drills) await runDrill(drill, run.settings, []);
    }
  } finally {
    await sampler.stop();
    report.process.health = detectProcessChanges(sampler.healthReads);
  }
  report.release.after = await readRelease(run.origin, run.token);
}

// ---- evidence -------------------------------------------------------------------------

process.once('SIGINT', () => { for (const cleanup of cleanups.reverse()) cleanup(); process.exit(130); });
try {
  if (mode === 'local') await runLocal();
  else await runStaging();
} catch (error) {
  report.setupError = redactLog(error.message, secrets).slice(0, 500);
} finally {
  for (const backend of backends) if (backend.child.exitCode === null) await stopBackend(backend).catch(() => {});
  for (const cleanup of cleanups.reverse()) { try { await cleanup(); } catch { /* best effort */ } }
}
report.verdict = verdictFor(report);
report.finishedAt = new Date().toISOString();
writeFileSync(`${reportBase}.json`, JSON.stringify(report, null, 2) + '\n');
const summary = renderMarkdown(report);
writeFileSync(`${reportBase}.md`, summary);
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
if (!['WITHIN_THRESHOLDS', 'DRY_RUN'].includes(report.verdict)) process.exitCode = 1;
