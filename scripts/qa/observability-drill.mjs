import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { HEX_DIGITS, canonicalStatus, canonicalText } from './dast-plan.mjs';

/**
 * Pure logic and the loopback OTLP/HTTP JSON receiver for the observability
 * drill (qa/OBSERVABILITY_DRILL.md). scripts/qa/run-observability-drill.mjs
 * runs the drill; scripts/qa-observability.test.mjs tests this module.
 */

export const SERVICE_NAME = 'eki-backend';
export const BACKEND_SCOPE = 'eki-backend';
export const HTTP_SCOPE = '@opentelemetry/instrumentation-http';
export const DEFAULT_RECEIVER_PORT = 19318;
export const SIGNALS = ['traces', 'metrics', 'logs'];
// OTLP span kind SPAN_KIND_SERVER and status STATUS_CODE_ERROR.
export const SERVER_KIND = 2;
export const STATUS_ERROR = 2;
// The OpenTelemetry JS SDK default for histograms without bucket advice.
export const SDK_DEFAULT_BOUNDS = [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000];
const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;

// ---- OTLP/HTTP JSON receiver ------------------------------------------------

/**
 * Accepts OTLP/HTTP JSON exports on /v1/traces, /v1/metrics and /v1/logs and
 * keeps every payload in memory. `onPayload` runs before the response, so a
 * relay can scan and forward each payload in order.
 */
export function createOtlpReceiver({ onPayload } = {}) {
  const payloads = [];
  const rejected = [];
  const server = createServer((req, res) => {
    const signal = /^\/v1\/(traces|metrics|logs)$/.exec(req.url ?? '')?.[1];
    if (req.method !== 'POST' || !signal) {
      rejected.push({ method: req.method, path: (req.url ?? '').slice(0, 40), status: 404 });
      res.statusCode = 404; res.end(); return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_PAYLOAD_BYTES) req.destroy(); else chunks.push(chunk);
    });
    req.on('end', async () => {
      let raw = Buffer.concat(chunks);
      try {
        if (/gzip/i.test(req.headers['content-encoding'] ?? '')) raw = gunzipSync(raw);
      } catch { rejected.push({ signal, status: 400, reason: 'gzip' }); res.statusCode = 400; res.end(); return; }
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        rejected.push({ signal, status: 415, reason: 'content-type' }); res.statusCode = 415; res.end(); return;
      }
      const text = raw.toString('utf8');
      let body;
      try { body = JSON.parse(text); } catch { rejected.push({ signal, status: 400, reason: 'json' }); res.statusCode = 400; res.end(); return; }
      const payload = { signal, receivedAt: Date.now(), text, body };
      payloads.push(payload);
      try { await onPayload?.(payload); } catch { /* the relay records its own failures */ }
      res.setHeader('Content-Type', 'application/json');
      res.end('{}');
    });
  });
  return {
    payloads, rejected, server,
    listen: (port, host = '127.0.0.1') => new Promise((done, fail) => {
      server.once('error', fail);
      server.listen(port, host, () => done(server.address().port));
    }),
    close: () => new Promise(done => { server.closeAllConnections?.(); server.close(() => done()); }),
  };
}

// ---- OTLP JSON parsing -------------------------------------------------------

