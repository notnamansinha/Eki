import { Buffer } from 'node:buffer';
import {
  DEFAULTS, LIMITS, PEAK_PROFILES, PROFILE_NAMES, classify, peakVus, plannedSeconds, readSettings, thresholdsFor,
} from '../../qa/k6/profiles.mjs';
import { percentileSummary } from '../percentile-summary.mjs';
import { describeDirty } from './working-tree.mjs';

/**
 * Plans and evidence for the load profiles and fault drills (issue #518,
 * qa/LOAD_DRILLS.md). Everything here is a pure function of its inputs: the
 * profile settings, Docker topology, deployed-run preconditions, and the
 * parsing, analysis and sanitizing of what a run observed.
 * scripts/qa/run-load.mjs owns every process, container and request.
 */

// Pinned by digest. k6 2.4.0 (published 2026-11-12) and Toxiproxy 2.13.0 (2026-10-14).
export const K6_IMAGE = 'grafana/k6:2.4.0@sha256:d41bb79cd8de5a7ad619b53570e3712633e8bff0937010a5c6c57a4747e7a276';
export const TOXIPROXY_IMAGE = 'ghcr.io/shopify/toxiproxy:2.13.0@sha256:5d3dae09bc185dcc5ff6cf43abf6062a4a720aff0c4306a471e773acdcd107aa';

// Emulator and fixture ports are fixed by scripts/run-rules-emulator.mjs and
// e2e/emulator/backend.mjs. Every port this harness opens is in 18000 to 18999
// and bound to loopback.
export const PORTS = Object.freeze({
  backend: 3116, control: 3117, firestore: 8085, auth: 9095,
  toxiproxyApi: 18474, apiProxy: 18666, firestoreProxy: 18685,
});

// Run order: the profiles that stay under the per-IP and per-user budgets first,
// so that stress and spike rejections cannot spill into them.
export const PROFILE_ORDER = Object.freeze(['smoke', 'load', 'soak', 'stress', 'spike']);

// The Firebase project that dedicated test accounts and deployed test targets use.
export const STAGING_PROJECT_ID = 'bustrack-be165';
// Synthetic emulator accounts the local run signs up; VU n uses account n modulo this.
export const LOCAL_ACCOUNTS = 20;
// Seconds between profiles that exceed the per-IP budget and the next step, so
// the 60 s limiter windows start empty.
export const LIMITER_COOLDOWN_S = 65;

/** k6 settings per mode. Local reads go to fixture records with synthetic tokens. */
export const MODE_SETTINGS = Object.freeze({
  local: Object.freeze({ ...DEFAULTS, API_PATHS: '/api/routes-list,/api/buses,/api/routes/qa_route/geometry' }),
  // A deployed run sends unauthenticated API requests (401) so that no test
  // account's 200 reads a minute bound the run. Durations fit one ID token.
  staging: Object.freeze({ ...DEFAULTS, DURATION: '5m', STEP: '1m', SPIKE_HOLD: '1m', SOAK_DURATION: '20m' }),
});

/**
 * Toxics run between the client and the API, or between the API and the
 * Firestore emulator. Each drill observes a baseline, the fault and a recovery
 * window. The dependency drill needs the local fixture, so it is local only.
 */
export const DRILLS = Object.freeze({
  latency: Object.freeze({ proxy: 'api', baselineS: 15, faultS: 30, recoveryS: 30,
    toxic: { name: 'latency', type: 'latency', stream: 'downstream', toxicity: 1, attributes: { latency: 800, jitter: 0 } } }),
  partition: Object.freeze({ proxy: 'api', baselineS: 15, faultS: 30, recoveryS: 30,
    toxic: { name: 'partition', type: 'timeout', stream: 'upstream', toxicity: 0.3, attributes: { timeout: 3000 } } }),
  dependency: Object.freeze({ proxy: 'firestore', baselineS: 20, faultS: 45, recoveryS: 180, outage: true, localOnly: true }),
});
export const DRILL_NAMES = Object.freeze(Object.keys(DRILLS));
// A probe is good when its status is expected and it finishes within this budget.
export const PROBE_BUDGET_MS = LIMITS.p95Ms;
export const PROBE_TIMEOUT_MS = 5_000;
// Each prober loop keeps one keep-alive connection and replaces it after this
// many requests (about 2.5 s), so a toxic with a toxicity below 1, which
// Toxiproxy draws per connection, reaches about 36 connections during a 30 s
// fault, while few connections are opened. On Docker Desktop about 2 % of new
// connections from a container to host.docker.internal failed in a 60 s check
// on 2026-11-24; keep-alive keeps most of that noise out of the drills.
export const REQUESTS_PER_CONNECTION = 10;
// Recovery is judged in windows of WINDOW_MS from the removal of the fault. A
// window is clean when its share of bad probes is at most the baseline's share,
// or MIN_TOLERANCE if that is larger, so that one dropped connection does not
// hide a recovery. The client recovered when STABLE_MS of consecutive clean
// windows follow the removal.
export const WINDOW_MS = 5_000;
export const MIN_TOLERANCE = 0.02;
export const STABLE_MS = 15_000;

