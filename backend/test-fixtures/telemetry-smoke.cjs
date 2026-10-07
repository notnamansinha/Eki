const assert = require('node:assert/strict');
const mode = process.argv[2];
const telemetry = require('../src/instrumentation.ts');

async function main() {
  if (mode === 'disabled') {
    assert.equal(await telemetry.startTelemetry(), false);
    assert.equal(Object.keys(require.cache).some(file => /sdk-node|telemetrySdk|instrumentation-http/.test(file)), false);
    await telemetry.shutdownTelemetry();
    return;
  }
  const http = require('node:http');
  const exports = [];
  const collector = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { exports.push({ path: req.url, body: JSON.parse(body) }); res.end('{}'); });
  });
  await new Promise(resolve => collector.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${collector.address().port}`;
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = endpoint;
  for (const signal of ['TRACES', 'METRICS', 'LOGS']) {
    process.env[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`] = `${endpoint}/v1/${signal.toLowerCase()}`;
  }
  const first = telemetry.startTelemetry();
  assert.equal(first, telemetry.startTelemetry());
  assert.equal(await first, true);
  const { trace, context, TraceFlags, SpanKind } = require('@opentelemetry/api');
  // Respect sampled and unsampled parents even with a zero root ratio.
  const tracer = trace.getTracer('r31-smoke');
  for (const sampled of [false, true]) {
    const parent = trace.setSpanContext(context.active(), {
      traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), isRemote: true,
      traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    });
    const span = tracer.startSpan('parent-check', {}, parent);
    assert.equal(span.isRecording(), sampled);
    span.end();
  }
  assert.equal(tracer.startSpan('unsampled-root').isRecording(), false);

  // App modules are loaded AFTER awaited SDK start, as in bootstrap.
  const express = require('express');
  const app = express();
  app.get('/ride/:id', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const sampledParent = '00-' + 'c'.repeat(32) + '-' + 'd'.repeat(16) + '-01';
  const sampledContext = trace.setSpanContext(context.active(), {
    traceId: 'c'.repeat(32), spanId: 'd'.repeat(16), traceFlags: TraceFlags.SAMPLED, isRemote: true,
  });
  await new Promise((resolve, reject) => {
    context.with(sampledContext, () => http.get(`http://127.0.0.1:${server.address().port}/ride/PRIVATE_ID?search=SECRET_SEARCH`, {
      headers: { traceparent: sampledParent },
    }, res => { res.resume(); res.on('end', resolve); }).on('error', reject));
  });
  const { logs, SeverityNumber } = require('@opentelemetry/api-logs');
  logs.getLogger('r31-smoke').emit({ body: 'r31-log', severityNumber: SeverityNumber.INFO });
  const { metrics } = require('@opentelemetry/api');
  metrics.getMeter('r31-smoke').createCounter('r31.counter').add(1);
  await telemetry.shutdownTelemetry();
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => collector.close(resolve));
  const spans = exports.filter(item => item.path === '/v1/traces')
    .flatMap(item => item.body.resourceSpans ?? [])
    .flatMap(resource => resource.scopeSpans ?? [])
    .flatMap(scope => scope.spans ?? []);
  assert.ok(spans.some(span => span.kind === SpanKind.SERVER + 1), 'HTTP server span exported');
  assert.ok(spans.some(span => span.name.includes('/ride/:id')), 'Express route instrumentation exported');
  const httpSpans = spans.filter(span => span.kind === 2 || span.kind === 3);
  assert.ok(httpSpans.length > 0);
  assert.equal(JSON.stringify(httpSpans).includes('PRIVATE_ID'), false);
  assert.equal(JSON.stringify(httpSpans).includes('SECRET_SEARCH'), false);
  assert.ok(exports.some(item => item.path === '/v1/logs' && JSON.stringify(item.body).includes('r31-log')));
  assert.ok(exports.some(item => item.path === '/v1/metrics' && JSON.stringify(item.body).includes('r31.counter')));
}
main().then(() => { console.log('R31 smoke passed'); process.exit(0); })
  .catch(error => { console.error(error); process.exit(1); });