function attributeValue(value) {
  if (!value || typeof value !== 'object') return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('intValue' in value) return Number(value.intValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('boolValue' in value) return value.boolValue;
  if ('arrayValue' in value) return (value.arrayValue?.values ?? []).map(attributeValue);
  if ('kvlistValue' in value) return attributesOf(value.kvlistValue?.values);
  if ('bytesValue' in value) return value.bytesValue;
  return undefined;
}

export function attributesOf(list) {
  return Object.fromEntries((list ?? []).map(({ key, value }) => [key, attributeValue(value)]));
}

const bySignal = (payloads, signal) => payloads.filter(payload => payload.signal === signal).map(payload => payload.body ?? {});

export function flattenSpans(payloads) {
  return bySignal(payloads, 'traces').flatMap(body => (body.resourceSpans ?? []).flatMap(resource => {
    const resourceAttributes = attributesOf(resource.resource?.attributes);
    return (resource.scopeSpans ?? []).flatMap(scope => (scope.spans ?? []).map(span => ({
      resource: resourceAttributes, scope: scope.scope?.name ?? '',
      traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId || null,
      name: span.name, kind: span.kind, status: { code: span.status?.code ?? 0, message: span.status?.message ?? '' },
      attributes: attributesOf(span.attributes),
      events: (span.events ?? []).map(event => ({ name: event.name, attributes: attributesOf(event.attributes) })),
    })));
  }));
}

export function flattenLogs(payloads) {
  return bySignal(payloads, 'logs').flatMap(body => (body.resourceLogs ?? []).flatMap(resource => {
    const resourceAttributes = attributesOf(resource.resource?.attributes);
    return (resource.scopeLogs ?? []).flatMap(scope => (scope.logRecords ?? []).map(record => ({
      resource: resourceAttributes, scope: scope.scope?.name ?? '',
      traceId: record.traceId || null, spanId: record.spanId || null,
      severityNumber: record.severityNumber ?? 0, severityText: record.severityText ?? '',
      body: attributeValue(record.body), attributes: attributesOf(record.attributes),
    })));
  }));
}

const METRIC_TYPES = ['sum', 'gauge', 'histogram', 'exponentialHistogram', 'summary'];

export function flattenMetrics(payloads) {
  return bySignal(payloads, 'metrics').flatMap(body => (body.resourceMetrics ?? []).flatMap(resource => {
    const resourceAttributes = attributesOf(resource.resource?.attributes);
    return (resource.scopeMetrics ?? []).flatMap(scope => (scope.metrics ?? []).map(metric => {
      const type = METRIC_TYPES.find(name => metric[name]) ?? 'unknown';
      const data = metric[type] ?? {};
      return {
        resource: resourceAttributes, scope: scope.scope?.name ?? '', name: metric.name, unit: metric.unit ?? '', type,
        monotonic: type === 'sum' ? data.isMonotonic === true : false,
        temporality: data.aggregationTemporality ?? null,
        points: (data.dataPoints ?? []).map(point => ({
          attributes: attributesOf(point.attributes), time: Number(point.timeUnixNano ?? 0),
          value: point.asInt !== undefined ? Number(point.asInt) : point.asDouble,
          count: point.count !== undefined ? Number(point.count) : undefined, sum: point.sum,
          bucketCounts: point.bucketCounts?.map(Number), explicitBounds: point.explicitBounds,
        })),
      };
    }));
  }));
}

/**
 * The final cumulative value of each series of one instrument: the latest
 * point per attribute set, across every export. Cumulative temporality is the
 * SDK default, so the last export carries the process total.
 */
export function latestSeries(metrics, name, scope) {
  const latest = new Map();
  for (const metric of metrics.filter(item => item.name === name && item.scope === scope)) {
    for (const point of metric.points) {
      const key = JSON.stringify(Object.entries(point.attributes).sort());
      if (!latest.has(key) || latest.get(key).time <= point.time) latest.set(key, { ...point, unit: metric.unit });
    }
  }
  return [...latest.values()];
}

/** Totals per value of one attribute, from a counter's value or a histogram's count. */
export function totalsBy(series, attribute) {
  const totals = {};
  for (const point of series) {
    const key = String(point.attributes[attribute]);
    totals[key] = (totals[key] ?? 0) + (point.count ?? point.value ?? 0);
  }
  return totals;
}

// ---- Drill checks ------------------------------------------------------------

export const isTraceId = value => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value) && !/^0+$/.test(value);

/** A W3C traceparent for a request the harness can later find by trace ID. */
export function traceparent(traceId, spanId, sampled) {
  return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
}

export function serverSpans(spans) {
  return spans.filter(span => span.kind === SERVER_KIND && span.resource['service.name'] === SERVICE_NAME);
}

/** Requests the harness sent with a trace ID, and the server span exported for each. */
export function requestTraces(requests, spans) {
  const servers = serverSpans(spans);
  return requests.filter(request => request.traceId).map(request => {
    const span = servers.find(item => item.traceId === request.traceId);
    const trace = spans.filter(item => item.traceId === request.traceId);
    return {
      label: request.label, status: request.status, traceId: request.traceId, sampledParent: request.sampledParent,
      exported: Boolean(span), spanStatus: span?.status.code ?? null,
      responseStatusAttribute: span?.attributes['http.response.status_code'] ?? null,
      spansInTrace: trace.length,
      exceptionEvents: trace.reduce((count, item) => count + item.events.filter(event => event.name === 'exception').length, 0),
    };
  });
}