/** A comma-separated selection from `allowed`, in the order of `allowed`. */
export function selectNames(raw, allowed, name) {
  if (raw === undefined || raw.trim() === '') return [...allowed];
  const names = raw.split(',').map(item => item.trim()).filter(Boolean);
  for (const item of names) if (!allowed.includes(item)) throw new Error(`${name}: unknown entry ${item}`);
  return allowed.filter(item => names.includes(item));
}

/** k6 settings for a mode, with `EKI_LOAD_K6_<NAME>` overrides, validated. */
export function k6Settings(mode, env = {}) {
  const base = MODE_SETTINGS[mode];
  if (!base) throw new Error(`Unknown load mode: ${mode}`);
  const values = { ...base };
  for (const key of Object.keys(DEFAULTS)) {
    const override = env[`EKI_LOAD_K6_${key}`];
    if (override !== undefined && override !== '') values[key] = override;
  }
  const settings = readSettings(values);
  if (mode === 'staging') {
    if (!settings.paths.every(path => ['/health', '/live'].includes(path))) throw new Error('A deployed run probes only /health and /live as public paths');
    if (!settings.apiPaths.every(path => path.startsWith('/api/'))) throw new Error('A deployed run sends API requests only under /api/');
  }
  return { values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])), settings };
}

/** The planned traffic of a campaign, in seconds, including limiter cool-downs. */
export function campaignSeconds(profiles, drills, settings) {
  const traffic = profiles.reduce((sum, profile) => sum + plannedSeconds(profile, settings), 0);
  const cooldowns = profiles.filter(profile => PEAK_PROFILES.includes(profile)).length * LIMITER_COOLDOWN_S;
  const faults = drills.reduce((sum, drill) => sum + DRILLS[drill].baselineS + DRILLS[drill].faultS + DRILLS[drill].recoveryS, 0);
  return traffic + cooldowns + faults;
}

/** Bounds of each selected profile, for the report. */
export function profileBounds(profiles, settings) {
  return profiles.map(profile => ({
    profile, peakVus: peakVus(profile, settings), plannedSeconds: plannedSeconds(profile, settings),
    thresholds: thresholdsFor(profile),
  }));
}

/**
 * Where k6 and Toxiproxy run. Docker Desktop (Windows, macOS) reaches the
 * host's loopback through host.docker.internal and publishes container ports
 * on 127.0.0.1; Linux Docker Engine shares the host network instead. The
 * runner and the backend always reach Toxiproxy on 127.0.0.1.
 */
export function topology({ platform, deployed = null }) {
  const linux = platform === 'linux';
  const host = linux ? '127.0.0.1' : 'host.docker.internal';
  const listen = port => `${linux ? '127.0.0.1' : '0.0.0.0'}:${port}`;
  const proxies = {
    api: { name: 'api', port: PORTS.apiProxy, listen: listen(PORTS.apiProxy),
      upstream: deployed ? `${deployed.host}:443` : `${host}:${PORTS.backend}` },
  };
  if (!deployed) {
    proxies.firestore = { name: 'firestore', port: PORTS.firestoreProxy, listen: listen(PORTS.firestoreProxy), upstream: `${host}:${PORTS.firestore}` };
  }
  const publish = port => ['-p', `127.0.0.1:${port}:${port}`];
  const toxiproxyArgs = linux
    ? ['--network', 'host', TOXIPROXY_IMAGE, '-host=127.0.0.1', `-port=${PORTS.toxiproxyApi}`]
    : ['-p', `127.0.0.1:${PORTS.toxiproxyApi}:8474`, ...Object.values(proxies).flatMap(proxy => publish(proxy.port)), TOXIPROXY_IMAGE, '-host=0.0.0.0'];
  return {
    k6BaseUrl: deployed ? deployed.origin : `http://${host}:${PORTS.backend}`,
    k6Network: linux && !deployed ? ['--network', 'host'] : [],
    proxies,
    toxiproxyArgs,
    toxiproxyApi: `http://127.0.0.1:${PORTS.toxiproxyApi}`,
    // The prober sends plain HTTP locally and TLS with the target's name when deployed.
    probe: { host: '127.0.0.1', port: PORTS.apiProxy, tls: Boolean(deployed), servername: deployed?.host ?? null },
    // The same target without the proxy.
    direct: deployed ? { host: deployed.host, port: 443, tls: true, servername: deployed.host }
      : { host: '127.0.0.1', port: PORTS.backend, tls: false, servername: null },
  };
}

