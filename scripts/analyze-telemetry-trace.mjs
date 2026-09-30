import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEVICE_TRACE_PREFIX = "[TelemetryTrace] ";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function traceKey(record) {
  const seq = finite(record.seq);
  const sampledAt = finite(record.sampledAtDeviceMs);
  return seq === null || sampledAt === null ? null : `${seq}:${sampledAt}`;
}

export function percentileSummary(values) {
  const sorted = values.filter((value) => finite(value) !== null).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { samples: 0, average: null, p50: null, p95: null, p99: null, maximum: null };
  }
  const percentile = (ratio) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1)];
  return {
    samples: sorted.length,
    average: Number((sorted.reduce((sum, value) => sum + value, 0) / sorted.length).toFixed(1)),
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    maximum: sorted.at(-1),
  };
}

export function estimateDeviceClockOffset(record) {
  const t1 = finite(record.deviceSentAtDeviceMs);
  const t2 = finite(record.serverReceivedAtMs);
  const t3 = finite(record.serverRespondedAtMs);
  const t4 = finite(record.deviceReceivedAtDeviceMs);
  if (t1 === null || t2 === null || t3 === null || t4 === null || t4 < t1 || t3 < t2) {
    return null;
  }
  const monotonicDuration = finite(record.httpDurationMs);
  if (monotonicDuration !== null && Math.abs((t4 - t1) - monotonicDuration) > 100) return null;
  const networkRoundTripMs = (t4 - t1) - (t3 - t2);
  if (networkRoundTripMs < 0) return null;
  return {
    // Positive means the server clock is ahead of the device clock.
    offsetMs: ((t2 - t1) + (t3 - t4)) / 2,
    uncertaintyMs: networkRoundTripMs / 2,
    networkRoundTripMs,
  };
}

function earliestBy(records, keyFunction) {
  const selected = new Map();
  for (const record of records) {
    const key = keyFunction(record);
    if (!key) continue;
    const existing = selected.get(key);
    const time = finite(record.browserEstimatedServerAtMs) ??
      finite(record.browserWallAtMs) ??
      finite(record.deviceReceivedAtDeviceMs) ??
      0;
    const existingTime = existing
      ? finite(existing.browserEstimatedServerAtMs) ??
        finite(existing.browserWallAtMs) ??
        finite(existing.deviceReceivedAtDeviceMs) ??
        0
      : Number.POSITIVE_INFINITY;
    if (!existing || time < existingTime) selected.set(key, record);
  }
  return selected;
}

function nonNegative(value) {
  return finite(value) !== null && value >= 0 ? value : null;
}

function elapsedBetween(later, earlier) {
  return later === null || earlier === null ? null : nonNegative(later - earlier);
}