/** Expected request counts per response status, from what the harness observed. */
export function statusCounts(requests) {
  const counts = {};
  for (const request of requests) if (typeof request.status === 'number') counts[request.status] = (counts[request.status] ?? 0) + 1;
  return counts;
}

export function sameCounts(expected, actual) {
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  return [...keys].every(key => (expected[key] ?? 0) === (actual[key] ?? 0));
}

// startTelemetry() prints this before bootstrap installs the console bridge,
// so it is plain text in every environment.
export const KNOWN_PLAIN_LINES = ['[OpenTelemetry] Traces, metrics, and logs enabled.'];

/**
 * Stdout of the backend: every line must be one JSON object with level, time
 * and message, apart from the known start-up lines, which are counted.
 */
export function structuredLines(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  let json = 0;
  let known = 0;
  let withTraceId = 0;
  const unstructured = [];
  for (const line of lines) {
    let record = null;
    try { record = JSON.parse(line); } catch { /* counted below */ }
    if (record && typeof record === 'object' && 'level' in record && 'time' in record && 'message' in record) {
      json++;
      if (isTraceId(record.trace_id)) withTraceId++;
    } else if (KNOWN_PLAIN_LINES.includes(line.trim())) known++;
    else unstructured.push(line.slice(0, 120));
  }
  return { lines: lines.length, json, knownPlain: known, withTraceId, unstructured };
}

/**
 * Canary forms to search for. Each planted value is searched whole and, for
 * tokens, by each of its parts, so a truncated or split copy is still found.
 */
export function canaryForms(canaries) {
  const forms = [];
  for (const { kind, value } of canaries) {
    if (typeof value !== 'string' || value.length < 6) throw new Error(`Canary ${kind} is too short to search for`);
    forms.push({ kind, value });
    if (kind === 'bearer-token') for (const part of value.split('.')) if (part.length >= 16) forms.push({ kind: `${kind}-part`, value: part });
  }
  return forms;
}

/** Where each canary appears. The result names sources and kinds, never values. */
export function scanCanaries(sources, canaries) {
  const forms = canaryForms(canaries);
  const findings = [];
  for (const { name, text } of sources) {
    for (const { kind, value } of forms) {
      let count = 0;
      for (let index = text.indexOf(value); index !== -1; index = text.indexOf(value, index + value.length)) count++;
      if (count) findings.push({ source: name, kind, count });
    }
  }
  return findings;
}

/** Replaces every canary form and secret with a marker before text enters a report. */
export function redact(text, values) {
  let output = String(text);
  const sorted = [...new Set(values.filter(value => typeof value === 'string' && value.length >= 6))].sort((a, b) => b.length - a.length);
  for (const value of sorted) output = output.split(value).join('[REDACTED]');
  return output.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[JWT]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]');
}

// Values that a server or an earlier run's file supplies reach the evidence,
// or a request URL, only after they are rebuilt from fixed sets, with the
// DAST harness's canonicalStatus, canonicalText and canonicalCount or the two
// helpers below. That validates them and keeps unchecked bytes out (CodeQL
// js/http-to-file-access and js/file-access-to-http).
const PRINTABLE = Object.freeze(['\t', '\n', ...Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index))]);

/** A valid W3C trace ID rebuilt from lowercase hex digits, or null. */
export function canonicalTraceId(value) {
  return isTraceId(value) ? canonicalText(value, HEX_DIGITS, 32) : null;
}

/** `text` rebuilt from printable ASCII, tab and newline; any other character becomes `?`. */
export function printableText(text) {
  return [...String(text)].map(character => PRINTABLE.find(candidate => candidate === character) ?? '?').join('');
}

/**
 * Whether `kept` of `sent` independent root traces is consistent with ratio
 * `p`: a two-sided normal-approximation band at z (3.29 is 99.9 %).
 */
export function samplingBand(sent, kept, p, z = 3.29) {
  const expected = sent * p;
  const spread = z * Math.sqrt(sent * p * (1 - p));
  const lower = Math.max(0, Math.floor(expected - spread));
  const upper = Math.min(sent, Math.ceil(expected + spread));
  return { sent, kept, ratio: p, expected, lower, upper, observedRatio: sent ? kept / sent : null, withinBand: kept >= lower && kept <= upper };
}