/** `docker` arguments that run one k6 profile. Values here are not secret; tokens travel in a file. */
export function k6DockerArgs({ name, topology: layout, scriptsDir, workDir, profile, values, tokensFile = null }) {
  if (!PROFILE_NAMES.includes(profile)) throw new Error(`Unknown load profile: ${profile}`);
  const env = { ...values, BASE_URL: layout.k6BaseUrl, SUMMARY_PATH: `/work/${profile}-summary.json`, ...(tokensFile ? { TOKENS_FILE: `/work/${tokensFile}` } : {}) };
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Z_]+$/.test(key) || /[\s"']/.test(value)) throw new Error(`Unsafe k6 variable ${key}`);
  }
  return ['run', '--rm', '--name', name, ...layout.k6Network, '-e', 'K6_NO_USAGE_REPORT=true',
    '-v', `${scriptsDir}:/scripts:ro`, '-v', `${workDir}:/work:rw`, K6_IMAGE,
    'run', '--no-usage-report', '--quiet', ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]), `/scripts/${profile}.js`];
}

// ---- deployed-run preconditions ------------------------------------------------

const LOOPBACK_OR_PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[|host\.docker\.internal$)/i;
const DEPLOYED_HOST = /^(eki-backend-[a-z0-9-]+?)-(\d{6,14})\.([a-z0-9-]+)\.run\.app$/;

export function decodeJwtClaims(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('Not a JWT');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw new Error('Not a JWT');
  return claims;
}

/**
 * Preconditions for a deployed run. The caller names the target origin twice
 * (EKI_LOAD_TARGET and EKI_LOAD_CONFIRM_TARGET), the Cloud Run revision it
 * expects to serve, and an administrator ID token for the release checks.
 */
export function assertDeployedRun(env, { now = Date.now(), dirty = false, dryRun = false } = {}) {
  const raw = env.EKI_LOAD_TARGET ?? '';
  let url;
  try { url = new URL(raw); } catch { throw new Error('EKI_LOAD_TARGET must be the deployed API origin, for example https://eki-backend-staging-<project-number>.<region>.run.app'); }
  if (url.origin !== raw || url.protocol !== 'https:') throw new Error('EKI_LOAD_TARGET must be an https origin with no path, query, port or trailing slash');
  if (LOOPBACK_OR_PRIVATE.test(url.hostname)) throw new Error('EKI_LOAD_TARGET is a loopback or private host; use `npm run qa:load` for the local stack');
  const match = DEPLOYED_HOST.exec(url.hostname);
  if (!match) throw new Error('EKI_LOAD_TARGET must be an eki-backend-* Cloud Run service URL, not Hosting or another host');
  const service = match[1];
  if (/prod/.test(service)) throw new Error(`EKI_LOAD_TARGET names ${service}: production services are never a load target`);
  if (env.EKI_LOAD_CONFIRM_TARGET !== raw) throw new Error('EKI_LOAD_CONFIRM_TARGET must repeat EKI_LOAD_TARGET exactly');
  const revision = env.EKI_LOAD_EXPECTED_REVISION?.trim() ?? '';
  if (!new RegExp(`^${service}-\\d{5}-[a-z0-9]{3}$`).test(revision)) {
    throw new Error(`EKI_LOAD_EXPECTED_REVISION must name a revision of ${service}, such as ${service}-00012-abc`);
  }
  const drills = selectNames(env.EKI_LOAD_DRILLS, DRILL_NAMES.filter(name => !DRILLS[name].localOnly), 'EKI_LOAD_DRILLS');
  const profiles = selectNames(env.EKI_LOAD_PROFILES, PROFILE_ORDER, 'EKI_LOAD_PROFILES');
  const { values, settings } = k6Settings('staging', env);
  const seconds = campaignSeconds(profiles, drills, settings);
  const token = env.EKI_LOAD_ADMIN_ID_TOKEN?.trim() ?? '';
  if (!token) throw new Error('EKI_LOAD_ADMIN_ID_TOKEN: required for the release checks');
  let claims;
  try { claims = decodeJwtClaims(token); } catch { throw new Error('EKI_LOAD_ADMIN_ID_TOKEN: not a Firebase ID token'); }
  if (claims.aud !== STAGING_PROJECT_ID || claims.iss !== `https://securetoken.google.com/${STAGING_PROJECT_ID}`) {
    throw new Error(`EKI_LOAD_ADMIN_ID_TOKEN: not issued for ${STAGING_PROJECT_ID}`);
  }
  if (claims.admin !== true || claims.role !== 'admin') throw new Error('EKI_LOAD_ADMIN_ID_TOKEN: the account has no administrator claims');
  const neededMs = (seconds + 600) * 1000;
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 - now < neededMs) {
    throw new Error(`EKI_LOAD_ADMIN_ID_TOKEN: the campaign needs ${Math.ceil(neededMs / 60_000)} min of token life; select fewer profiles or sign in again`);
  }
  if (dirty && !dryRun) throw new Error('A deployed run needs a clean checkout so the evidence names the harness commit');
  return { origin: raw, host: url.hostname, service, revision, token, profiles, drills, values, settings, plannedSeconds: seconds };
}

