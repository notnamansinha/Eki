// Local CPU/startup measurements only; never sends chat or touches Firebase.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const dist = resolve(process.env.R31_DIST || 'backend/dist');
const cases = {
  ordinary: 'Where is the bus? Please wait at the main gate.',
  clean500: 'Please wait at the bus stop. '.repeat(18).slice(0, 500),
  obfuscated: 'f.u.c.k sh1t fuuuck चूतिया b.h.e.n.c.h.o.d',
  repeatedPrefix: 'f' + 'u'.repeat(497) + 'x',
  overlappingSymbols: '$'.repeat(498) + 'x',
  unicode: '🚌'.repeat(250),
  formatting2000: '\u200B'.repeat(1500) + 'a'.repeat(500),
  rejected2001: 'a'.repeat(2001),
};
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)];
const moderation = {};
if (process.argv[2] === '--chat') {
  const input = process.argv[3];
  const { moderateChatText } = require(resolve(dist, 'services/chatRateLimit.js'));
  const coldStart = performance.now();
  const result = moderateChatText(input);
  const firstMs = performance.now() - coldStart;
  const cpuStart = process.cpuUsage();
  const times = [];
  for (let i = 0; i < 300; i++) {
    const start = performance.now();
    moderateChatText(input);
    times.push(performance.now() - start);
  }
  const cpu = process.cpuUsage(cpuStart);
  console.log(JSON.stringify({ length: input.length, accepted: result !== null, firstMs,
    p50Ms: quantile(times, 0.5), p95Ms: quantile(times, 0.95), maxMs: Math.max(...times),
    cpuMsPerCall: (cpu.user + cpu.system) / 1000 / times.length }));
  process.exit(0);
}
for (const [name, input] of Object.entries(cases)) {
  const child = spawnSync(process.execPath, [import.meta.filename, '--chat', input], {
    encoding: 'utf8', timeout: 5000, env: { ...process.env, R31_DIST: dist },
  });
  moderation[name] = child.error?.code === 'ETIMEDOUT'
    ? { length: input.length, timedOutMs: 5000 }
    : JSON.parse(child.stdout);
}
const startup = {};
for (const enabled of [false, true]) {
  const runs = [];
  for (let i = 0; i < 7; i++) {
    const child = spawnSync(process.execPath, ['-e', `
      const { performance } = require('node:perf_hooks');
      const start = performance.now(); const cpu = process.cpuUsage(); const memory = process.memoryUsage();
      const telemetry = require(${JSON.stringify(resolve(dist, 'instrumentation.js'))});
      Promise.resolve(telemetry.startTelemetry()).then(() => {
      const used = process.cpuUsage(cpu); const after = process.memoryUsage();
      console.log('R31=' + JSON.stringify({ wallMs: performance.now()-start, cpuMs: (used.user+used.system)/1000,
        rssDeltaMiB: (after.rss-memory.rss)/1048576, heapDeltaMiB: (after.heapUsed-memory.heapUsed)/1048576,
        loadedModules: Object.keys(require.cache).length }));
      telemetry.shutdownTelemetry().then(() => process.exit(0));
      });
    `], { encoding: 'utf8', timeout: 30000, env: { ...process.env,
      OTEL_SDK_DISABLED: enabled ? 'false' : 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:9/v1/traces',
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://127.0.0.1:9/v1/metrics',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://127.0.0.1:9/v1/logs',
      OTEL_EXPORTER_OTLP_HEADERS: '', OTEL_EXPORTER_OTLP_TRACES_HEADERS: '',
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: '', OTEL_EXPORTER_OTLP_LOGS_HEADERS: '',
      OTEL_RESOURCE_ATTRIBUTES: '', OTEL_TRACES_SAMPLER: '', OTEL_TRACES_SAMPLER_ARG: '',
      OTEL_LOGS_EXPORTER: 'none', OTEL_METRICS_EXPORTER: 'none', OTEL_TRACES_EXPORTER: 'none',
    } });
    if (child.status !== 0) throw new Error(child.stderr || `startup exited ${child.status}`);
    const line = child.stdout.split(/\r?\n/).find(value => value.startsWith('R31='));
    runs.push(JSON.parse(line.slice(4)));
  }
  startup[enabled ? 'enabled' : 'disabled'] = Object.fromEntries(
    Object.keys(runs[0]).map(key => [key, { p50: quantile(runs.map(run => run[key]), 0.5), max: Math.max(...runs.map(run => run[key])) }]),
  );
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  startupScope: 'instrumentation import + start, fresh processes; no app/Firebase; endpoint loopback discard',
  moderation, startup }, null, 2));
