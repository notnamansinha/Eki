import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { repositoryRoot } from './qa/acceptance-catalog.mjs';
import {
  BACKEND_SCOPE, HTTP_SCOPE, SDK_DEFAULT_BOUNDS,
  assertRelayRun, backendSources, canonicalTraceId, checkSelectors, createOtlpReceiver, dashboardSelectors, familyCollisions, flattenLogs, flattenMetrics, flattenSpans,
  histogramBuckets, latestSeries, metricCatalogFromSource, parseOtlpHeaders, prometheusName, redact, relayPayload, requestTraces,
  printableText, ruleSelectors, samplingBand, scanCanaries, selectorsOf, structuredLines, totalsBy,
} from './qa/observability-drill.mjs';

const { load } = createRequire(resolve(repositoryRoot, 'backend/package.json'))('js-yaml');
const string = value => ({ stringValue: value });
const int = value => ({ intValue: String(value) });
const kv = (key, value) => ({ key, value: typeof value === 'number' ? int(value) : string(value) });
const resource = { attributes: [kv('service.name', 'eki-backend'), kv('host.name', 'drill-host')] };
const traceA = 'a'.repeat(31) + '1';
const traceB = 'b'.repeat(31) + '2';

const tracesPayload = { signal: 'traces', body: { resourceSpans: [{ resource, scopeSpans: [{ scope: { name: HTTP_SCOPE }, spans: [
  { traceId: traceA, spanId: '1'.repeat(16), name: 'GET', kind: 2, status: { code: 0 }, attributes: [kv('http.response.status_code', 200)] },
  { traceId: traceB, spanId: '2'.repeat(16), name: 'GET', kind: 2, status: { code: 2 }, attributes: [kv('http.response.status_code', 503)] },
  { traceId: traceB, spanId: '3'.repeat(16), parentSpanId: '2'.repeat(16), name: 'middleware', kind: 1, status: { code: 2 },
    events: [{ name: 'exception', attributes: [kv('exception.type', 'Error')] }] },
] }] }] } };

const counterPoint = (status, value, time) => ({ attributes: [kv('http.response.status_code', status)], asDouble: value, timeUnixNano: String(time) });
const metricsPayload = time => ({ signal: 'metrics', body: { resourceMetrics: [{ resource, scopeMetrics: [{ scope: { name: BACKEND_SCOPE }, metrics: [
  { name: 'http.server.request.count', sum: { isMonotonic: true, aggregationTemporality: 2,
    dataPoints: [counterPoint(200, time === 1 ? 3 : 7, time), counterPoint(503, 1, time)] } },
  { name: 'http.server.request.duration', unit: 's', histogram: { aggregationTemporality: 2, dataPoints: [
    { attributes: [kv('http.response.status_code', 200)], count: String(time === 1 ? 3 : 7), sum: 0.1, bucketCounts: ['7'],
      explicitBounds: SDK_DEFAULT_BOUNDS, timeUnixNano: String(time) }] } },
] }] }] } });

test('OTLP JSON payloads flatten into spans, metrics and logs with attributes', () => {
  const spans = flattenSpans([tracesPayload]);
  assert.equal(spans.length, 3);
  assert.equal(spans[0].resource['service.name'], 'eki-backend');
  assert.equal(spans[1].attributes['http.response.status_code'], 503);
  assert.equal(spans[2].events[0].name, 'exception');
  const logs = flattenLogs([{ signal: 'logs', body: { resourceLogs: [{ resource, scopeLogs: [{ scope: { name: BACKEND_SCOPE }, logRecords: [
    { traceId: traceB, severityNumber: 13, body: string('[Places] Upstream request failed'), attributes: [kv('log.details', '[]')] },
  ] }] }] } }]);
  assert.deepEqual([logs[0].traceId, logs[0].severityNumber, logs[0].body], [traceB, 13, '[Places] Upstream request failed']);
});

test('cumulative metrics use the latest point per series, and totals group by an attribute', () => {
  const metrics = flattenMetrics([metricsPayload(1), metricsPayload(2)]);
  const counter = latestSeries(metrics, 'http.server.request.count', BACKEND_SCOPE);
  assert.deepEqual(totalsBy(counter, 'http.response.status_code'), { 200: 7, 503: 1 });
  const histogram = latestSeries(metrics, 'http.server.request.duration', BACKEND_SCOPE);
  assert.deepEqual(totalsBy(histogram, 'http.response.status_code'), { 200: 7 });
  assert.deepEqual(latestSeries(metrics, 'http.server.request.count', HTTP_SCOPE), [], 'scopes stay separate');
  const [bucket] = histogramBuckets(metrics);
  assert.equal(bucket.secondsWithDefaultBuckets, true, 'a seconds histogram on millisecond-scale default bounds is flagged');
});