// ---- evidence: k6 summaries --------------------------------------------------

const number = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const rounded = (value, digits = 2) => (value === null ? null : Number(value.toFixed(digits)));

/** The figures of one k6 handleSummary JSON that the report keeps. Numbers only. */
export function parseK6Summary(data) {
  const metrics = data?.metrics ?? {};
  const stat = (metric, key) => number(metrics[metric]?.values?.[key]);
  const counted = metric => {
    const passes = stat(metric, 'passes');
    const fails = stat(metric, 'fails');
    return passes === null || fails === null ? null : { count: passes, rate: passes + fails ? rounded(passes / (passes + fails), 4) : 0 };
  };
  const thresholds = [];
  for (const [metric, entry] of Object.entries(metrics)) {
    for (const [expression, result] of Object.entries(entry?.thresholds ?? {})) {
      thresholds.push({ metric, expression, ok: result?.ok === true });
    }
  }
  const latency = metrics['http_req_duration{expected_response:true}'] ? 'http_req_duration{expected_response:true}' : 'http_req_duration';
  return {
    requests: stat('http_reqs', 'count'),
    requestRate: rounded(stat('http_reqs', 'rate')),
    iterations: stat('iterations', 'count'),
    vusMax: stat('vus_max', 'max') ?? stat('vus_max', 'value'),
    durationMs: rounded(number(data?.state?.testRunDurationMs), 0),
    latencyMs: { p50: rounded(stat(latency, 'med')), p95: rounded(stat(latency, 'p(95)')), p99: rounded(stat(latency, 'p(99)')), max: rounded(stat(latency, 'max')) },
    failedRate: rounded(stat('http_req_failed', 'rate'), 4),
    checksRate: rounded(stat('checks', 'rate'), 4),
    shed: counted('eki_shed'),
    rateLimited: counted('eki_rate_limited'),
    unexpected: counted('eki_unexpected'),
    thresholds,
    thresholdsPassed: thresholds.length > 0 && thresholds.every(item => item.ok),
  };
}

// ---- evidence: fault drills -----------------------------------------------------

/** Classifies one probe: its k6 outcome, and whether it finished within the budget. */
export function probeOutcome({ status, retryAfter, kind, authenticated, durationMs, budgetMs = PROBE_BUDGET_MS }) {
  const outcome = status === null ? 'error' : classify({ status, retryAfter, kind, authenticated });
  return { outcome, good: outcome === 'ok' && durationMs < budgetMs };
}

function phaseStats(samples) {
  const statuses = {};
  for (const sample of samples) {
    const key = sample.status === null ? (sample.error ?? 'transport') : String(sample.status);
    statuses[key] = (statuses[key] ?? 0) + 1;
  }
  const completed = samples.filter(sample => sample.status !== null).map(sample => sample.durationMs);
  const latency = percentileSummary(completed);
  const counts = outcome => samples.filter(sample => sample.outcome === outcome).length;
  return {
    requests: samples.length, good: samples.filter(sample => sample.good).length,
    errors: counts('error'), shed: counts('shed'), rateLimited: counts('rate_limited'),
    errorRate: samples.length ? rounded(counts('error') / samples.length, 4) : null,
    latencyMs: { p50: rounded(latency.p50, 1), p95: rounded(latency.p95, 1), p99: rounded(latency.p99, 1), max: rounded(latency.maximum, 1) },
    statuses,
  };
}

const badShare = list => (list.length ? list.filter(sample => !sample.good).length / list.length : 0);

/**
 * Phase statistics, health degradation and recovery time of one drill. Sample
 * times are milliseconds from the drill start.
 *
 * The observation after the fault is removed is cut into `windowMs` windows. A
 * window is clean when it holds probes and its share of bad probes is within
 * the tolerance. The client recovered at the start of the first run of clean
 * windows that covers `stableMs`; the recovery time runs from the removal of
 * the fault to the end of the last bad probe that started before that point.
 * Bad probes after it are counted separately, so a later relapse or a stall of
 * the client path stays visible without hiding the recovery. `/health` counts as degraded
 * only when it answered something other than 200; a transport failure is the
 * client path's, not the backend's. Samples with `route: 'direct'` bypassed
 * the proxy; they are summarized per phase as a control and do not enter the
 * analysis.
 */