/** Each histogram's unit and bucket bounds, flagging seconds with the SDK's millisecond-scale defaults. */
export function histogramBuckets(metrics) {
  const seen = new Map();
  for (const metric of metrics.filter(item => item.type === 'histogram')) {
    const key = `${metric.scope}|${metric.name}`;
    const bounds = metric.points.find(point => point.explicitBounds)?.explicitBounds;
    if (!bounds || seen.has(key)) continue;
    seen.set(key, { scope: metric.scope, name: metric.name, unit: metric.unit, bounds,
      secondsWithDefaultBuckets: metric.unit === 's' && JSON.stringify(bounds) === JSON.stringify(SDK_DEFAULT_BOUNDS) });
  }
  return [...seen.values()];
}

// ---- OTLP to Prometheus names ------------------------------------------------

// The unit suffixes of the OTLP-to-Prometheus translation used by the
// Collector Prometheus exporters and Prometheus' own OTLP receiver.
const UNIT_WORDS = {
  d: 'days', h: 'hours', min: 'minutes', s: 'seconds', ms: 'milliseconds', us: 'microseconds', ns: 'nanoseconds',
  By: 'bytes', KiBy: 'kibibytes', MiBy: 'mebibytes', GiBy: 'gibibytes', TiBy: 'tibibytes',
  KBy: 'kilobytes', MBy: 'megabytes', GBy: 'gigabytes', TBy: 'terabytes',
  m: 'meters', V: 'volts', A: 'amperes', J: 'joules', W: 'watts', g: 'grams', Cel: 'celsius', Hz: 'hertz', '%': 'percent',
};
const PER_UNIT_WORDS = { s: 'second', m: 'minute', h: 'hour', d: 'day', w: 'week', mo: 'month', y: 'year' };

function unitWord(unit, words) {
  const value = unit.trim();
  if (!value || value.includes('{')) return '';
  return words[value] ?? value.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Maps an instrument kind from the API (`createCounter`) or OTLP (`sum`) to its point type. */
export function pointType(kind, monotonic) {
  if (/^(Counter|ObservableCounter)$/.test(kind)) return { type: 'sum', monotonic: true };
  if (/^(UpDownCounter|ObservableUpDownCounter)$/.test(kind)) return { type: 'sum', monotonic: false };
  if (/^Histogram$/.test(kind)) return { type: 'histogram', monotonic: false };
  if (/^(Gauge|ObservableGauge)$/.test(kind)) return { type: 'gauge', monotonic: false };
  return { type: kind, monotonic: Boolean(monotonic) };
}

/**
 * The Prometheus metric family name for an OTLP metric, with unit and type
 * suffixes: `http.server.request.duration` in `s` becomes
 * `http_server_request_duration_seconds`; a monotonic sum ends in `_total`.
 */
export function prometheusName({ name, unit = '', type, monotonic = false }) {
  let tokens = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const [main, per] = unit.includes('/') ? unit.split('/', 2) : [unit, ''];
  const mainWord = unitWord(main, UNIT_WORDS);
  if (mainWord && mainWord !== '1' && !tokens.includes(mainWord)) tokens.push(mainWord);
  const perWord = unitWord(per, PER_UNIT_WORDS);
  if (perWord && !tokens.includes(perWord)) tokens.push('per', perWord);
  if (type === 'sum' && monotonic) tokens = [...tokens.filter(token => token !== 'total'), 'total'];
  if (type === 'gauge' && unit.trim() === '1') tokens = [...tokens.filter(token => token !== 'ratio'), 'ratio'];
  return tokens.join('_');
}

export const prometheusLabel = key => key.replace(/[^A-Za-z0-9_]/g, '_');

/** The series names a family exposes: histograms add bucket, sum and count. */
export function seriesNames(family, type) {
  return type === 'histogram' ? [`${family}_bucket`, `${family}_sum`, `${family}_count`] : [family];
}

const INSTRUMENT = /\.create(Counter|UpDownCounter|Histogram|Gauge|ObservableGauge|ObservableCounter|ObservableUpDownCounter)\(\s*"([^"]+)"\s*(?:,\s*\{([^}]*)\})?/g;

/**
 * Every non-test TypeScript file under `backend/src` of `root`, with its path
 * relative to `root`. Directory entries carry their type, so no file is
 * checked and then read.
 */
