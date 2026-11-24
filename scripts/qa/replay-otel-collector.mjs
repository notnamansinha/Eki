import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRoot } from './acceptance-catalog.mjs';
import {
  SIGNALS, canonicalTraceId, checkSelectors, dashboardSelectors, flattenLogs, flattenMetrics, flattenSpans, metricCatalogFromExport,
  printableText, prometheusName, seriesNames,
} from './observability-drill.mjs';

/**
 * Replays the OTLP payloads of the last `npm run qa:observability` into the
 * repository's Collector configuration (observability/otel-collector.yaml)
 * and Jaeger, both in Docker and pinned by digest. It checks that the
 * Collector accepts every payload and forwards traces to Jaeger and metrics
 * and logs to its debug exporter. An overlay adds the Collector's Prometheus
 * exporter, so metric names come from the Collector's own OTLP-to-Prometheus
 * translation. Every port binds to 127.0.0.1. Not part of CI.
 */
export const COLLECTOR_IMAGE = 'otel/opentelemetry-collector:0.161.0@sha256:b6d2b9a85b1029d05b5ad913150c1f014eed4ae99be81a1813ca5ade4a191913';
export const JAEGER_IMAGE = 'jaegertracing/jaeger:2.21.0@sha256:3d0ac795ff98aa04d1be04311d2dac6c25b4bfc8322dc02e53bc5b170c5018c3';
const PORTS = { otlp: 19328, prometheus: 19889, jaeger: 19686 };

if (process.argv.length > 2) throw new Error('Usage: node scripts/qa/replay-otel-collector.mjs');
const evidence = resolve(repositoryRoot, 'artifacts/qa');
const drillDirectory = resolve(evidence, 'observability');
const workDirectory = resolve(evidence, 'observability-collector');
mkdirSync(workDirectory, { recursive: true });
const sleep = ms => new Promise(done => setTimeout(done, ms));
const docker = (args, options = {}) => spawnSync('docker', args, { encoding: 'utf8', ...options });
const git = args => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
const suffix = `${process.pid}`;
const names = { network: `eki-obs-replay-${suffix}`, collector: `eki-obs-collector-${suffix}`, jaeger: `eki-obs-jaeger-${suffix}` };

const report = {
  schemaVersion: 1, sourceCommit: git(['rev-parse', 'HEAD']), dirty: Boolean(git(['status', '--porcelain', '--untracked-files=all'])),
  startedAt: new Date().toISOString(), finishedAt: null, collectorImage: COLLECTOR_IMAGE, jaegerImage: JAEGER_IMAGE,
  collectorConfig: 'observability/otel-collector.yaml plus a Prometheus exporter overlay on the metrics pipeline',
  replayed: null, accepted: null, jaeger: null, debugExporter: null, prometheus: null, dashboard: null, p95: null,
  checks: [], verdict: 'BLOCKED', setupError: null,
};
const check = (id, description, pass, detail) => report.checks.push({ id, description, pass: Boolean(pass), detail });

/** Prometheus histogram_quantile: linear interpolation inside the bucket that holds the rank. */
export function histogramQuantile(q, buckets) {
  const sorted = [...buckets].sort((a, b) => a.le - b.le);
  const total = sorted.at(-1)?.count ?? 0;
  if (!total || sorted.at(-1).le !== Infinity) return null;
  const rank = q * total;
  let previous = { le: 0, count: 0 };
  for (const bucket of sorted) {
    if (bucket.count >= rank) {
      if (bucket.le === Infinity) return previous.le;
      const lower = previous.le;
      return lower + (bucket.le - lower) * ((rank - previous.count) / (bucket.count - previous.count || 1));
    }
    previous = bucket;
  }
  return null;
}