test('request traces report export, error status and exception events per trace ID', () => {
  const spans = flattenSpans([tracesPayload]);
  const result = requestTraces([
    { label: 'ok', status: 200, traceId: traceA, sampledParent: true },
    { label: 'quota', status: 503, traceId: traceB, sampledParent: true },
    { label: 'lost', status: 200, traceId: 'c'.repeat(32), sampledParent: true },
    { label: 'root', status: 200, traceId: null },
  ], spans);
  assert.deepEqual(result.map(item => [item.label, item.exported, item.spanStatus, item.exceptionEvents]),
    [['ok', true, 0, 0], ['quota', true, 2, 1], ['lost', false, null, 0]]);
});

test('the receiver keeps JSON and gzip exports, rejects other content and runs the relay hook in order', async () => {
  const seen = [];
  const receiver = createOtlpReceiver({ onPayload: async payload => { seen.push(payload.signal); } });
  const port = await receiver.listen(0);
  try {
    const post = (path, body, headers = { 'Content-Type': 'application/json' }) =>
      fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers, body });
    assert.equal((await post('/v1/traces', JSON.stringify(tracesPayload.body))).status, 200);
    assert.equal((await post('/v1/metrics', gzipSync(JSON.stringify(metricsPayload(1).body)),
      { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })).status, 200);
    assert.equal((await post('/v1/logs', 'x', { 'Content-Type': 'application/x-protobuf' })).status, 415);
    assert.equal((await post('/v1/other', '{}')).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/v1/traces`)).status, 404);
    assert.deepEqual(receiver.payloads.map(payload => payload.signal), ['traces', 'metrics']);
    assert.deepEqual(seen, ['traces', 'metrics']);
    assert.equal(flattenMetrics(receiver.payloads).length, 2);
    assert.equal(receiver.rejected.length, 3);
  } finally { await receiver.close(); }
});

test('canary scanning finds whole and partial tokens and reports kinds, never values', () => {
  const token = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from('{"user_id":"uid-canary-123"}').toString('base64url')}.c2lnbmF0dXJlLXNpZ25hdHVyZQ`;
  const canaries = [{ kind: 'bearer-token', value: token }, { kind: 'uid', value: 'uid-canary-123' }, { kind: 'latitude', value: '23.00004' }];
  const findings = scanCanaries([
    { name: 'otlp-logs', text: `{"body":"payload ${token.split('.')[1]} only"}` },
    { name: 'stdout', text: '{"lat":23.0000432}\n{"lat":23.000043}' },
    { name: 'otlp-traces', text: 'nothing here' },
  ], canaries);
  assert.deepEqual(findings, [{ source: 'otlp-logs', kind: 'bearer-token-part', count: 1 }, { source: 'stdout', kind: 'latitude', count: 2 }]);
  assert(!JSON.stringify(findings).includes('uid-canary-123'));
  assert.throws(() => scanCanaries([], [{ kind: 'short', value: 'abc' }]), /too short/);
  assert.equal(redact(`token ${token} for uid-canary-123, Bearer abc.def`, ['uid-canary-123']), 'token [JWT] for [REDACTED], Bearer [REDACTED]');
});

test('stdout structure: JSON lines with level, time and message, trace IDs, and the known start-up banner', () => {
  const result = structuredLines(['[OpenTelemetry] Traces, metrics, and logs enabled.', '{"level":30,"time":"t","message":"a","trace_id":"' + traceA + '"}',
    '{"level":30,"time":"t","message":"b"}', 'plain text', '{"message":"no level"}', ''].join('\n'));
  assert.deepEqual([result.lines, result.json, result.knownPlain, result.withTraceId, result.unstructured],
    [5, 2, 1, 1, ['plain text', '{"message":"no level"}']]);
});