export function analyzeDrill(allSamples, { faultStartMs, faultEndMs, endMs, windowMs = WINDOW_MS, stableMs = STABLE_MS }) {
  const split = list => ({
    baseline: list.filter(sample => sample.at < faultStartMs),
    fault: list.filter(sample => sample.at >= faultStartMs && sample.at < faultEndMs),
    recovery: list.filter(sample => sample.at >= faultEndMs),
  });
  const samples = allSamples.filter(sample => sample.route !== 'direct');
  const direct = allSamples.filter(sample => sample.route === 'direct');
  const phases = split(samples);
  const tolerance = Math.max(MIN_TOLERANCE, badShare(phases.baseline));
  const health = samples.filter(sample => sample.path === '/health' && sample.at >= faultStartMs && sample.status !== null);
  const degraded = health.filter(sample => sample.status !== 200);
  const lastDegraded = degraded.at(-1);
  const healthRecovered = lastDegraded ? health.find(sample => sample.at > lastDegraded.at && sample.status === 200) : null;
  const after = phases.recovery;
  const windows = [];
  for (let start = faultEndMs; start + windowMs <= endMs; start += windowMs) {
    const window = after.filter(sample => sample.at >= start && sample.at < start + windowMs);
    windows.push({ start, clean: window.length > 0 && badShare(window) <= tolerance });
  }
  const needed = Math.ceil(stableMs / windowMs);
  let stableAt = null;
  for (let index = 0; index + needed <= windows.length && stableAt === null; index++) {
    if (windows.slice(index, index + needed).every(window => window.clean)) stableAt = windows[index].start;
  }
  const settled = stableAt !== null;
  const recoveryMs = settled
    ? Math.max(0, ...after.filter(sample => !sample.good && sample.at < stableAt).map(sample => sample.at + sample.durationMs - faultEndMs))
    : null;
  return {
    tolerance: rounded(tolerance, 4),
    faultObserved: badShare(phases.fault) > tolerance || degraded.length > 0,
    phases: Object.fromEntries(Object.entries(phases).map(([name, list]) => [name, phaseStats(list)])),
    direct: direct.length ? Object.fromEntries(Object.entries(split(direct)).map(([name, list]) => [name, phaseStats(list)])) : null,
    health: {
      probes: health.length,
      degraded: degraded.length,
      firstDegradedAfterFaultMs: degraded.length ? rounded(degraded[0].at - faultStartMs, 0) : null,
      recoveredAfterFaultRemovedMs: healthRecovered ? rounded(Math.max(0, healthRecovered.at - faultEndMs), 0) : null,
      recovered: degraded.length === 0 || Boolean(healthRecovered),
    },
    recovered: settled,
    recoveryMs: recoveryMs === null ? null : rounded(recoveryMs, 0),
    badAfterRecovery: settled ? after.filter(sample => !sample.good && sample.at >= stableAt).length : null,
  };
}

// ---- evidence: lease, process and resources -----------------------------------

// Values a server returns reach the evidence only after they are rebuilt from
// these fixed sets, which validates them and keeps response bytes out of files
// (CodeQL js/http-to-file-access).
const HTTP_STATUS_CODES = Object.freeze(Array.from({ length: 500 }, (_, index) => index + 100));
const ID_CHARACTERS = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:_.-'];
const DIGITS = [...'0123456789'];

/** The HTTP status code from the fixed list of 100 to 599, or null. */
export function canonicalStatus(value) {
  return HTTP_STATUS_CODES.find(code => code === value) ?? null;
}

function rebuild(value, alphabet, maxLength) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return null;
  const rebuilt = [...value].map(character => alphabet.find(candidate => candidate === character));
  return rebuilt.every(character => character !== undefined) ? rebuilt.join('') : null;
}

/** A short identifier (letters, digits, `:_.-`) rebuilt character by character, or null. */
export function canonicalId(value) {
  return rebuild(value, ID_CHARACTERS, 80);
}

/** A non-negative safe integer rebuilt from its digits, or null. */
export function canonicalCount(value) {
  const text = typeof value === 'string' ? value : Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  const digits = rebuild(text, DIGITS, 16);
  return digits === null ? null : Number(digits);
}