export function analyzeTelemetryTraces(deviceRecords, browserRecords) {
  const deviceByKey = new Map();
  for (const record of deviceRecords) {
    const key = traceKey(record);
    if (!key) continue;
    const attempts = deviceByKey.get(key) ?? [];
    attempts.push(record);
    deviceByKey.set(key, attempts);
  }
  const listeners = earliestBy(
    browserRecords.filter((record) => record.event === "browser_listener"),
    traceKey,
  );
  const renders = earliestBy(
    browserRecords.filter((record) => record.event === "browser_render" && record.displayKind !== "none"),
    (record) => {
      const key = traceKey(record);
      return key && typeof record.runId === "string" ? `${key}:${record.runId}` : null;
    },
  );

  const rows = [];
  for (const [key, attempts] of deviceByKey) {
    const accepted = attempts.find((record) => record.httpStatus === 200 || record.httpStatus === 202);
    if (!accepted) continue;
    const clock = estimateDeviceClockOffset(accepted);
    const listener = listeners.get(key);
    const listenerRunId = typeof listener?.runId === "string" ? listener.runId : null;
    const render = listenerRunId ? renders.get(`${key}:${listenerRunId}`) : undefined;
    const sampledAt = finite(accepted.sampledAtDeviceMs);
    const deviceSentAt = finite(accepted.deviceSentAtDeviceMs);
    const serverReceivedAt = finite(accepted.serverReceivedAtMs);
    const serverRespondedAt = finite(accepted.serverRespondedAtMs);
    const rtdbCommittedAt = finite(listener?.rtdbCommittedAtMs);
    const browserListenerAt = finite(listener?.browserEstimatedServerAtMs);
    const browserRenderAt = finite(render?.browserEstimatedServerAtMs);
    const listenerMonotonicAt = finite(listener?.browserMonotonicAtMs);
    const renderMonotonicAt = finite(render?.browserMonotonicAtMs);

    rows.push({
      key,
      seq: accepted.seq,
      sampledAtDeviceMs: sampledAt,
      scenario: typeof listener?.scenario === "string" ? listener.scenario : "unclassified",
      motionState: accepted.motionState ?? listener?.motionState ?? "unknown",
      attempts: attempts.length,
      deviceQueueMs: elapsedBetween(deviceSentAt, sampledAt),
      httpRoundTripMs: finite(accepted.httpDurationMs) ?? elapsedBetween(finite(accepted.deviceReceivedAtDeviceMs), deviceSentAt),
      clockOffsetMs: clock?.offsetMs ?? null,
      clockUncertaintyMs: clock?.uncertaintyMs ?? null,
      deviceToBackendIngressMs:
        clock && serverReceivedAt !== null && deviceSentAt !== null
          ? nonNegative(serverReceivedAt - (deviceSentAt + clock.offsetMs))
          : null,
      backendRequestMs: elapsedBetween(serverRespondedAt, serverReceivedAt),
      backendToRtdbMs: elapsedBetween(rtdbCommittedAt, serverReceivedAt),
      rtdbToBrowserListenerMs: elapsedBetween(browserListenerAt, rtdbCommittedAt),
      browserListenerToRenderMs: elapsedBetween(renderMonotonicAt, listenerMonotonicAt),
      endToEndMs:
        clock && sampledAt !== null && browserRenderAt !== null
          ? nonNegative(browserRenderAt - (sampledAt + clock.offsetMs))
          : null,
      captureUpdateGapMs: null,
      backendIngressUpdateGapMs: null,
      browserListenerUpdateGapMs: null,
      browserRenderUpdateGapMs: null,
      _serverReceivedAtMs: serverReceivedAt,
      _browserListenerAtMs: browserListenerAt,
      _browserRenderAtMs: browserRenderAt,
    });
  }
  rows.sort((left, right) => (left._serverReceivedAtMs ?? left.sampledAtDeviceMs ?? 0) - (right._serverReceivedAtMs ?? right.sampledAtDeviceMs ?? 0));
  rows.forEach((row, index) => {
    const previous = rows[index - 1];
    if (previous && previous.scenario === row.scenario) {
      row.captureUpdateGapMs = elapsedBetween(row.sampledAtDeviceMs, previous.sampledAtDeviceMs);
      row.backendIngressUpdateGapMs = elapsedBetween(row._serverReceivedAtMs, previous._serverReceivedAtMs);
      row.browserListenerUpdateGapMs = elapsedBetween(
        row._browserListenerAtMs,
        previous._browserListenerAtMs,
      );
      row.browserRenderUpdateGapMs = elapsedBetween(
        row._browserRenderAtMs,
        previous._browserRenderAtMs,
      );
    }
  });
  rows.forEach((row) => {
    delete row._serverReceivedAtMs;
    delete row._browserListenerAtMs;
    delete row._browserRenderAtMs;
  });
  const requests = deviceRecords.filter(record => finite(record.httpStatus) !== null);
  const connections = deviceRecords.filter(record => record.event === "network_connect" && record.channel !== "diagnostics");
  const gaps = rows.flatMap(row => ["captureUpdateGapMs", "backendIngressUpdateGapMs",
    "browserListenerUpdateGapMs", "browserRenderUpdateGapMs"].flatMap(metric =>
      row[metric] > 2000 ? [{ seq: row.seq, scenario: row.scenario, metric, milliseconds: row[metric] }] : []));
  return {
    counters: {
      requests: requests.length,
      malformedTraceLines: deviceRecords.filter(record => record.event === "malformed_trace").length,
      httpFailures: requests.filter(record => ![200, 202].includes(record.httpStatus)).length,
      retries: requests.filter(record => record.attempt > 1).length,
      tlsConnectionAttempts: connections.length,
      tlsReconnects: Math.max(0, connections.filter(record => record.result === 1).length - 1),
      clockDiscontinuities: requests.filter(record => finite(record.httpDurationMs) !== null &&
        Math.abs((record.deviceReceivedAtDeviceMs - record.deviceSentAtDeviceMs) - record.httpDurationMs) > 100).length,
    },
    connections,
    gaps,
    rows,
    missing: {
      acceptedDeviceSamples: rows.length,
      withoutListener: rows.filter((row) => !listeners.has(row.key)).length,
      withoutRender: rows.filter((row) => row.browserListenerToRenderMs === null).length,
      withoutClockEstimate: rows.filter((row) => row.clockOffsetMs === null).length,
    },
  };
}