test('the sampling band accepts counts consistent with the ratio and rejects the others', () => {
  assert.equal(samplingBand(418, 40, 0.1).withinBand, true);
  assert.equal(samplingBand(418, 418, 0.1).withinBand, false, 'everything kept is not 10 %');
  assert.equal(samplingBand(418, 0, 0.1).withinBand, false, 'nothing kept is not 10 %');
  const band = samplingBand(418, 40, 0.1);
  assert(band.lower < 41.8 && band.upper > 41.8);
});

test('Prometheus names follow the OTLP translation: unit words, _total for monotonic sums, ratio for unit 1', () => {
  assert.equal(prometheusName({ name: 'http.server.request.count', type: 'sum', monotonic: true }), 'http_server_request_count_total');
  assert.equal(prometheusName({ name: 'http.server.request.duration', unit: 's', type: 'histogram' }), 'http_server_request_duration_seconds');
  assert.equal(prometheusName({ name: 'eki.process.heap.used', unit: 'By', type: 'gauge' }), 'eki_process_heap_used_bytes');
  assert.equal(prometheusName({ name: 'eki.device.telemetry.latency', unit: 'ms', type: 'gauge' }), 'eki_device_telemetry_latency_milliseconds');
  assert.equal(prometheusName({ name: 'eki.background.failures.total', type: 'sum', monotonic: true }), 'eki_background_failures_total');
  assert.equal(prometheusName({ name: 'http.server.active_requests', unit: '{request}', type: 'sum', monotonic: false }), 'http_server_active_requests');
  assert.equal(prometheusName({ name: 'eki.cache.hit', unit: '1', type: 'gauge' }), 'eki_cache_hit_ratio');
  assert.equal(prometheusName({ name: 'eki.rate', unit: 'By/s', type: 'gauge' }), 'eki_rate_bytes_per_second');
});

test('selectors parse from PromQL and LogQL, including bare names, skipping functions, clauses and durations', () => {
  assert.deepEqual(selectorsOf('histogram_quantile(0.95, sum by (le) (rate(x_bucket{service_name="eki-backend"}[5m])))'),
    [{ metric: 'x_bucket', labels: [{ name: 'service_name', op: '=', value: 'eki-backend' }] }]);
  assert.deepEqual(selectorsOf('{service_name="eki-backend"} |= "error"', 'logql'), [{ metric: null, labels: [{ name: 'service_name', op: '=', value: 'eki-backend' }] }]);
  assert.deepEqual(selectorsOf('sum by (source) (rate(a_total{source!=""}[5m]))').map(item => item.metric), ['a_total']);
  assert.deepEqual(selectorsOf('rate(foo_total[$__rate_interval]) > 1e3 and on (job) bar / clamp_min(baz, 0.001)').map(item => item.metric), ['foo_total', 'bar', 'baz']);
  assert.deepEqual(selectorsOf('label_replace(up, "dst", "$1", "src", "(.*)")').map(item => item.metric), ['up']);
  assert.deepEqual(selectorsOf('sum(count_over_time({app="x"} | json [5m]))', 'logql').map(item => item.metric), [null]);
});

test('a renamed metric, a wrong unit suffix and an unknown label are reported', () => {
  const catalog = [
    { name: 'http.server.request.count', unit: '', type: 'sum', monotonic: true, scope: BACKEND_SCOPE, attributeKeys: ['http.response.status_class'] },
    { name: 'eki.device.telemetry.latency', unit: 'ms', type: 'gauge', scope: BACKEND_SCOPE, attributeKeys: null },
  ];
  const selectors = selectorsOf('rate(http_server_request_count_total{service_name="eki-backend",http_response_status_class="5xx",route="x"}[5m])')
    .concat(selectorsOf('eki_device_telemetry_latency{statistic="p95"}'), selectorsOf('rate(http_server_requests_total[5m])'), selectorsOf('x{service_name="other"}'))
    .map(selector => ({ ...selector, file: 'f', where: 'w', language: 'promql' }));
  const problems = checkSelectors(selectors, catalog).map(item => item.problem);
  assert.equal(problems.length, 5);
  assert.match(problems[0], /has no label route/);
  assert.match(problems[1], /no instrument produces eki_device_telemetry_latency; nearest: eki_device_telemetry_latency_milliseconds/);
  assert.match(problems[2], /no instrument produces http_server_requests_total$/);
  assert.match(problems[3], /service_name="other" never matches/);
  assert.match(problems[4], /no instrument produces x$/);
  const unobserved = [{ ...catalog[0], attributeKeys: null }, { name: 'http.server.request.count.extra', type: 'sum', monotonic: true, scope: 'x', attributeKeys: [] }];
  assert.deepEqual(checkSelectors(selectors.slice(0, 1), unobserved), [], 'labels are not judged while an instrument of the family was not observed');
  assert.deepEqual(familyCollisions([...catalog, { name: 'http.server.request.count.total', type: 'sum', monotonic: true, scope: 'other' }]),
    [{ family: 'http_server_request_count_total', instruments: ['eki-backend:http.server.request.count', 'other:http.server.request.count.total'] }]);
});