/** Milliseconds since the epoch from an ISO 8601 timestamp, or null. */
export function canonicalTime(value) {
  const text = rebuild(value, [...DIGITS, '-', ':', 'T', 'Z', '.', '+'], 40);
  const parsed = text === null ? NaN : Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The worker lease from a Firestore REST document, or null. */
export function parseLeaseDocument(document) {
  const fields = document?.fields;
  if (!fields) return null;
  return {
    ownerId: canonicalId(fields.ownerId?.stringValue),
    generation: canonicalCount(fields.generation?.integerValue),
    renewedAtMs: canonicalTime(fields.renewedAt?.timestampValue),
    expiresAtMs: canonicalTime(fields.expiresAt?.timestampValue),
  };
}

/**
 * Whether one process held the worker lease without interruption. Each sample
 * is `{ at, lease }`. The lease is continuous when every sample names the same
 * owner and generation and was unexpired when read.
 */
export function leaseContinuity(samples) {
  const read = samples.filter(sample => sample.lease);
  const owners = new Set(read.map(sample => sample.lease.ownerId));
  const generations = new Set(read.map(sample => sample.lease.generation));
  const renewals = [...new Set(read.map(sample => sample.lease.renewedAtMs).filter(value => value !== null))].sort((a, b) => a - b);
  const gaps = renewals.slice(1).map((value, index) => value - renewals[index]);
  return {
    samples: samples.length,
    readable: read.length,
    owners: owners.size,
    generations: [...generations],
    allUnexpired: read.every(sample => sample.lease.expiresAtMs !== null && sample.lease.expiresAtMs > sample.at),
    renewalsObserved: renewals.length,
    maxRenewalGapMs: gaps.length ? Math.max(...gaps) : null,
    continuous: read.length >= 2 && read.length === samples.length && owners.size === 1 && generations.size === 1
      && !owners.has(null) && read.every(sample => sample.lease.expiresAtMs !== null && sample.lease.expiresAtMs > sample.at),
  };
}

/**
 * Process-local counters from an /api/health body. Each only grows while one
 * process runs, so a decrease between two reads means the reads reached
 * another process: a restart or a second instance.
 */
export function healthCounters(body) {
  const counters = {};
  const add = (key, value) => {
    const count = typeof value === 'number' ? canonicalCount(value) : null;
    if (count !== null) counters[key] = count;
  };
  const telemetry = body?.telemetry ?? {};
  add('telemetry.accepted', telemetry.accepted);
  add('telemetry.rejected', telemetry.rejected);
  add('telemetry.credentialFills', telemetry.credentialFills);
  for (const [name, cache] of Object.entries(telemetry.apiReads ?? {})) {
    if (!/^[A-Za-z]{1,40}$/.test(name)) continue;
    for (const key of ['hits', 'fills', 'failures', 'invalidations']) add(`apiReads.${name}.${key}`, cache?.[key]);
  }
  for (const [name, traffic] of Object.entries(telemetry.apiCompatibility ?? {})) {
    if (!/^[a-z-]{1,40}:(legacy|v2)$/.test(name)) continue;
    add(`apiCompatibility.${name}.requests`, traffic?.requests);
  }
  add('backgroundTasks.totalFailures', body?.backgroundTasks?.totalFailures);
  return { counters, checkedAtMs: canonicalTime(body?.checkedAt),
    status: body?.status === 'ok' ? 'ok' : body?.status === 'degraded' ? 'degraded' : null,
    revision: canonicalId(body?.release?.revision), sourceSha: canonicalId(body?.release?.sourceSha) };
}

/** Reads where a counter or the probe time went backwards, and the revisions seen. */
export function detectProcessChanges(reads) {
  const changes = [];
  for (let index = 1; index < reads.length; index++) {
    const previous = reads[index - 1];
    const current = reads[index];
    const decreased = Object.entries(current.counters).filter(([key, value]) => key in previous.counters && value < previous.counters[key]).map(([key]) => key);
    const probeRewound = previous.checkedAtMs !== null && current.checkedAtMs !== null && current.checkedAtMs < previous.checkedAtMs;
    if (decreased.length || probeRewound) changes.push({ at: current.at, decreased, probeRewound });
  }
  return { reads: reads.length, changes, revisions: [...new Set(reads.map(read => read.revision))] };
}

function series(samples, key) {
  const points = samples.filter(sample => number(sample[key]) !== null).map(sample => [sample.at, sample[key]]);
  if (!points.length) return null;
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  const spread = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
  const slope = spread ? points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0) / spread : 0;
  return { first: points[0][1], last: points.at(-1)[1], max: Math.max(...points.map(([, y]) => y)),
    growth: points.at(-1)[1] - points[0][1], slopePerMinute: rounded(slope * 60_000, 1) };
}

/** Growth of the backend's memory and resources between two times, from its resource log. */
export function resourceGrowth(samples, fromMs, toMs) {
  const window = samples.filter(sample => sample.at >= fromMs && sample.at <= toMs);
  return {
    samples: window.length,
    spanMs: window.length ? window.at(-1).at - window[0].at : 0,
    pids: [...new Set(window.map(sample => sample.pid))].length,
    // Samples come from a 5 s timer inside the backend; a longer gap means its event loop stopped.
    stalls: timerStalls(window),
    rss: series(window, 'rss'), heapUsed: series(window, 'heapUsed'),
    activeResources: series(window, 'activeResources'), sockets: series(window, 'sockets'), fds: series(window, 'fds'),
  };
}

