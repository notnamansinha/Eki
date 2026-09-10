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
  const networkRoundTripMs = Math.max(0, (t4 - t1) - (t3 - t2));
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
      httpRoundTripMs: elapsedBetween(finite(accepted.deviceReceivedAtDeviceMs), deviceSentAt),
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
  rows.sort((left, right) => (left.sampledAtDeviceMs ?? 0) - (right.sampledAtDeviceMs ?? 0));
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
    delete row._serverReceivedAtMs;
    delete row._browserListenerAtMs;
    delete row._browserRenderAtMs;
  });
  return {
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
  ["Device capture update gap", "captureUpdateGapMs"],
  ["Backend ingress update gap", "backendIngressUpdateGapMs"],
  ["Browser listener update gap", "browserListenerUpdateGapMs"],
  ["Browser marker-render update gap", "browserRenderUpdateGapMs"],
];

function metricTable(rows) {
  const lines = [
    "| Metric | Samples | Average | p50 | p95 | p99 | Max |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const [label, field] of METRICS) {
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
    "",
    "## Correlation coverage",
    "",
    `- Accepted device samples: ${analysis.missing.acceptedDeviceSamples}`,
    `- Missing browser listener correlation: ${analysis.missing.withoutListener}`,
    `- Missing marker-render correlation: ${analysis.missing.withoutRender}`,
    `- Missing clock estimate: ${analysis.missing.withoutClockEstimate}`,
    "",
    "## Overall latency (ms)",
    "",
    metricTable(analysis.rows),
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
  if (!parsed.device || parsed.browser.length === 0 || !parsed.out) {
    throw new Error("Usage: --device <serial.log> --browser <trace.json> [--browser <trace.json>] --out <report.md> [--health <health.json>]");
  }
  return parsed;
}

async function readDeviceRecords(filename) {
  const text = await readFile(filename, "utf8");
  return text.split(/\r?\n/).flatMap((line) => {
    const start = line.indexOf(DEVICE_TRACE_PREFIX);
    if (start < 0) return [];
    try {
      return [JSON.parse(line.slice(start + DEVICE_TRACE_PREFIX.length))];
    } catch {
      return [];
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
