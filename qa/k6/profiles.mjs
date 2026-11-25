// Profile definitions for the k6 load profiles in this folder (qa/LOAD_DRILLS.md).
// Both runtimes load this file: k6 through common.js, and Node through
// scripts/qa/load-plan.mjs and its tests. It therefore imports nothing.

export const PROFILE_NAMES = Object.freeze(['smoke', 'load', 'headroom', 'stress', 'spike', 'soak']);

// Profiles that push past the expected peak. They get the 900 ms p95 budget and
// may be rate limited or shed; the others may not.
export const PEAK_PROFILES = Object.freeze(['headroom', 'stress', 'spike']);

// The load profile holds VUS, the expected peak; headroom holds 1.2 times it
// (issue #518), rounded up.
export const HEADROOM_PERCENT = 120;
export const headroomVus = vus => Math.ceil(vus * HEADROOM_PERCENT / 100);

// Thresholds from issue #518.
export const LIMITS = Object.freeze({
  failedRate: 0.01,
  checksRate: 0.99,
  p95Ms: 800,
  peakP95Ms: 900,
  // Share of requests answered 429 or 503 with Retry-After that smoke, load and
  // soak may see. Stress and spike only record it.
  offPeakRejectedRate: 0.01,
});

// Defaults for a bounded local run of about 13 min of traffic. Every value can be
// overridden with `k6 run -e NAME=value`; scripts/qa/run-load.mjs always passes
// them explicitly.
export const DEFAULTS = Object.freeze({
  PATHS: '/health,/live',
  API_PATHS: '/api/health',
  SMOKE_VUS: 2,
  SMOKE_DURATION: '1m',
  VUS: 20,
  RAMP: '15s',
  DURATION: '2m',
  STRESS_VUS: 60,
  STEP: '40s',
  SPIKE_VUS: 100,
  SPIKE_HOLD: '30s',
  SOAK_VUS: 10,
  SOAK_DURATION: '6m',
  THINK_S: 2,
  TIMEOUT: '10s',
});

// The spike ramps from 0 to SPIKE_VUS in this time (issue #518).
export const SPIKE_RAMP = '10s';
export const GRACEFUL_STOP = '10s';
export const MAX_VUS = 500;
export const MAX_PATHS = 10;

const PATH = /^\/[A-Za-z0-9._~/-]{0,200}$/;
const DURATION = /^([1-9]\d{0,4})(s|m|h)$/;

/** Seconds in a k6 duration such as `90s`, `2m` or `1h`. Only one unit is accepted. */
export function durationSeconds(value) {
  const match = DURATION.exec(String(value ?? ''));
  if (!match) throw new Error(`Duration must look like 30s, 2m or 1h: ${value}`);
  return Number(match[1]) * { s: 1, m: 60, h: 3600 }[match[2]];
}

/** A comma-separated list of request paths, without query strings or duplicates. */
export function parsePaths(raw, name) {
  const paths = String(raw ?? '').split(',').map(path => path.trim()).filter(Boolean);
  if (paths.length > MAX_PATHS) throw new Error(`${name}: at most ${MAX_PATHS} paths`);
  for (const path of paths) {
    if (!PATH.test(path) || path.includes('//') || path.split('/').includes('..')) throw new Error(`${name}: invalid path ${path}`);
  }
  if (new Set(paths).size !== paths.length) throw new Error(`${name}: duplicate path`);
  return paths;
}

function count(env, name, minimum = 1) {
  const raw = env[name] ?? DEFAULTS[name];
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > MAX_VUS) throw new Error(`${name} must be an integer from ${minimum} to ${MAX_VUS}`);
  return value;
}

function duration(env, name) {
  const value = String(env[name] ?? DEFAULTS[name]);
  durationSeconds(value);
  return value;
}

/** The validated settings of one run, from k6 `-e` variables or their defaults. */
export function readSettings(env = {}) {
  const think = Number(env.THINK_S ?? DEFAULTS.THINK_S);
  if (!Number.isFinite(think) || think < 0 || think > 60) throw new Error('THINK_S must be from 0 to 60 seconds');
  const settings = {
    paths: parsePaths(env.PATHS ?? DEFAULTS.PATHS, 'PATHS'),
    apiPaths: parsePaths(env.API_PATHS ?? DEFAULTS.API_PATHS, 'API_PATHS'),
    smokeVus: count(env, 'SMOKE_VUS'),
    smokeDuration: duration(env, 'SMOKE_DURATION'),
    vus: count(env, 'VUS'),
    ramp: duration(env, 'RAMP'),
    duration: duration(env, 'DURATION'),
    stressVus: count(env, 'STRESS_VUS', 3),
    step: duration(env, 'STEP'),
    spikeVus: count(env, 'SPIKE_VUS'),
    spikeHold: duration(env, 'SPIKE_HOLD'),
    soakVus: count(env, 'SOAK_VUS'),
    soakDuration: duration(env, 'SOAK_DURATION'),
    thinkS: think,
    timeout: duration(env, 'TIMEOUT'),
  };
  if (!settings.paths.length && !settings.apiPaths.length) throw new Error('PATHS and API_PATHS are both empty');
  if (headroomVus(settings.vus) > MAX_VUS) throw new Error(`VUS: 1.2 times it must stay at most ${MAX_VUS}`);
  return settings;
}