test('alerting and recording rules are read like dashboard targets', () => {
  const rules = load('groups:\n  - name: eki\n    rules:\n      - alert: Eki5xxBurn\n        expr: sum(rate(http_server_request_count_total{http_response_status_class="5xx"}[5m])) > 0\n');
  assert.deepEqual(ruleSelectors(rules, 'r.yaml').map(item => [item.where, item.metric]), [['rule Eki5xxBurn', 'http_server_request_count_total']]);
});

// The hermetic CI check: every metric a committed dashboard or rule file
// queries must be produced by an instrument declared in backend/src.
// Directory entries carry their type, so no file is checked and then read.
function observabilitySelectors(directory = resolve(repositoryRoot, 'observability')) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    const file = relative(repositoryRoot, path).replaceAll('\\', '/');
    if (entry.isDirectory()) return observabilitySelectors(path);
    if (!entry.isFile()) return [];
    if (/\.json$/.test(entry.name)) {
      const document = JSON.parse(readFileSync(path, 'utf8'));
      return document.panels ? dashboardSelectors(document, file) : [];
    }
    if (/\.ya?ml$/.test(entry.name)) {
      const document = load(readFileSync(path, 'utf8'));
      return document?.groups ? ruleSelectors(document, file) : [];
    }
    return [];
  });
}

test('every metric the committed dashboards and alert rules query is produced by a backend instrument', () => {
  const { instruments, declarations } = metricCatalogFromSource(backendSources(repositoryRoot));
  assert(instruments.length > 0);
  assert.equal(instruments.length, declarations, 'every create<Instrument>( call is read');
  const selectors = observabilitySelectors();
  const dashboard = JSON.parse(readFileSync(resolve(repositoryRoot, 'observability/grafana/eki-backend-dashboard.json'), 'utf8'));
  const targets = dashboard.panels.flatMap(panel => panel.targets ?? []);
  assert.equal(new Set(selectors.filter(item => item.file.endsWith('eki-backend-dashboard.json')).map(item => item.expr)).size, targets.length,
    'every dashboard target yields at least one selector');
  assert.deepEqual(checkSelectors(selectors, instruments), []);
  assert(instruments.every(item => !item.source.includes('\\') && item.source.startsWith('backend/src/')), 'sources are repository-relative');
  // Two backend instruments share one Prometheus family. The dashboard reads
  // the per-source counter with source!=""; a new collision fails here.
  assert.deepEqual(familyCollisions(instruments).map(item => item.family), ['eki_background_failures_total']);
  for (const selector of selectors.filter(item => item.metric === 'eki_background_failures_total')) {
    assert(selector.labels.some(label => label.name === 'source' && label.op === '!=' && label.value === ''), selector.where);
  }
});