const METRICS = [
  ["Device queue", "deviceQueueMs"],
  ["HTTP round trip", "httpRoundTripMs"],
  ["Clock offset estimate", "clockOffsetMs"],
  ["Clock uncertainty", "clockUncertaintyMs"],
  ["Device send → backend ingress", "deviceToBackendIngressMs"],
  ["Backend request", "backendRequestMs"],
  ["Backend ingress → RTDB commit", "backendToRtdbMs"],
  ["RTDB commit → browser listener", "rtdbToBrowserListenerMs"],
  ["Browser listener → first marker render", "browserListenerToRenderMs"],
  ["Capture → first marker render", "endToEndMs"],
  ["Capture gap between accepted samples", "captureUpdateGapMs"],
  ["Backend ingress update gap", "backendIngressUpdateGapMs"],
  ["Browser listener update gap", "browserListenerUpdateGapMs"],
  ["Browser marker-render update gap", "browserRenderUpdateGapMs"],
];

function metricTable(rows, metrics = METRICS) {
  const lines = [
    "| Metric | Samples | Average | p50 | p95 | p99 | Max |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const [label, field] of metrics) {
    const summary = percentileSummary(rows.map((row) => row[field]));
    const show = (value) => value === null ? "—" : Number(value.toFixed(1));
    lines.push(`| ${label} | ${summary.samples} | ${show(summary.average)} | ${show(summary.p50)} | ${show(summary.p95)} | ${show(summary.p99)} | ${show(summary.maximum)} |`);
  }
  return lines.join("\n");
}

function healthTables(healthSnapshots) {
  if (healthSnapshots.length === 0) return "";
  const names = [
    "processingLatencyMs",
    "deviceQueueLatencyMs",
    "networkLatencyMs",
    "deviceToServerLatencyMs",
    "rtdbWriteLatencyMs",
    "serverIngressGapMs",
  ];
  const lines = [
    "## Backend health snapshots",
    "",
    "| File | Metric | Samples | p50 | p95 | p99 |",
    "|---|---|---:|---:|---:|---:|",
  ];
  for (const snapshot of healthSnapshots) {
    const telemetry = snapshot.value?.telemetry ?? snapshot.value;
    for (const name of names) {
      const metric = telemetry?.[name];
      if (!metric) continue;
      lines.push(`| ${snapshot.name} | ${name} | ${metric.samples ?? "—"} | ${metric.p50 ?? "—"} | ${metric.p95 ?? "—"} | ${metric.p99 ?? "—"} |`);
    }
  }
  return lines.join("\n");
}