export function backendSources(root, directory = resolve(root, 'backend/src')) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return backendSources(root, path);
    return entry.isFile() && /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)
      ? [{ path: relative(root, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf8') }] : [];
  });
}

/**
 * Instruments declared in backend sources. `declarations` counts every
 * `.create<Instrument>(` call, so a declaration the pattern cannot read is
 * reported instead of being skipped.
 */
export function metricCatalogFromSource(files) {
  const instruments = [];
  let declarations = 0;
  for (const { path, text } of files) {
    declarations += (text.match(/\.create(Counter|UpDownCounter|Histogram|Gauge|ObservableGauge|ObservableCounter|ObservableUpDownCounter)\(/g) ?? []).length;
    for (const match of text.matchAll(INSTRUMENT)) {
      const unit = /unit:\s*"([^"]*)"/.exec(match[3] ?? '')?.[1] ?? '';
      instruments.push({ name: match[2], unit, ...pointType(match[1]), scope: BACKEND_SCOPE, source: path, attributeKeys: null });
    }
  }
  return { instruments, declarations };
}

/** The instruments a drill run exported, with the attribute keys each one carried. */
export function metricCatalogFromExport(metrics) {
  const byKey = new Map();
  for (const metric of metrics) {
    const key = `${metric.scope}|${metric.name}`;
    const entry = byKey.get(key) ?? { name: metric.name, unit: metric.unit, type: metric.type, monotonic: metric.monotonic,
      scope: metric.scope, source: 'export', attributeKeys: new Set(), resourceKeys: new Set(Object.keys(metric.resource)) };
    for (const point of metric.points) for (const attribute of Object.keys(point.attributes)) entry.attributeKeys.add(attribute);
    byKey.set(key, entry);
  }
  return [...byKey.values()].map(entry => ({ ...entry, attributeKeys: [...entry.attributeKeys].sort(), resourceKeys: [...entry.resourceKeys].sort() }));
}

export function prometheusFamilies(instruments) {
  const families = new Map();
  for (const instrument of instruments) {
    const family = prometheusName(instrument);
    families.set(family, [...(families.get(family) ?? []), instrument]);
  }
  return families;
}

/** Families that more than one instrument maps to; their series merge in Prometheus. */
export function familyCollisions(instruments) {
  return [...prometheusFamilies(instruments)].filter(([, members]) => members.length > 1)
    .map(([family, members]) => ({ family, instruments: members.map(member => `${member.scope}:${member.name}`).sort() }));
}

// ---- Dashboard and alert-rule selectors --------------------------------------

const SELECTOR = /(?<![A-Za-z0-9_:$])([A-Za-z_:][A-Za-z0-9_:]*)?\s*\{((?:[^{}"]|"(?:[^"\\]|\\.)*")*)\}/g;
const MATCHER = /([A-Za-z_][A-Za-z0-9_]*)\s*(=~|!~|!=|=)\s*"((?:[^"\\]|\\.)*)"/g;
const PROMQL_WORDS = new Set(['by', 'without', 'on', 'ignoring', 'group_left', 'group_right', 'offset', 'bool', 'and', 'or', 'unless', 'inf', 'nan', 'atan2']);

/**
 * Metric selectors in one PromQL or LogQL expression: `name{...}`, `{...}`
 * and, in PromQL, a bare `name` such as the one in `rate(name[5m])`.
 * Functions, grouping clauses, durations, strings and keywords are skipped.
 */
export function selectorsOf(expr, language = 'promql') {
  const selectors = [];
  let rest = String(expr).replace(SELECTOR, (_, metric, body) => {
    const labels = [...body.matchAll(MATCHER)].map(([, name, op, value]) => ({ name, op, value }));
    selectors.push({ metric: metric && !PROMQL_WORDS.has(metric.toLowerCase()) ? metric : null, labels });
    return ' ';
  });
  if (language !== 'promql') return selectors;
  rest = rest.replace(/"(?:[^"\\]|\\.)*"/g, ' ').replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/gi, ' ');
  for (const [, metric] of rest.matchAll(/(?<![A-Za-z0-9_:.$])([A-Za-z_:][A-Za-z0-9_:]*)(?!\s*\(|[A-Za-z0-9_:])/g)) {
    if (!PROMQL_WORDS.has(metric.toLowerCase())) selectors.push({ metric, labels: [] });
  }
  return selectors;
}