function parseExposition(text) {
  const types = new Map();
  const samples = [];
  for (const line of text.split('\n')) {
    const type = /^# TYPE (\S+) (\S+)/.exec(line);
    if (type) { types.set(type[1], type[2]); continue; }
    const sample = /^([A-Za-z_:][A-Za-z0-9_:]*)(\{(.*)\})?\s+(\S+)/.exec(line);
    if (!sample || line.startsWith('#')) continue;
    const labels = Object.fromEntries([...(sample[3] ?? '').matchAll(/([A-Za-z_][A-Za-z0-9_]*)="((?:[^"\\]|\\.)*)"/g)].map(([, key, value]) => [key, value]));
    samples.push({ name: sample[1], labels, value: Number(sample[4]) });
  }
  return { types, samples };
}

const cleanup = () => {
  for (const container of [names.collector, names.jaeger]) docker(['rm', '-f', container]);
  docker(['network', 'rm', names.network]);
};

try {
  const phases = ['always', 'default'].map(phase => resolve(drillDirectory, `${phase}-otlp.json`));
  if (!phases.every(existsSync)) throw new Error('Run npm run qa:observability first; artifacts/qa/observability/*-otlp.json is missing');
  const payloads = phases.flatMap(path => JSON.parse(readFileSync(path, 'utf8')));
  const drill = JSON.parse(readFileSync(resolve(evidence, 'observability-report.json'), 'utf8'));
  // Trace IDs from the drill report enter Jaeger URLs only as valid W3C IDs rebuilt from hex.
  const traceIds = drill.phases.find(phase => phase.phase === 'always').requests.map(request => canonicalTraceId(request.traceId)).filter(Boolean);
  if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) throw new Error('Docker is not running');

  const overlay = resolve(workDirectory, 'prometheus-overlay.yaml');
  writeFileSync(overlay, ['exporters:', '  prometheus:', '    endpoint: 0.0.0.0:8889', '    resource_to_telemetry_conversion:', '      enabled: true',
    'service:', '  pipelines:', '    metrics:', '      exporters: [debug, prometheus]', ''].join('\n'));
  cleanup();
  if (docker(['network', 'create', names.network]).status !== 0) throw new Error('docker network create failed');
  const jaeger = docker(['run', '-d', '--name', names.jaeger, '--network', names.network, '--network-alias', 'jaeger',
    '-p', `127.0.0.1:${PORTS.jaeger}:16686`, JAEGER_IMAGE]);
  if (jaeger.status !== 0) throw new Error(`Jaeger did not start: ${jaeger.stderr.slice(0, 200)}`);
  const collector = docker(['run', '-d', '--name', names.collector, '--network', names.network,
    '-p', `127.0.0.1:${PORTS.otlp}:4318`, '-p', `127.0.0.1:${PORTS.prometheus}:8889`,
    '-v', `${resolve(repositoryRoot, 'observability/otel-collector.yaml')}:/etc/otelcol/config.yaml:ro`,
    '-v', `${overlay}:/etc/otelcol/overlay.yaml:ro`,
    COLLECTOR_IMAGE, '--config=/etc/otelcol/config.yaml', '--config=/etc/otelcol/overlay.yaml'], { env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  if (collector.status !== 0) throw new Error(`The Collector did not start: ${collector.stderr.slice(0, 200)}`);

  // The path segment comes from the fixed signal list, never from the payload file.
  const post = (signal, body) => {
    const known = SIGNALS.find(item => item === signal);
    if (!known) return Promise.resolve(null);
    return fetch(`http://127.0.0.1:${PORTS.otlp}/v1/${known}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(10_000) }).then(response => response.status, () => null);
  };
  const ready = Date.now() + 60_000;
  while (await post('traces', '{"resourceSpans":[]}') !== 200) {
    if (Date.now() > ready) throw new Error('The Collector did not accept OTLP/HTTP within 60 s');
    await sleep(500);
  }
  const statuses = {};
  for (const payload of payloads) {
    const status = await post(payload.signal, JSON.stringify(payload.body));
    statuses[`${payload.signal} ${status}`] = (statuses[`${payload.signal} ${status}`] ?? 0) + 1;
  }
  report.replayed = Object.fromEntries(['traces', 'metrics', 'logs'].map(signal => [signal, payloads.filter(payload => payload.signal === signal).length]));
  report.accepted = statuses;
  check('collector-accepts', 'The repository Collector configuration answers 200 to every replayed OTLP/HTTP JSON payload',
    Object.keys(statuses).every(key => key.endsWith(' 200')), JSON.stringify(statuses));

  // Traces: the otlp/jaeger exporter forwards to Jaeger's OTLP gRPC receiver.
  let found = 0;
  const deadline = Date.now() + 30_000;
  for (const traceId of traceIds) {
    for (;;) {
      const response = await fetch(`http://127.0.0.1:${PORTS.jaeger}/api/traces/${traceId}`, { signal: AbortSignal.timeout(5_000) }).catch(() => null);
      const body = response?.ok ? await response.json().catch(() => null) : null;
      const services = new Set(Object.values(body?.data?.[0]?.processes ?? {}).map(process => process.serviceName));
      if (services.has('eki-backend')) { found++; break; }
      if (Date.now() > deadline) break;
      await sleep(500);
    }
  }
  report.jaeger = { requested: traceIds.length, found };
  check('collector-forwards-traces', 'Jaeger returns every drill request trace ID with service eki-backend', found === traceIds.length, `${found}/${traceIds.length}`);

  // Metrics and logs: the debug exporter prints counts at verbosity basic.
  await sleep(2_000);
  const log = docker(['logs', names.collector]);
  const text = `${log.stdout}\n${log.stderr}`;
  writeFileSync(resolve(workDirectory, 'collector.log'), text);
  const sum = pattern => [...text.matchAll(pattern)].reduce((total, match) => total + Number(match[1]), 0);
  const expectedLogs = flattenLogs(payloads).length;
  const expectedPoints = flattenMetrics(payloads).reduce((total, metric) => total + metric.points.length, 0);
  report.debugExporter = { logRecords: sum(/"log records": (\d+)/g), dataPoints: sum(/"data points": (\d+)/g), expectedLogRecords: expectedLogs, expectedDataPoints: expectedPoints,
    errors: text.split('\n').filter(line => /\terror\t/i.test(line)).length, warnings: text.split('\n').filter(line => /\twarn\t/i.test(line)).map(line => line.slice(0, 200)) };
  check('collector-forwards-logs', 'The debug exporter printed every replayed log record', report.debugExporter.logRecords === expectedLogs, `${report.debugExporter.logRecords}/${expectedLogs}`);
  check('collector-forwards-metrics', 'The debug exporter printed every replayed metric data point', report.debugExporter.dataPoints === expectedPoints, `${report.debugExporter.dataPoints}/${expectedPoints}`);

  // Prometheus names from the Collector's translator against this harness's.
  const scrape = await fetch(`http://127.0.0.1:${PORTS.prometheus}/metrics`, { signal: AbortSignal.timeout(10_000) }).then(response => response.text());
  writeFileSync(resolve(workDirectory, 'prometheus.txt'), printableText(scrape));
  const exposition = parseExposition(scrape);
  const instruments = metricCatalogFromExport(flattenMetrics(payloads));
  const mismatched = instruments.filter(item => !exposition.types.has(prometheusName(item))).map(item => `${item.scope}:${item.name} -> ${prometheusName(item)}`);
  report.prometheus = { families: exposition.types.size, instruments: instruments.length, translatorMismatches: mismatched,
    labelsOnRequestCount: [...new Set(exposition.samples.filter(sample => sample.name === 'http_server_request_count_total').flatMap(sample => Object.keys(sample.labels)))].sort() };
  check('translator-matches', 'prometheusName() gives the family name the Collector exposes for every exported instrument', mismatched.length === 0, mismatched.join('; ') || `${instruments.length} instruments`);

  // The committed dashboard against the names and labels the Collector exposes.
  const file = 'observability/grafana/eki-backend-dashboard.json';
  const selectors = dashboardSelectors(JSON.parse(readFileSync(resolve(repositoryRoot, file), 'utf8')), file).filter(item => item.language === 'promql');
  const series = new Map();
  for (const sample of exposition.samples) {
    const keys = series.get(sample.name) ?? new Set();
    for (const key of Object.keys(sample.labels)) keys.add(key);
    series.set(sample.name, keys);
  }
  const missing = [];
  for (const selector of selectors) {
    if (!series.has(selector.metric)) { missing.push(`${selector.where}: ${selector.metric} not exposed`); continue; }
    for (const label of selector.labels) if (!series.get(selector.metric).has(label.name)) missing.push(`${selector.where}: ${selector.metric} has no ${label.name}`);
  }
  report.dashboard = { selectors: selectors.length, unresolved: missing,
    harnessProblems: checkSelectors(selectors, instruments).map(problem => `${problem.where}: ${problem.problem}`) };
  check('dashboard-resolves', 'Every dashboard metric selector names a series, and labels, that the Collector exposes (metrics this drill does not exercise excepted)',
    missing.every(item => /eki_background_failures_total has no source/.test(item)), missing.join('; ') || 'all resolved');

  // What the p95 panel computes from these buckets.
  const buckets = exposition.samples.filter(sample => sample.name === 'http_server_request_duration_seconds_bucket' && sample.labels.service_name === 'eki-backend');
  const byLe = scope => {
    const totals = new Map();
    for (const sample of buckets.filter(item => !scope || item.labels.otel_scope_name === scope)) {
      const le = sample.labels.le === '+Inf' ? Infinity : Number(sample.labels.le);
      totals.set(le, (totals.get(le) ?? 0) + sample.value);
    }
    return [...totals].map(([le, count]) => ({ le, count }));
  };
  const totalOf = name => exposition.samples.filter(sample => sample.name === name && sample.labels.service_name === 'eki-backend' && sample.labels.otel_scope_name === '@opentelemetry/instrumentation-http')
    .reduce((total, sample) => total + sample.value, 0);
  report.p95 = {
    scopesInFamily: [...new Set(buckets.map(sample => sample.labels.otel_scope_name))].sort(),
    dashboardQuerySeconds: histogramQuantile(0.95, byLe(null)),
    ekiBackendScopeOnlySeconds: histogramQuantile(0.95, byLe('eki-backend')),
    instrumentationHttpOnlySeconds: histogramQuantile(0.95, byLe('@opentelemetry/instrumentation-http')),
    instrumentationHttpMeanSeconds: totalOf('http_server_request_duration_seconds_sum') / (totalOf('http_server_request_duration_seconds_count') || 1),
    note: 'Cumulative buckets of the replayed payloads; the panel applies rate() over 5 min to the same buckets.',
  };
  report.verdict = report.checks.every(item => item.pass) ? 'PASS' : 'FAIL';
} catch (error) {
  report.setupError = String(error.message).slice(0, 500);
} finally {
  cleanup();
}
report.finishedAt = new Date().toISOString();
writeFileSync(resolve(evidence, 'observability-collector-report.json'), JSON.stringify(report, null, 2) + '\n');
const lines = ['# Collector replay', '', `Source ${report.sourceCommit}; dirty: ${report.dirty}; verdict: ${report.verdict}.`, '',
  `Collector ${COLLECTOR_IMAGE}; Jaeger ${JAEGER_IMAGE}.`, '', ...(report.setupError ? [`Setup: ${report.setupError}`, ''] : []),
  '| Check | Result | Detail |', '|---|---|---|', ...report.checks.map(item => `| ${item.id} | ${item.pass ? 'PASS' : 'FAIL'} | ${String(item.detail).replace(/\|/g, '/').slice(0, 300)} |`), ''];
if (report.p95) {
  const format = value => value === null ? 'n/a' : `${value.toFixed(4)} s`;
  lines.push(`p95 from the dashboard query: ${format(report.p95.dashboardQuerySeconds)}; eki-backend histogram alone: ${format(report.p95.ekiBackendScopeOnlySeconds)}; `
    + `instrumentation-http histogram alone: ${format(report.p95.instrumentationHttpOnlySeconds)} (mean ${format(report.p95.instrumentationHttpMeanSeconds)}).`, '');
}
writeFileSync(resolve(evidence, 'observability-collector-report.md'), lines.join('\n'));
console.log(lines.join('\n'));
if (report.verdict !== 'PASS') process.exitCode = 1;