/** Gaps between consecutive resource samples longer than `thresholdMs` (the timer runs every 5 s). */
export function timerStalls(samples, thresholdMs = 10_000) {
  const gaps = samples.slice(1).map((sample, index) => ({ endedAt: sample.at, gapMs: sample.at - samples[index].at }))
    .filter(gap => gap.gapMs > thresholdMs);
  return { count: gaps.length, longestMs: gaps.length ? Math.max(...gaps.map(gap => gap.gapMs)) : 0,
    endedAt: gaps.map(gap => new Date(gap.endedAt).toISOString()) };
}

/** Parses the backend's resource log, skipping lines that are not complete samples. */
export function parseResourceLog(text) {
  return String(text ?? '').split('\n').flatMap(line => {
    try {
      const sample = JSON.parse(line);
      return number(sample?.at) !== null && Number.isSafeInteger(sample?.pid) ? [sample] : [];
    } catch { return []; }
  });
}

// ---- redaction and report -------------------------------------------------------

const JWT = /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi;

/** Text with every listed secret, JWT and bearer credential replaced by a marker. */
export function redactLog(text, secrets = []) {
  let value = String(text ?? '');
  for (const secret of secrets) if (secret) value = value.split(secret).join('[REDACTED]');
  return value.replace(JWT, '[REDACTED_JWT]').replace(BEARER, 'Bearer [REDACTED]');
}

/** The run verdict from the collected report. */
export function verdictFor(report) {
  if (report.setupError) return 'BLOCKED';
  if (report.dryRun) return 'DRY_RUN';
  if (report.release && report.release.after && (report.release.after.revision !== report.release.before?.revision
    || report.release.after.sourceSha !== report.release.before?.sourceSha)) return 'REVISION_CHANGED';
  // The run measures one process. A counter that went backwards more often than
  // the planned restarts explain means a restart or a second instance served it.
  if ((report.process?.health?.changes.length ?? 0) > (report.process?.expectedChanges ?? 0)) return 'PROCESS_CHANGED';
  const profilesOk = report.profiles.length > 0 && report.profiles.every(profile => profile.summary?.thresholdsPassed === true);
  // A drill whose fault changed nothing did not test anything.
  const drillsOk = report.drills.every(drill => drill.analysis?.recovered === true && drill.analysis.faultObserved === true);
  const processOk = (report.process?.unexpectedExits ?? 0) === 0;
  const leaseOk = report.lease?.soak ? report.lease.soak.continuous === true : true;
  return profilesOk && drillsOk && processOk && leaseOk ? 'WITHIN_THRESHOLDS' : 'THRESHOLDS_FAILED';
}

const percent = value => (value === null || value === undefined ? '-' : `${rounded(100 * value, 2)} %`);
const ms = value => (value === null || value === undefined ? '-' : `${value}`);
const mib = value => (value === null || value === undefined ? '-' : `${rounded(value / 1048576, 1)}`);