/** Selectors from a Grafana dashboard, by panel. */
export function dashboardSelectors(dashboard, file) {
  const panels = [...(dashboard.panels ?? []), ...(dashboard.panels ?? []).flatMap(panel => panel.panels ?? [])];
  return panels.flatMap(panel => (panel.targets ?? []).flatMap(target => {
    const datasource = target.datasource?.uid ?? panel.datasource?.uid ?? '';
    const language = /loki/i.test(datasource) || target.expr?.trim().startsWith('{') ? 'logql' : 'promql';
    return selectorsOf(target.expr ?? '', language).map(selector => ({ file, where: `panel ${panel.id} "${panel.title}"`, language, expr: target.expr, ...selector }));
  }));
}

/** Selectors from Prometheus alerting or recording rule groups. */
export function ruleSelectors(document, file) {
  return (document?.groups ?? []).flatMap(group => (group.rules ?? []).flatMap(rule =>
    selectorsOf(String(rule.expr ?? '')).map(selector => ({ file, where: `rule ${rule.alert ?? rule.record}`, language: 'promql', expr: rule.expr, ...selector }))));
}

// Labels added from the resource or by Prometheus itself, not from point attributes.
const RESOURCE_LABELS = new Map([['service_name', 'service.name'], ['job', 'service.name'], ['instance', 'service.instance.id']]);
const SERIES_LABELS = new Set(['le', '__name__', 'otel_scope_name', 'otel_scope_version']);

/**
 * Problems with selectors against a metric catalog: a metric no instrument
 * produces, a histogram series on a non-histogram, or (when the catalog has
 * attribute keys, as an exported catalog does) a label no point carries.
 */
export function checkSelectors(selectors, instruments) {
  const families = prometheusFamilies(instruments);
  const series = new Map();
  for (const [family, members] of families) for (const name of seriesNames(family, members[0].type)) series.set(name, { family, members });
  const problems = [];
  for (const selector of selectors) {
    for (const label of selector.labels) {
      if (label.name === 'service_name' && label.op === '=' && label.value !== SERVICE_NAME) {
        problems.push({ ...where(selector), problem: `service_name="${label.value}" never matches: the SDK sets service.name to ${SERVICE_NAME}` });
      }
    }
    if (selector.language === 'logql' || !selector.metric) continue;
    const match = series.get(selector.metric);
    if (!match) {
      const near = [...series.keys()].filter(name => name.startsWith(selector.metric) || selector.metric.startsWith(name.replace(/_(bucket|sum|count|total)$/, '')));
      problems.push({ ...where(selector), problem: `no instrument produces ${selector.metric}${near.length ? `; nearest: ${near.join(', ')}` : ''}` });
      continue;
    }
    // Labels are checked only when every instrument of the family was observed.
    if (match.members.some(member => !Array.isArray(member.attributeKeys))) continue;
    const keys = new Set(match.members.flatMap(member => member.attributeKeys.map(prometheusLabel)));
    for (const label of selector.labels) {
      if (RESOURCE_LABELS.has(label.name) || SERIES_LABELS.has(label.name)) continue;
      if (!keys.has(label.name)) problems.push({ ...where(selector), problem: `${selector.metric} has no label ${label.name}; points carry ${[...keys].sort().join(', ') || 'none'}` });
    }
  }
  return problems;
}

function where(selector) {
  return { file: selector.file, where: selector.where, metric: selector.metric };
}

// ---- Deployed collector relay guard -----------------------------------------

const LOOPBACK_OR_PRIVATE = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1?\]|\[f[cd][0-9a-f:]*\]|\[fe80:[0-9a-f:]*\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+)$/i;
// Eki's own services are never a collector: the backend, Hosting and Firebase.
const EKI_SERVICE_HOSTS = [/^eki-backend[a-z0-9-]*\.[a-z0-9.-]*run\.app$/i, /\.web\.app$/i, /\.firebaseapp\.com$/i,
  /\.firebaseio\.com$/i, /\.firebasedatabase\.app$/i, /(^|\.)googleapis\.com$/i];