/** The k6 scenario of one profile. */
export function scenarioFor(profile, settings) {
  const s = settings;
  const ramping = stages => ({ executor: 'ramping-vus', startVUs: 0, stages, gracefulRampDown: GRACEFUL_STOP, gracefulStop: GRACEFUL_STOP });
  switch (profile) {
    case 'smoke': return { executor: 'constant-vus', vus: s.smokeVus, duration: s.smokeDuration, gracefulStop: GRACEFUL_STOP };
    case 'load': return ramping([
      { duration: s.ramp, target: s.vus }, { duration: s.duration, target: s.vus }, { duration: s.ramp, target: 0 }]);
    case 'headroom': return ramping([
      { duration: s.ramp, target: headroomVus(s.vus) }, { duration: s.duration, target: headroomVus(s.vus) }, { duration: s.ramp, target: 0 }]);
    case 'stress': return ramping([
      ...[1, 2, 3].flatMap(step => {
        const target = Math.round(s.stressVus * step / 3);
        return [{ duration: s.ramp, target }, { duration: s.step, target }];
      }),
      { duration: s.ramp, target: 0 }]);
    case 'spike': return ramping([
      { duration: SPIKE_RAMP, target: s.spikeVus }, { duration: s.spikeHold, target: s.spikeVus }, { duration: SPIKE_RAMP, target: 0 }]);
    case 'soak': return { executor: 'constant-vus', vus: s.soakVus, duration: s.soakDuration, gracefulStop: GRACEFUL_STOP };
    default: throw new Error(`Unknown load profile: ${profile}`);
  }
}

/** Seconds of traffic one profile plans, including the graceful stop. */
export function plannedSeconds(profile, settings) {
  const scenario = scenarioFor(profile, settings);
  const traffic = scenario.stages
    ? scenario.stages.reduce((sum, stage) => sum + durationSeconds(stage.duration), 0)
    : durationSeconds(scenario.duration);
  return traffic + durationSeconds(GRACEFUL_STOP);
}

/** The highest number of VUs a profile reaches. */
export function peakVus(profile, settings) {
  const scenario = scenarioFor(profile, settings);
  return scenario.stages ? Math.max(...scenario.stages.map(stage => stage.target)) : scenario.vus;
}

/** k6 thresholds of one profile. */
export function thresholdsFor(profile) {
  if (!PROFILE_NAMES.includes(profile)) throw new Error(`Unknown load profile: ${profile}`);
  const peak = PEAK_PROFILES.includes(profile);
  return {
    http_req_failed: [`rate<${LIMITS.failedRate}`],
    'http_req_duration{expected_response:true}': [`p(95)<${peak ? LIMITS.peakP95Ms : LIMITS.p95Ms}`],
    checks: [`rate>${LIMITS.checksRate}`],
    ...(peak ? {} : {
      eki_shed: [`rate<${LIMITS.offPeakRejectedRate}`],
      eki_rate_limited: [`rate<${LIMITS.offPeakRejectedRate}`],
    }),
  };
}

/** The complete k6 options of one profile. */
export function optionsFor(profile, env = {}) {
  const settings = readSettings(env);
  return {
    scenarios: { [profile]: scenarioFor(profile, settings) },
    thresholds: thresholdsFor(profile),
    summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
    discardResponseBodies: true,
    userAgent: 'eki-qa-load/1',
  };
}

/**
 * The outcome of one response. Public probes (`/health`, `/live`) are exempt
 * from the load limiter, so anything but 200 is an error. An API path expects
 * 200 with a token and 401 without one; 429 is the in-process rate limiter and
 * 503 with Retry-After is deliberate load shedding. Both are counted, not
 * treated as failures. A 503 without Retry-After is a dependency failure.
 */
export function classify({ status, retryAfter, kind, authenticated }) {
  if (kind === 'public') return status === 200 ? 'ok' : 'error';
  if (status === 429) return 'rate_limited';
  if (status === 503 && retryAfter) return 'shed';
  return status === (authenticated ? 200 : 401) ? 'ok' : 'error';
}

/** The status codes k6 counts as expected for a request kind (`http_req_failed`). */
export function expectedStatuses(kind, authenticated) {
  return kind === 'public' ? [200] : [authenticated ? 200 : 401, 429, 503];
}