export function formatTelemetryReport(analysis, healthSnapshots = []) {
  const scenarios = [...new Set(analysis.rows.map((row) => row.scenario))];
  const sections = [
    "# Telemetry latency baseline",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Clock offset uses the four HTTP timestamps. The uncertainty column is half of the network-only round trip; cross-clock latency values should be read with that bound.",
    "Use one device per input. Capture gaps describe accepted samples, not the underlying GNSS sampling cadence. Missing or malformed records limit gap and failure counts.",
    "",
    "## Correlation coverage",
    "",
    `- Accepted device samples: ${analysis.missing.acceptedDeviceSamples}`,
    `- Missing browser listener correlation: ${analysis.missing.withoutListener}`,
    `- Missing marker-render correlation: ${analysis.missing.withoutRender}`,
    `- Missing clock estimate: ${analysis.missing.withoutClockEstimate}`,
    "",
    "## Delivery and connection counts",
    "",
    ...Object.entries(analysis.counters).map(([name, count]) => `- ${name}: ${count}`),
    `- Gaps >2 s: ${analysis.gaps.length}`,
    `- Gaps >5 s: ${analysis.gaps.filter(gap => gap.milliseconds > 5000).length}`,
    "",
    "## Every gap >2 seconds (largest first)",
    "",
    "| Sequence | Scenario | Stage | Gap ms |",
    "|---|---|---|---:|",
    ...[...analysis.gaps].sort((a, b) => b.milliseconds - a.milliseconds)
      .map(gap => `| ${gap.seq} | ${gap.scenario} | ${gap.metric} | ${gap.milliseconds} |`),
    "",
    "## TLS connection timing (ms)",
    "",
    metricTable(analysis.connections, [["DNS", "dnsMs"], ["TCP/TLS", "tlsConnectMs"], ["Key preparation", "preparationMs"]]),
    "",
    "## Overall latency (ms)",
    "",
    metricTable(analysis.rows),
    "",
    "## Additional clock-adjusted intervals (ms)",
    "",
    metricTable(analysis.rows.map(row => ({
      sampleToBackendMs: row.deviceQueueMs !== null && row.deviceToBackendIngressMs !== null
        ? row.deviceQueueMs + row.deviceToBackendIngressMs : null,
      backendToBrowserMs: row.backendToRtdbMs !== null && row.rtdbToBrowserListenerMs !== null
        ? row.backendToRtdbMs + row.rtdbToBrowserListenerMs : null,
    })), [["Sample to backend (offset estimate)", "sampleToBackendMs"], ["Backend to browser", "backendToBrowserMs"]]),
  ];
  for (const scenario of scenarios) {
    sections.push(
      "",
      `## Scenario: ${scenario} (ms)`,
      "",
      metricTable(analysis.rows.filter((row) => row.scenario === scenario)),
    );
  }
  const health = healthTables(healthSnapshots);
  if (health) sections.push("", health);
  return `${sections.join("\n")}\n`;
}

function parseArguments(argv) {
  const parsed = { browser: [], health: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!value || !name.startsWith("--")) throw new Error(`Missing value for ${name}.`);
    if (name === "--health") parsed.health.push(value);
    else if (name === "--device") parsed.device = value;
    else if (name === "--browser") parsed.browser.push(value);
    else if (name === "--out") parsed.out = value;
    else throw new Error(`Unknown argument ${name}.`);
    index += 1;
  }
  if (!parsed.device || !parsed.out) {
    throw new Error("Usage: --device <serial.log> [--browser <trace.json>] [--browser <trace.json>] --out <report.md> [--health <health.json>]");
  }
  return parsed;
}

async function readDeviceRecords(filename) {
  const text = await readFile(filename, "utf8");
  return text.split(/\r?\n/).flatMap((line) => {
    const start = line.indexOf(DEVICE_TRACE_PREFIX);
    if (start < 0) {
      const match = line.match(/\[NetworkTiming\] dnsMs=(\d+) tlsConnectMs=(\d+) timeoutMs=(\d+) handshakeMs=(\d+) result=(\d+)(?: channel=(\w+) preparationMs=(\d+))?/);
      return match ? [{ event: "network_connect", dnsMs: Number(match[1]), tlsConnectMs: Number(match[2]), result: Number(match[5]), channel: match[6] ?? "unknown", preparationMs: match[7] ? Number(match[7]) : null }] : [];
    }
    try {
      return [JSON.parse(line.slice(start + DEVICE_TRACE_PREFIX.length))];
    } catch {
      return [{ event: "malformed_trace" }];
    }
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [deviceRecords, browserExports, healthValues] = await Promise.all([
    readDeviceRecords(options.device),
    Promise.all(options.browser.map((name) => readFile(name, "utf8").then(JSON.parse))),
    Promise.all(options.health.map((name) => readFile(name, "utf8").then(JSON.parse))),
  ]);
  const browserRecords = browserExports.flatMap((browserExport) => {
    const records = Array.isArray(browserExport) ? browserExport : browserExport.records;
    if (!Array.isArray(records)) throw new Error("Browser trace has no records array.");
    return records;
  });
  const healthSnapshots = options.health.map((name, index) => ({ name, value: healthValues[index] }));
  const report = formatTelemetryReport(
    analyzeTelemetryTraces(deviceRecords, browserRecords),
    healthSnapshots,
  );
  await writeFile(options.out, report, "utf8");
  process.stdout.write(`Wrote ${options.out}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