/** Parses OTEL_EXPORTER_OTLP_HEADERS syntax: comma-separated key=value with percent-encoded values. */
export function parseOtlpHeaders(value) {
  const headers = {};
  for (const item of String(value ?? '').split(',').map(part => part.trim()).filter(Boolean)) {
    const index = item.indexOf('=');
    if (index <= 0) throw new Error('EKI_OBS_OTLP_HEADERS: use key=value pairs separated by commas');
    const key = item.slice(0, index).trim();
    if (!/^[A-Za-z0-9-]+$/.test(key)) throw new Error('EKI_OBS_OTLP_HEADERS: header names may contain letters, digits and hyphens only');
    let decoded;
    try { decoded = decodeURIComponent(item.slice(index + 1).trim()); } catch { throw new Error(`EKI_OBS_OTLP_HEADERS: the value of ${key} is not percent-encoded correctly`); }
    headers[key] = decoded;
  }
  return headers;
}

/**
 * Validates a relay run to a non-loopback collector. The exact endpoint must
 * be repeated in EKI_OBS_CONFIRM_ENDPOINT; credentials stay in
 * EKI_OBS_OTLP_HEADERS and only their names are returned for reports.
 */
export function assertRelayRun(env) {
  const raw = env.EKI_OBS_OTLP_ENDPOINT?.trim();
  if (!raw) throw new Error('EKI_OBS_OTLP_ENDPOINT: the base URL of the throwaway collector is required');
  let url;
  try { url = new URL(raw); } catch { throw new Error('EKI_OBS_OTLP_ENDPOINT: invalid URL'); }
  if (url.protocol !== 'https:') throw new Error('EKI_OBS_OTLP_ENDPOINT: HTTPS is required for a remote collector');
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('EKI_OBS_OTLP_ENDPOINT: no credentials, query or fragment; put credentials in EKI_OBS_OTLP_HEADERS');
  }
  if (LOOPBACK_OR_PRIVATE.test(url.hostname)) {
    throw new Error('EKI_OBS_OTLP_ENDPOINT: loopback and private hosts are not a deployed collector; use npm run qa:observability');
  }
  if (EKI_SERVICE_HOSTS.some(pattern => pattern.test(url.hostname))) {
    throw new Error('EKI_OBS_OTLP_ENDPOINT: names an Eki or Google service, not a collector');
  }
  if (env.EKI_OBS_CONFIRM_ENDPOINT !== raw) {
    throw new Error('EKI_OBS_CONFIRM_ENDPOINT must repeat EKI_OBS_OTLP_ENDPOINT exactly');
  }
  for (const key of Object.keys(env)) {
    if (/^OTEL_EXPORTER_OTLP_.*(ENDPOINT|HEADERS)$/.test(key) && env[key]?.trim()) {
      throw new Error(`${key}: unset it; the relay alone talks to the remote collector`);
    }
  }
  const headers = parseOtlpHeaders(env.EKI_OBS_OTLP_HEADERS);
  const base = url.href.replace(/\/+$/, '');
  return {
    origin: url.origin,
    signalUrls: Object.fromEntries(SIGNALS.map(signal => [signal, `${base}/v1/${signal}`])),
    headers, headerNames: Object.keys(headers).sort(),
  };
}

/**
 * Forwards one payload to the confirmed collector unless it holds a canary.
 * A payload with a canary is never sent, so a redaction failure stays local.
 */
export async function relayPayload(payload, { relay, canaries, fetchImpl = fetch, timeoutMs = 10_000 }) {
  const findings = scanCanaries([{ name: payload.signal, text: payload.text }], canaries);
  if (findings.length) return { signal: payload.signal, forwarded: false, reason: 'CANARY_FOUND', kinds: [...new Set(findings.map(item => item.kind))] };
  const target = relay.signalUrls[payload.signal];
  if (!target || new URL(target).origin !== relay.origin) return { signal: payload.signal, forwarded: false, reason: 'UNKNOWN_SIGNAL' };
  try {
    const response = await fetchImpl(target, {
      method: 'POST', headers: { ...relay.headers, 'Content-Type': 'application/json' }, body: payload.text,
      redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    });
    const status = canonicalStatus(response.status);
    return { signal: payload.signal, forwarded: true, status, accepted: status !== null && status >= 200 && status < 300 };
  } catch (error) {
    return { signal: payload.signal, forwarded: false, reason: 'NETWORK_ERROR', error: String(error?.name ?? 'Error').slice(0, 40) };
  }
}