/** The Markdown summary of a report. */
export function renderMarkdown(report) {
  const lines = [`# Load and fault drills: ${report.mode}`, '',
    `Source ${report.sourceCommit}; dirty: ${describeDirty(report)}; verdict: ${report.verdict}.`, '',
    `Target: ${report.target}. k6 ${report.k6Version ?? 'not run'} (\`${K6_IMAGE}\`); Toxiproxy ${report.toxiproxyVersion ?? 'not run'} (\`${TOXIPROXY_IMAGE}\`).`, '',
    report.scope, ''];
  if (report.release) {
    lines.push(`Serving revision before: ${report.release.before?.revision ?? 'not read'} (${report.release.before?.sourceSha ?? '-'}); `
      + `after: ${report.release.after?.revision ?? 'not read'}. Expected: ${report.release.expectedRevision}.`, '');
  }
  if (report.setupError) lines.push(`Setup: ${report.setupError}`, '');
  lines.push('| Profile | Peak VUs | Duration (s) | Requests | p50 (ms) | p95 (ms) | p99 (ms) | Failed | Checks | 503 shed | 429 | Thresholds |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|');
  // A dry run lists the planned profiles; their duration column is the planned time.
  const rows = report.profiles.length ? report.profiles : (report.bounds ?? []).map(bound => ({ ...bound, planned: true }));
  for (const profile of rows) {
    const s = profile.summary;
    lines.push(`| ${profile.profile} | ${profile.peakVus} | ${s ? Math.round(s.durationMs / 1000) : profile.plannedSeconds ?? '-'} | ${s?.requests ?? '-'} | `
      + `${ms(s?.latencyMs.p50)} | ${ms(s?.latencyMs.p95)} | ${ms(s?.latencyMs.p99)} | ${percent(s?.failedRate)} | ${percent(s?.checksRate)} | `
      + `${percent(s?.shed?.rate)} | ${percent(s?.rateLimited?.rate)} | ${s ? (s.thresholdsPassed ? 'passed' : 'FAILED') : profile.planned ? 'planned' : `not run (exit ${profile.exitCode ?? '-'})`} |`);
  }
  if (!report.drills.length && report.drillPlans && Object.keys(report.drillPlans).length) {
    lines.push('', `Planned drills: ${Object.entries(report.drillPlans).map(([name, plan]) => `${name} (${plan.baselineS} s baseline, ${plan.faultS} s fault, `
      + `up to ${plan.recoveryS} s recovery)`).join('; ')}.`);
  }
  if (report.drills.length) {
    lines.push('', '| Drill | Phase | Probes | Good | Errors | 503 with Retry-After | p50 (ms) | p95 (ms) | Statuses | Direct /health good |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const drill of report.drills) {
      for (const [phase, stats] of Object.entries(drill.analysis?.phases ?? {})) {
        const direct = drill.analysis.direct?.[phase];
        lines.push(`| ${drill.drill} | ${phase} | ${stats.requests} | ${stats.good} | ${stats.errors} | ${stats.shed} | ${ms(stats.latencyMs.p50)} | ${ms(stats.latencyMs.p95)} | `
          + `${Object.entries(stats.statuses).map(([key, value]) => `${key}: ${value}`).join(', ')} | ${direct ? `${direct.good}/${direct.requests}` : '-'} |`);
      }
    }
    lines.push('', '| Drill | Fault | Fault observed | /health degraded probes | First degraded after fault start (ms) | /health recovered after removal (ms) | Recovered | Recovery time (ms) | Bad probes after recovery |', '|---|---|---|---|---|---|---|---|---|');
    for (const drill of report.drills) {
      const a = drill.analysis;
      lines.push(`| ${drill.drill} | ${drill.fault} | ${a ? (a.faultObserved ? 'yes' : 'NO') : '-'} | ${a?.health.degraded ?? '-'} | ${ms(a?.health.firstDegradedAfterFaultMs)} | `
        + `${ms(a?.health.recoveredAfterFaultRemovedMs)} | ${a ? (a.recovered ? 'yes' : 'NO') : '-'} | ${ms(a?.recoveryMs)} | ${a?.badAfterRecovery ?? '-'} |`);
    }
  }
  if (report.resources) {
    const r = report.resources;
    lines.push('', `Soak window resources (${r.samples} samples over ${Math.round(r.spanMs / 1000)} s, ${r.pids} process): `
      + `RSS ${mib(r.rss?.first)} to ${mib(r.rss?.last)} MiB (max ${mib(r.rss?.max)}), heap used ${mib(r.heapUsed?.first)} to ${mib(r.heapUsed?.last)} MiB `
      + `(slope ${mib(r.heapUsed?.slopePerMinute)} MiB/min), active resources ${r.activeResources?.first ?? '-'} to ${r.activeResources?.last ?? '-'}, `
      + `sockets ${r.sockets?.first ?? '-'} to ${r.sockets?.last ?? '-'}, file descriptors ${r.fds ? `${r.fds.first} to ${r.fds.last}` : 'not available on this platform'}. `
      + `Backend timer stalls over 10 s: ${r.stalls?.count ?? '-'}${r.stalls?.count ? ` (longest ${Math.round(r.stalls.longestMs / 1000)} s)` : ''}.`);
  }
  if (report.stalls) {
    lines.push('', `Backend timer stalls over 10 s across the run: ${report.stalls.count}${report.stalls.count
      ? ` (longest ${Math.round(report.stalls.longestMs / 1000)} s, ending ${report.stalls.endedAt.join(', ')})` : ''}.`);
  }
  if (report.lease) {
    for (const [window, lease] of Object.entries(report.lease)) {
      if (!lease) continue;
      lines.push('', `Worker lease, ${window}: ${lease.readable}/${lease.samples} reads, owners ${lease.owners}, generations ${lease.generations.join(', ') || '-'}, `
        + `renewals observed ${lease.renewalsObserved}, longest gap ${ms(lease.maxRenewalGapMs)} ms, continuous: ${lease.continuous}.`);
    }
  }
  if (report.process) {
    const p = report.process;
    lines.push('', `Backend processes started by the runner: ${p.started}; unexpected exits: ${p.unexpectedExits ?? 'not observable'}; `
      + `process changes seen through /api/health: ${p.health?.changes.length ?? 'not read'} in ${p.health?.reads ?? 0} reads`
      + ` (${p.expectedChanges} expected from planned restarts); revisions seen: ${p.health?.revisions.map(value => value ?? 'none').join(', ') || '-'}.`);
  }
  return lines.join('\n') + '\n';
}

export { LIMITS, PEAK_PROFILES, PROFILE_NAMES };
