import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRoot } from './qa/acceptance-catalog.mjs';
import {
  DRILLS, DRILL_NAMES, K6_IMAGE, PROFILE_ORDER, TOXIPROXY_IMAGE, analyzeDrill, assertDeployedRun, campaignSeconds,
  canonicalCount, canonicalId, canonicalStatus, detectProcessChanges, healthCounters, k6DockerArgs, k6Settings,
  leaseContinuity, parseK6Summary, parseLeaseDocument, parseResourceLog, probeOutcome, redactLog, renderMarkdown,
  resourceGrowth, topology, verdictFor,
} from './qa/load-plan.mjs';
import {
  LIMITS, PROFILE_NAMES, classify, durationSeconds, optionsFor, parsePaths, peakVus, plannedSeconds, readSettings, scenarioFor,
} from '../qa/k6/profiles.mjs';

const now = Date.parse('2026-11-24T10:00:00Z');
const origin = 'https://eki-backend-staging-449313371438.asia-south2.run.app';
const jwt = claims => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2lnbmF0dXJl`;
const adminToken = (extra = {}) => jwt({ aud: 'bustrack-be165', iss: 'https://securetoken.google.com/bustrack-be165',
  exp: Math.floor(now / 1000) + 3600, user_id: 'test-admin', role: 'admin', admin: true, ...extra });
const deployedEnv = (overrides = {}) => ({
  EKI_LOAD_TARGET: origin, EKI_LOAD_CONFIRM_TARGET: origin,
  EKI_LOAD_EXPECTED_REVISION: 'eki-backend-staging-00012-x7q', EKI_LOAD_ADMIN_ID_TOKEN: adminToken(), ...overrides,
});
const deployed = (overrides, options = {}) => assertDeployedRun(deployedEnv(overrides), { now, ...options });

test('k6 and Toxiproxy images are pinned by version and digest', () => {
  assert.match(K6_IMAGE, /^grafana\/k6:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
  assert.match(TOXIPROXY_IMAGE, /^ghcr\.io\/shopify\/toxiproxy:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
});

test('each of the five profiles is a thin k6 entry point with no remote import', () => {
  assert.deepEqual([...PROFILE_NAMES].sort(), [...PROFILE_ORDER].sort());
  for (const name of [...PROFILE_NAMES, 'common']) {
    const source = readFileSync(resolve(repositoryRoot, `qa/k6/${name}.js`), 'utf8');
    for (const [, specifier] of source.matchAll(/^import .* from '([^']+)';$/gm)) {
      assert(specifier.startsWith('./') || specifier.startsWith('k6'), `${name}.js imports ${specifier}`);
    }
    if (name !== 'common') {
      assert.match(source, new RegExp(`optionsFor\\('${name}'\\)`));
      assert.match(source, new RegExp(`summaryFor\\('${name}'\\)`));
    }
  }
});

test('thresholds follow issue #518: 800 ms p95 off peak, 900 ms at peak, and shedding only at peak', () => {
  for (const profile of PROFILE_NAMES) {
    const { thresholds } = optionsFor(profile, {});
    const peak = ['stress', 'spike'].includes(profile);
    assert.deepEqual(thresholds.http_req_failed, ['rate<0.01']);
    assert.deepEqual(thresholds.checks, ['rate>0.99']);
    assert.deepEqual(thresholds['http_req_duration{expected_response:true}'], [`p(95)<${peak ? 900 : 800}`]);
    assert.equal('eki_shed' in thresholds, !peak, profile);
    assert.equal('eki_rate_limited' in thresholds, !peak, profile);
  }
});

test('local profiles are bounded to minutes and the spike reaches its peak in 10 s', () => {
  const { settings } = k6Settings('local', {});
  assert(PROFILE_NAMES.every(profile => plannedSeconds(profile, settings) <= 7 * 60), 'no local profile runs longer than 7 min');
  assert(campaignSeconds(PROFILE_ORDER, DRILL_NAMES, settings) <= 30 * 60, 'the whole local campaign stays under 30 min');
  const spike = scenarioFor('spike', settings);
  assert.deepEqual(spike.stages[0], { duration: '10s', target: settings.spikeVus });
  assert.equal(spike.startVUs, 0);
  assert.deepEqual(scenarioFor('stress', settings).stages.filter((_, index) => index % 2 === 1 && index < 6).map(stage => stage.target), [20, 40, 60]);
  assert.equal(peakVus('load', settings), 20);
});

test('settings reject unsafe paths, unbounded VUs and malformed durations', () => {
  assert.deepEqual(parsePaths(' /health, /live ', 'PATHS'), ['/health', '/live']);
  for (const raw of ['/a?b=1', '/../x', 'health', '/a,/a', '//evil.example']) assert.throws(() => parsePaths(raw, 'PATHS'), /PATHS/, raw);
  assert.throws(() => readSettings({ VUS: '501' }), /VUS/);
  assert.throws(() => readSettings({ SOAK_DURATION: '1h30m' }), /Duration/);
  assert.throws(() => readSettings({ PATHS: '', API_PATHS: '' }), /both empty/);
  assert.equal(durationSeconds('2m'), 120);
  const { values, settings } = k6Settings('local', { EKI_LOAD_K6_SOAK_DURATION: '30s', EKI_LOAD_K6_VUS: '5' });
  assert.equal(values.SOAK_DURATION, '30s');
  assert.equal(settings.vus, 5);
  assert.throws(() => k6Settings('staging', { EKI_LOAD_K6_PATHS: '/health,/admin' }), /only \/health and \/live/);
});

test('a response is ok, shed, rate limited or an error', () => {
  assert.equal(classify({ status: 200, kind: 'public' }), 'ok');
  assert.equal(classify({ status: 503, retryAfter: '1', kind: 'public' }), 'error', '/health is exempt from the limiter: 503 is degradation');
  assert.equal(classify({ status: 429, kind: 'api', authenticated: true }), 'rate_limited');
  assert.equal(classify({ status: 503, retryAfter: '1', kind: 'api', authenticated: true }), 'shed');
  assert.equal(classify({ status: 503, kind: 'api', authenticated: true }), 'error', 'a 503 without Retry-After is a failure');
  assert.equal(classify({ status: 401, kind: 'api', authenticated: false }), 'ok');
  assert.equal(classify({ status: 401, kind: 'api', authenticated: true }), 'error');
  assert.deepEqual(probeOutcome({ status: 200, kind: 'public', durationMs: LIMITS.p95Ms + 1 }), { outcome: 'ok', good: false });
  assert.deepEqual(probeOutcome({ status: null, kind: 'public', durationMs: 3 }), { outcome: 'error', good: false });
});

test('Docker Desktop and Linux topologies keep every listener on loopback in 18000 to 18999', () => {
  const desktop = topology({ platform: 'win32' });
  assert.equal(desktop.k6BaseUrl, 'http://host.docker.internal:3116');
  assert.equal(desktop.proxies.firestore.upstream, 'host.docker.internal:8085');
  const published = desktop.toxiproxyArgs.flatMap((value, index, all) => (all[index - 1] === '-p' ? [value] : []));
  assert.equal(published.length, 3);
  for (const mapping of published) {
    const [address, port] = mapping.split(':');
    assert.equal(address, '127.0.0.1');
    assert(Number(port) >= 18000 && Number(port) <= 18999, mapping);
  }
  const linux = topology({ platform: 'linux' });
  assert.deepEqual(linux.k6Network, ['--network', 'host']);
  assert(linux.toxiproxyArgs.includes('-host=127.0.0.1'));
  assert(Object.values(linux.proxies).every(proxy => proxy.listen.startsWith('127.0.0.1:18')));
  const remote = topology({ platform: 'win32', deployed: { origin, host: new URL(origin).hostname } });
  assert.equal(remote.proxies.api.upstream, `${new URL(origin).hostname}:443`);
  assert.equal(remote.proxies.firestore, undefined, 'no dependency proxy against a deployed target');
  assert.deepEqual(remote.probe, { host: '127.0.0.1', port: 18666, tls: true, servername: new URL(origin).hostname });
  assert.deepEqual(remote.direct, { host: new URL(origin).hostname, port: 443, tls: true, servername: new URL(origin).hostname });
  assert.deepEqual(desktop.direct, { host: '127.0.0.1', port: 3116, tls: false, servername: null });
  assert.equal(remote.k6BaseUrl, origin);
});

test('k6 arguments carry the plan but never a token', () => {
  const { values } = k6Settings('local', {});
  const argv = k6DockerArgs({ name: 'eki-load-k6-1-load', topology: topology({ platform: 'win32' }), scriptsDir: 'S', workDir: 'W', profile: 'load', values, tokensFile: 'tokens.json' });
  assert(argv.includes('--no-usage-report'));
  assert(argv.includes('TOKENS_FILE=/work/tokens.json'));
  assert(!argv.some(value => /eyJ|Bearer/.test(value)));
  assert.equal(argv.at(-1), '/scripts/load.js');
  assert.throws(() => k6DockerArgs({ name: 'x', topology: topology({ platform: 'win32' }), scriptsDir: 'S', workDir: 'W', profile: 'load', values: { ...values, PATHS: '/a b' } }), /Unsafe/);
  assert.throws(() => k6DockerArgs({ name: 'x', topology: topology({ platform: 'win32' }), scriptsDir: 'S', workDir: 'W', profile: 'soak2', values }), /Unknown/);
});

test('a deployed run needs the exact confirmed origin, the expected revision and an administrator token', () => {
  const run = deployed();
  assert.equal(run.service, 'eki-backend-staging');
  assert.deepEqual(run.drills, ['latency', 'partition'], 'the dependency drill stays local');
  assert.deepEqual(run.profiles, PROFILE_ORDER);
  assert(run.plannedSeconds + 600 <= 3600, 'the default deployed campaign fits one ID token');
  const refusals = [
    [{ EKI_LOAD_TARGET: 'http://127.0.0.1:3116', EKI_LOAD_CONFIRM_TARGET: 'http://127.0.0.1:3116' }, /https origin/],
    [{ EKI_LOAD_TARGET: 'https://127.0.0.1', EKI_LOAD_CONFIRM_TARGET: 'https://127.0.0.1' }, /loopback/],
    [{ EKI_LOAD_TARGET: 'https://bustrack-be165.web.app', EKI_LOAD_CONFIRM_TARGET: 'https://bustrack-be165.web.app' }, /Cloud Run service URL/],
    [{ EKI_LOAD_TARGET: 'https://eki-backend-production-449313371438.asia-south2.run.app',
      EKI_LOAD_CONFIRM_TARGET: 'https://eki-backend-production-449313371438.asia-south2.run.app' }, /production/],
    [{ EKI_LOAD_TARGET: `${origin}/` }, /no path/],
    [{ EKI_LOAD_CONFIRM_TARGET: `${origin} ` }, /repeat EKI_LOAD_TARGET exactly/],
    [{ EKI_LOAD_CONFIRM_TARGET: undefined }, /repeat EKI_LOAD_TARGET exactly/],
    [{ EKI_LOAD_EXPECTED_REVISION: 'eki-backend-loadtest-00012-x7q' }, /revision of eki-backend-staging/],
    [{ EKI_LOAD_DRILLS: 'dependency' }, /unknown entry dependency/],
    [{ EKI_LOAD_ADMIN_ID_TOKEN: undefined }, /required/],
    [{ EKI_LOAD_ADMIN_ID_TOKEN: 'not-a-token' }, /not a Firebase ID token/],
    [{ EKI_LOAD_ADMIN_ID_TOKEN: adminToken({ aud: 'eki-production', iss: 'https://securetoken.google.com/eki-production' }) }, /not issued for bustrack-be165/],
    [{ EKI_LOAD_ADMIN_ID_TOKEN: adminToken({ admin: false, role: 'passenger' }) }, /no administrator claims/],
    [{ EKI_LOAD_ADMIN_ID_TOKEN: adminToken({ exp: Math.floor(now / 1000) + 1800 }) }, /token life/],
  ];
  for (const [overrides, expected] of refusals) assert.throws(() => deployed(overrides), expected, JSON.stringify(overrides));
  assert.throws(() => deployed({}, { dirty: true }), /clean checkout/);
  assert.equal(deployed({}, { dirty: true, dryRun: true }).revision, 'eki-backend-staging-00012-x7q', 'a dry run may plan from a dirty tree');
  assert.deepEqual(deployed({ EKI_LOAD_PROFILES: 'soak,smoke', EKI_LOAD_DRILLS: 'latency' }).profiles, ['smoke', 'soak']);
});

const summary = (overrides = {}) => ({
  metrics: {
    http_reqs: { values: { count: 1000, rate: 8.2 } },
    iterations: { values: { count: 500 } },
    vus_max: { values: { max: 20 } },
    'http_req_duration{expected_response:true}': { values: { med: 3.2, 'p(95)': 12.5, 'p(99)': 40.1, max: 90 }, thresholds: { 'p(95)<800': { ok: true } } },
    http_req_failed: { values: { rate: 0.002, passes: 2, fails: 998 }, thresholds: { 'rate<0.01': { ok: true } } },
    checks: { values: { rate: 0.998, passes: 998, fails: 2 }, thresholds: { 'rate>0.99': { ok: true } } },
    eki_shed: { values: { rate: 0.001, passes: 1, fails: 999 }, thresholds: { 'rate<0.01': { ok: true } } },
    eki_rate_limited: { values: { rate: 0, passes: 0, fails: 1000 } },
    ...overrides,
  },
  state: { testRunDurationMs: 160123.4 },
});

test('a k6 summary reduces to numbers and threshold results', () => {
  const parsed = parseK6Summary(summary());
  assert.deepEqual(parsed.latencyMs, { p50: 3.2, p95: 12.5, p99: 40.1, max: 90 });
  assert.equal(parsed.requests, 1000);
  assert.deepEqual(parsed.shed, { count: 1, rate: 0.001 });
  assert.deepEqual(parsed.rateLimited, { count: 0, rate: 0 });
  assert.equal(parsed.thresholdsPassed, true);
  assert.equal(parsed.durationMs, 160123);
  const failed = parseK6Summary(summary({ checks: { values: { rate: 0.9, passes: 90, fails: 10 }, thresholds: { 'rate>0.99': { ok: false } } } }));
  assert.equal(failed.thresholdsPassed, false);
  assert.deepEqual(failed.thresholds.find(item => !item.ok), { metric: 'checks', expression: 'rate>0.99', ok: false });
  const empty = parseK6Summary({});
  assert.equal(empty.thresholdsPassed, false, 'a summary without thresholds never passes');
  assert.equal(empty.latencyMs.p95, null);
});

const sample = (at, good, extra = {}) => ({ at, kind: 'public', path: '/live', status: good ? 200 : null, error: good ? null : 'ECONNRESET',
  durationMs: 5, outcome: good ? 'ok' : 'error', good, ...extra });

test('a drill reports each phase, health degradation and the recovery time', () => {
  const samples = [];
  for (let at = 0; at < 10_000; at += 500) samples.push(sample(at, true));
  for (let at = 10_000; at < 20_000; at += 500) samples.push(sample(at, false));
  samples.push(sample(20_100, false, { durationMs: 900 }));
  for (let at = 21_500; at < 40_000; at += 500) samples.push(sample(at, true));
  samples.push({ ...sample(12_000, false), path: '/health', status: 503, error: null });
  samples.push({ ...sample(26_000, true), path: '/health' });
  samples.sort((a, b) => a.at - b.at);
  const result = analyzeDrill(samples, { faultStartMs: 10_000, faultEndMs: 20_000, endMs: 40_000 });
  assert.equal(result.phases.baseline.errors, 0);
  assert.equal(result.phases.fault.errorRate, 1);
  assert.equal(result.phases.fault.statuses.ECONNRESET, 20);
  assert.equal(result.recovered, true);
  assert.equal(result.recoveryMs, 1000, 'from removal to the end of the last bad probe');
  assert.deepEqual(result.health, { probes: 2, degraded: 1, firstDegradedAfterFaultMs: 2000, recoveredAfterFaultRemovedMs: 6000, recovered: true });
  const stuck = analyzeDrill([...samples, sample(39_000, false)], { faultStartMs: 10_000, faultEndMs: 20_000, endMs: 40_000 });
  assert.equal(stuck.recovered, false);
  assert.equal(stuck.recoveryMs, null);
  const clean = analyzeDrill(samples.filter(item => item.good), { faultStartMs: 10_000, faultEndMs: 20_000, endMs: 40_000 });
  assert.equal(clean.recoveryMs, 0);
  assert.equal(clean.health.recovered, true);
  assert.equal(clean.faultObserved, false, 'a fault that changed nothing is reported');
  assert.equal(result.faultObserved, true);
});

test('one dropped connection after recovery is within tolerance, and a client transport failure is not health degradation', () => {
  const samples = [];
  for (let at = 0; at < 50_000; at += 100) samples.push(sample(at, at < 10_000 || at >= 20_000));
  samples.find(item => item.at === 45_000).good = false;
  samples.push({ ...sample(30_000, false), path: '/health', error: 'TIMEOUT' });
  samples.sort((a, b) => a.at - b.at);
  const result = analyzeDrill(samples, { faultStartMs: 10_000, faultEndMs: 20_000, endMs: 50_000 });
  assert.equal(result.tolerance, 0.02);
  assert.equal(result.recovered, true);
  assert.equal(result.recoveryMs, 0);
  assert.equal(result.health.degraded, 0);
  const noisy = analyzeDrill(samples.map(item => (item.at >= 47_000 && item.at < 47_500 ? { ...item, good: false } : item)),
    { faultStartMs: 10_000, faultEndMs: 20_000, endMs: 50_000 });
  assert.equal(noisy.recovered, false, 'five bad probes in the last window are not noise');
  const controlled = analyzeDrill([...samples, ...[1000, 15_000, 48_000].map(at => ({ ...sample(at, true), route: 'direct', path: '/health' }))],
    { faultStartMs: 10_000, faultEndMs: 20_000, endMs: 50_000 });
  assert.deepEqual(controlled.phases, result.phases, 'direct control probes stay out of the client analysis');
  assert.deepEqual([controlled.direct.baseline.good, controlled.direct.fault.good, controlled.direct.recovery.good], [1, 1, 1]);
  assert.equal(result.direct, null);
});

const lease = (generation, ownerId = 'worker:3f6c', renewedAtMs = 1000) => ({ ownerId, generation, renewedAtMs, expiresAtMs: renewedAtMs + 45_000 });

test('lease continuity needs one owner and generation, unexpired at every read', () => {
  assert.deepEqual(parseLeaseDocument({ fields: { ownerId: { stringValue: 'worker:abc-1' }, generation: { integerValue: '7' },
    renewedAt: { timestampValue: '2026-11-24T10:00:00.123Z' }, expiresAt: { timestampValue: '2026-11-24T10:00:45.123Z' } } }),
  { ownerId: 'worker:abc-1', generation: 7, renewedAtMs: Date.parse('2026-11-24T10:00:00.123Z'), expiresAtMs: Date.parse('2026-11-24T10:00:45.123Z') });
  assert.equal(parseLeaseDocument({ fields: { ownerId: { stringValue: 'worker:<script>' } } }).ownerId, null);
  const steady = [0, 15_000, 30_000].map(at => ({ at: at + 2000, lease: lease(3, 'worker:3f6c', at + 1000) }));
  assert.equal(leaseContinuity(steady).continuous, true);
  assert.equal(leaseContinuity(steady).maxRenewalGapMs, 15_000);
  assert.equal(leaseContinuity([...steady, { at: 50_000, lease: lease(4, 'worker:3f6c', 49_000) }]).continuous, false, 'a new generation');
  assert.equal(leaseContinuity([...steady, { at: 50_000, lease: lease(3, 'worker:9e1d', 49_000) }]).continuous, false, 'another owner');
  assert.equal(leaseContinuity([...steady, { at: 90_000, lease: lease(3, 'worker:3f6c', 31_000) }]).continuous, false, 'expired when read');
  assert.equal(leaseContinuity([...steady, { at: 50_000, lease: null }]).continuous, false, 'an unreadable lease');
});

test('process-local counters that go backwards reveal a restart or a second instance', () => {
  const body = (fills, checkedAt, revision = 'eki-backend-staging-00012-x7q') => ({ status: 'ok', checkedAt,
    telemetry: { accepted: 5, apiReads: { routeCatalog: { hits: fills * 3, fills, failures: 0, invalidations: 0 }, 'bad name': { hits: 1 } },
      apiCompatibility: { 'catalog:legacy': { requests: fills } } },
    backgroundTasks: { totalFailures: 0 }, release: { revision, sourceSha: 'a'.repeat(40) } });
  const first = healthCounters(body(4, '2026-11-24T10:00:00.000Z'));
  assert.equal(first.counters['apiReads.routeCatalog.fills'], 4);
  assert.equal(Object.keys(first.counters).some(key => key.includes('bad name')), false);
  const reads = [
    { at: 1, ...first },
    { at: 2, ...healthCounters(body(9, '2026-11-24T10:00:30.000Z')) },
    { at: 3, ...healthCounters(body(2, '2026-11-24T10:00:31.000Z')) },
    { at: 4, ...healthCounters(body(3, '2026-11-24T10:00:20.000Z', 'eki-backend-staging-00013-abc')) },
  ];
  const result = detectProcessChanges(reads);
  assert.equal(result.changes.length, 2);
  assert(result.changes[0].decreased.includes('apiReads.routeCatalog.fills'));
  assert.equal(result.changes[1].probeRewound, true);
  assert.deepEqual(result.revisions, ['eki-backend-staging-00012-x7q', 'eki-backend-staging-00013-abc']);
});

test('resource growth is measured over the soak window only', () => {
  const log = [0, 1, 2, 3, 4].map(minute => JSON.stringify({ at: minute * 60_000, pid: 7, rss: 100e6 + minute * 1e6, heapUsed: 50e6 + minute * 2e6, activeResources: 30, sockets: 10, fds: null }))
    .join('\n') + '\n{"at": 1, "pid": "x"}\nnot json\n';
  const samples = parseResourceLog(log);
  assert.equal(samples.length, 5);
  const growth = resourceGrowth(samples, 60_000, 240_000);
  assert.equal(growth.samples, 4);
  assert.equal(growth.heapUsed.growth, 6e6);
  assert.equal(growth.heapUsed.slopePerMinute, 2e6);
  assert.equal(growth.fds, null, 'no descriptor count off Linux');
});

test('server values are rebuilt from fixed alphabets before they reach evidence', () => {
  assert.equal(canonicalStatus(503), 503);
  assert.equal(canonicalStatus(700), null);
  assert.equal(canonicalCount('12'), 12);
  assert.equal(canonicalCount(-1), null);
  assert.equal(canonicalId('eki-backend-staging-00012-x7q'), 'eki-backend-staging-00012-x7q');
  assert.equal(canonicalId('a b'), null);
});

test('logs and the report never carry a token, and the local report says it is bounded', () => {
  const token = adminToken();
  assert.equal(redactLog(`Authorization: Bearer ${token} and ${token}`, [token]).includes(token), false);
  assert.equal(redactLog('synthetic-device-secret-xyz', ['synthetic-device-secret-xyz']), '[REDACTED]');
  const report = {
    mode: 'local', sourceCommit: 'c'.repeat(40), dirty: false, verdict: 'WITHIN_THRESHOLDS', target: 'local', dryRun: false,
    scope: 'Bounded local run: not a capacity measurement and not a duration soak.', k6Version: 'v2.4.0', toxiproxyVersion: '2.13.0',
    profiles: [{ profile: 'load', peakVus: 20, summary: parseK6Summary(summary()) }],
    drills: [{ drill: 'latency', fault: 'latency', analysis: analyzeDrill([0, 6000, 12_000, 20_000, 28_000].map(at => sample(at, at !== 6000)),
      { faultStartMs: 5000, faultEndMs: 10_000, endMs: 30_000 }) }],
    process: { started: 1, unexpectedExits: 0, expectedChanges: 0, health: { reads: 3, changes: [], revisions: [null] } },
    lease: { soak: leaseContinuity([{ at: 2000, lease: lease(1) }, { at: 3000, lease: lease(1) }]) }, resources: null,
  };
  const markdown = renderMarkdown(report);
  assert.match(markdown, /not a capacity measurement and not a duration soak/);
  assert.match(markdown, /\| load \| 20 \| 160 \| 1000 \| 3\.2 \| 12\.5 \| 40\.1 \|/);
  assert.equal(markdown.includes('eyJ'), false);
  assert.equal(verdictFor(report), 'WITHIN_THRESHOLDS');
  assert.equal(verdictFor({ ...report, setupError: 'x' }), 'BLOCKED');
  assert.equal(verdictFor({ ...report, dryRun: true }), 'DRY_RUN');
  assert.equal(verdictFor({ ...report, process: { ...report.process, health: { changes: [{}] } } }), 'PROCESS_CHANGED');
  assert.equal(verdictFor({ ...report, process: { ...report.process, expectedChanges: 1, health: { changes: [{}] } } }), 'WITHIN_THRESHOLDS');
  assert.equal(verdictFor({ ...report, release: { before: { revision: 'a', sourceSha: 's' }, after: { revision: 'b', sourceSha: 's' } } }), 'REVISION_CHANGED');
  assert.equal(verdictFor({ ...report, lease: { soak: { continuous: false } } }), 'THRESHOLDS_FAILED');
  assert.equal(verdictFor({ ...report, drills: [{ analysis: { recovered: false } }] }), 'THRESHOLDS_FAILED');
  assert.equal(verdictFor({ ...report, process: { ...report.process, unexpectedExits: 1 } }), 'THRESHOLDS_FAILED');
});

test('the npm scripts and emulator runner expose the local and deployed modes', () => {
  const { scripts } = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'));
  assert.equal(scripts['qa:load'], 'npm run build --workspace=backend && node scripts/run-rules-emulator.mjs --load');
  assert.equal(scripts['qa:load:staging'], 'node scripts/qa/run-load.mjs --staging');
  const runner = readFileSync(resolve(repositoryRoot, 'scripts/run-rules-emulator.mjs'), 'utf8');
  assert.match(runner, /'--load'/);
  assert.match(runner, /scripts\/qa\/run-load\.mjs/);
  assert(Object.values(DRILLS).every(drill => drill.baselineS > 0 && drill.faultS > 0 && drill.recoveryS > 0));
  assert.equal(DRILLS.latency.toxic.attributes.latency, 800);
  assert(DRILLS.partition.toxic.toxicity > 0 && DRILLS.partition.toxic.toxicity < 1, 'a partial partition');
});
