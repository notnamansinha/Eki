// Shared request loop and summary of the five k6 profiles (qa/LOAD_DRILLS.md).
// Run a profile directly with, for example:
//   k6 run --no-usage-report -e BASE_URL=http://127.0.0.1:3116 -e PATHS=/health,/live -e API_PATHS=/api/health qa/k6/load.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { classify, expectedStatuses, optionsFor as profileOptions, readSettings } from './profiles.mjs';

const settings = readSettings(__ENV);
const base = String(__ENV.BASE_URL ?? '').replace(/\/$/, '');
if (!/^https?:\/\/[^/?#@]+$/.test(base)) throw new Error('BASE_URL must be an origin, for example http://127.0.0.1:3116');

// Optional ID tokens, one per synthetic account: VU n uses token n modulo the count.
// Read from a file so that no token appears on a command line.
const tokens = __ENV.TOKENS_FILE ? JSON.parse(open(__ENV.TOKENS_FILE)) : [];
if (!Array.isArray(tokens) || !tokens.every(token => typeof token === 'string' && token.length > 0)) {
  throw new Error('TOKENS_FILE must hold a JSON array of ID tokens');
}

const shed = new Rate('eki_shed');
const rateLimited = new Rate('eki_rate_limited');
const unexpected = new Rate('eki_unexpected');
const callbacks = {
  public: http.expectedStatuses(...expectedStatuses('public', false)),
  api: http.expectedStatuses(...expectedStatuses('api', tokens.length > 0)),
};

function request(kind, path, headers) {
  const response = http.get(`${base}${path}`, {
    headers, timeout: settings.timeout, responseCallback: callbacks[kind], tags: { kind, name: path },
  });
  const outcome = classify({ status: response.status, retryAfter: response.headers['Retry-After'], kind, authenticated: tokens.length > 0 });
  shed.add(outcome === 'shed');
  rateLimited.add(outcome === 'rate_limited');
  unexpected.add(outcome === 'error');
  check(response, { 'expected status or declared shedding': () => outcome !== 'error' }, { kind });
}

export function optionsFor(profile) {
  return profileOptions(profile, __ENV);
}

/** One simulated client: one public probe and one API read, then think time. */
export function iteration() {
  const turn = __VU + __ITER;
  if (settings.paths.length) request('public', settings.paths[turn % settings.paths.length], {});
  if (settings.apiPaths.length) {
    const token = tokens.length ? tokens[(__VU - 1) % tokens.length] : null;
    request('api', settings.apiPaths[turn % settings.apiPaths.length], token ? { Authorization: `Bearer ${token}` } : {});
  }
  // Up to 20 % jitter so that VUs do not move in lock step.
  if (settings.thinkS > 0) sleep(settings.thinkS * (0.9 + Math.random() * 0.2));
}

function value(data, metric, stat) {
  const found = data.metrics[metric]?.values?.[stat];
  return typeof found === 'number' ? found : null;
}

/** Writes the full summary to SUMMARY_PATH, when set, and prints one line. */
export function summaryFor(profile) {
  return data => {
    const failed = Object.values(data.metrics).some(metric => Object.values(metric.thresholds ?? {}).some(result => !result.ok));
    const round = number => number === null ? 'n/a' : Math.round(number * 100) / 100;
    const line = `${profile}: ${value(data, 'http_reqs', 'count')} requests, p95 ${round(value(data, 'http_req_duration', 'p(95)'))} ms, `
      + `failed ${round(100 * (value(data, 'http_req_failed', 'rate') ?? 0))} %, checks ${round(100 * (value(data, 'checks', 'rate') ?? 0))} %, `
      + `shed ${round(100 * (value(data, 'eki_shed', 'rate') ?? 0))} %, rate limited ${round(100 * (value(data, 'eki_rate_limited', 'rate') ?? 0))} %, `
      + `thresholds ${failed ? 'FAILED' : 'passed'}\n`;
    return __ENV.SUMMARY_PATH ? { [__ENV.SUMMARY_PATH]: JSON.stringify(data, null, 1), stdout: line } : { stdout: line };
  };
}