test('the relay guard needs an exact HTTPS confirmation and keeps credentials out of its summary', () => {
  const endpoint = 'https://otlp-gateway.example.invalid/otlp';
  const env = { EKI_OBS_OTLP_ENDPOINT: endpoint, EKI_OBS_CONFIRM_ENDPOINT: endpoint, EKI_OBS_OTLP_HEADERS: 'Authorization=Basic%20c2VjcmV0' };
  const relay = assertRelayRun(env);
  assert.deepEqual(relay.signalUrls, { traces: `${endpoint}/v1/traces`, metrics: `${endpoint}/v1/metrics`, logs: `${endpoint}/v1/logs` });
  assert.deepEqual(relay.headers, { Authorization: 'Basic c2VjcmV0' });
  assert.deepEqual(relay.headerNames, ['Authorization']);
  const refuse = (overrides, pattern) => assert.throws(() => assertRelayRun({ ...env, ...overrides }), pattern);
  refuse({ EKI_OBS_OTLP_ENDPOINT: '' }, /base URL of the throwaway collector/);
  refuse({ EKI_OBS_CONFIRM_ENDPOINT: undefined }, /must repeat/);
  refuse({ EKI_OBS_CONFIRM_ENDPOINT: `${endpoint}/` }, /must repeat/);
  for (const url of ['http://otlp.example.invalid', 'https://user:pass@otlp.example.invalid', 'https://otlp.example.invalid/?token=1']) {
    refuse({ EKI_OBS_OTLP_ENDPOINT: url, EKI_OBS_CONFIRM_ENDPOINT: url }, /HTTPS is required|no credentials/);
  }
  for (const url of ['https://127.0.0.1:4318', 'https://localhost', 'https://10.0.0.5', 'https://192.168.1.2', 'https://[::1]:4318']) {
    refuse({ EKI_OBS_OTLP_ENDPOINT: url, EKI_OBS_CONFIRM_ENDPOINT: url }, /loopback and private/);
  }
  for (const url of ['https://eki-backend-staging-449313371438.asia-south2.run.app', 'https://bustrack-be165.web.app', 'https://monitoring.googleapis.com']) {
    refuse({ EKI_OBS_OTLP_ENDPOINT: url, EKI_OBS_CONFIRM_ENDPOINT: url }, /Eki or Google service/);
  }
  refuse({ OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=x' }, /OTEL_EXPORTER_OTLP_HEADERS: unset it/);
  assert.throws(() => parseOtlpHeaders('Authorization'), /key=value/);
  assert.throws(() => parseOtlpHeaders('Bad Name=x'), /letters, digits and hyphens/);
});

test('the relay never forwards a payload holding a canary and posts clean ones only to the confirmed origin', async () => {
  const endpoint = 'https://otlp-gateway.example.invalid/otlp';
  const relay = assertRelayRun({ EKI_OBS_OTLP_ENDPOINT: endpoint, EKI_OBS_CONFIRM_ENDPOINT: endpoint, EKI_OBS_OTLP_HEADERS: 'Authorization=Basic%20c2VjcmV0' });
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { status: 200 }; };
  const canaries = [{ kind: 'device-secret', value: 'synthetic-browser-device-only' }];
  const leaked = await relayPayload({ signal: 'logs', text: '{"body":"Device synthetic-browser-device-only"}' }, { relay, canaries, fetchImpl });
  assert.deepEqual(leaked, { signal: 'logs', forwarded: false, reason: 'CANARY_FOUND', kinds: ['device-secret'] });
  assert.equal(calls.length, 0);
  const clean = await relayPayload({ signal: 'traces', text: '{"resourceSpans":[]}' }, { relay, canaries, fetchImpl });
  assert.deepEqual(clean, { signal: 'traces', forwarded: true, status: 200, accepted: true });
  assert.equal(calls[0].url, `${endpoint}/v1/traces`);
  assert.equal(calls[0].init.headers.Authorization, 'Basic c2VjcmV0');
  assert.equal(calls[0].init.redirect, 'error');
  const failed = await relayPayload({ signal: 'metrics', text: '{}' }, { relay, canaries, fetchImpl: async () => { throw new TypeError('fetch failed: Basic c2VjcmV0'); } });
  assert.deepEqual(failed, { signal: 'metrics', forwarded: false, reason: 'NETWORK_ERROR', error: 'TypeError' }, 'error text, which may echo a header, is not kept');
  const odd = await relayPayload({ signal: 'logs', text: '{}' }, { relay, canaries, fetchImpl: async () => ({ status: '200' }) });
  assert.deepEqual(odd, { signal: 'logs', forwarded: true, status: null, accepted: false }, 'a status outside the fixed list is not kept or accepted');
});

// canonicalStatus, canonicalText and canonicalCount come from dast-plan.mjs and are tested in qa-dast.test.mjs.
test('trace IDs and scraped text are rebuilt from fixed sets before they reach a request URL or a file', () => {
  assert.equal(canonicalTraceId(traceA), traceA);
  for (const value of ['0'.repeat(32), traceA.toUpperCase(), traceA.slice(1), `${traceA}0`, `../${traceA.slice(3)}`, null]) {
    assert.equal(canonicalTraceId(value), null, String(value));
  }
  assert.equal(printableText('# TYPE x counter\nx{a="b"}\t1\n'), '# TYPE x counter\nx{a="b"}\t1\n');
  assert.equal(printableText('x\u001b[31m\ré\u{1F600}'), 'x?[31m???');
});
