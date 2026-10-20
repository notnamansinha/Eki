import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { percentileSummary } from "./percentile-summary.mjs";
export { percentileSummary };

const DEVICE_TRACE_PREFIX = "[TelemetryTrace] ";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function traceKey(record) {
  const seq = finite(record.seq);
  const sampledAt = finite(record.sampledAtDeviceMs);
  return seq === null || sampledAt === null ? null : `${seq}:${sampledAt}`;
}

function browserPhaseKey(record) {
  const key = record && traceKey(record);
  // Projection listeners include the RTDB wire prefix; map phases use the
  // logical bus/route key. Preserve run and ride isolation across both forms.
  const nodeKey = typeof record?.nodeKey === "string"
    ? record.nodeKey.replace(/^node:/, "") : "";
  return key && typeof record.runId === "string"
    ? JSON.stringify([key, record.runId, nodeKey, record.sessionId ?? ""])
    : null;
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

function monotonicElapsed(later, earlier) {
  if (finite(later) === null || finite(earlier) === null ||
      !Number.isInteger(later) || !Number.isInteger(earlier) ||
      later < 0 || earlier < 0 || later > 0xffffffff || earlier > 0xffffffff) return null;
  const elapsed = (later - earlier) >>> 0;
  return elapsed <= 120_000 ? elapsed : null;
}

function browserCadence(browserRecords) {
  const selected = new Map();
  for (const record of browserRecords) {
    if (!["browser_listener", "browser_render"].includes(record.event) ||
        ["none", "held"].includes(record.displayKind) ||
        nonNegative(record.browserMonotonicAtMs) === null) continue;
    const phase = browserPhaseKey(record);
    if (!phase) continue;
    const key = JSON.stringify([phase, record.event, record.scenario ?? "unclassified"]);
    const previous = selected.get(key);
    if (!previous || record.browserMonotonicAtMs < previous.browserMonotonicAtMs) selected.set(key, record);
  }
  const streams = new Map();
  const byPhase = new Map();
  const updates = [];
  // Use the tab's monotonic clock, independently of serial availability and
  // server-offset adjustments. Overlapping exports count each sample once.
  for (const record of [...selected.values()].sort((a, b) => a.browserMonotonicAtMs - b.browserMonotonicAtMs)) {
    const nodeKey = typeof record.nodeKey === "string" ? record.nodeKey.replace(/^node:/, "") : "";
    const stream = JSON.stringify([record.runId, nodeKey,
      record.sessionId ?? "", record.event]);
    const previous = streams.get(stream);
    const scenario = record.scenario ?? "unclassified";
    const metric = record.event === "browser_listener" ? "browserListenerUpdateGapMs" : "browserRenderUpdateGapMs";
    const gap = previous && (previous.scenario ?? "unclassified") === scenario
      ? elapsedBetween(record.browserMonotonicAtMs, previous.browserMonotonicAtMs) : null;
    const update = { seq: record.seq, scenario, [metric]: gap };
    updates.push(update);
    byPhase.set(JSON.stringify([browserPhaseKey(record), record.event, scenario]), gap);
    streams.set(stream, record);
  }
  return { updates, byPhase };
}

export function analyzeTelemetryTraces(deviceRecords, browserRecords) {
  const cadence = browserCadence(browserRecords);
  const deviceByKey = new Map();
  for (const record of deviceRecords) {
    if (finite(record.httpStatus) === null) continue;
    const key = traceKey(record);
    if (!key) continue;
    const attempts = deviceByKey.get(key) ?? [];
    attempts.push(record);
    deviceByKey.set(key, attempts);
  }
  const captures = earliestBy(deviceRecords.filter(record => record.event === "device_capture"), traceKey);
  const completions = new Map(deviceRecords.filter(record => record.event === "device_http_complete")
    .map(record => [`${traceKey(record)}:${record.attempt ?? 1}`, record]));
  const listeners = earliestBy(
    browserRecords.filter((record) => record.event === "browser_listener"),
    traceKey,
  );
  const renders = earliestBy(
    browserRecords.filter((record) => record.event === "browser_render" && record.displayKind !== "none" && record.displayKind !== "held"),
    browserPhaseKey,
  );

  const settledMarkers = earliestBy(
    browserRecords.filter((record) => record.event === "browser_marker_settled" && record.displayKind !== "none" && record.displayKind !== "held"),
    browserPhaseKey,
  );

  const rows = [];
  for (const [key, attempts] of deviceByKey) {
    const accepted = attempts.find((record) => record.httpStatus === 200 || record.httpStatus === 202);
    if (!accepted) continue;
    const clock = estimateDeviceClockOffset(accepted);
    const capture = captures.get(key);
    const completion = completions.get(`${key}:${accepted.attempt ?? 1}`);
    const receiverAt = capture?.receiverBacked === true ? finite(capture.receiverAtMonotonicMs) : null;
    const evaluationAt = finite(capture?.evaluationAtMonotonicMs);
    const enqueueAt = finite(capture?.enqueuedAtMonotonicMs);
    const sendAt = finite(completion?.sendAtMonotonicMs);
    const drainAt = completion?.responseComplete === true ? finite(completion.drainCompletedAtMonotonicMs) : null;
    const listener = listeners.get(key);
    const phaseKey = browserPhaseKey(listener);
    const render = phaseKey ? renders.get(phaseKey) : undefined;
    const settled = phaseKey ? settledMarkers.get(phaseKey) : undefined;
    const sampledAt = finite(accepted.sampledAtDeviceMs);
    const deviceSentAt = finite(accepted.deviceSentAtDeviceMs);
    const serverReceivedAt = finite(accepted.serverReceivedAtMs);
    const serverRespondedAt = finite(accepted.serverRespondedAtMs);
    const rtdbCommittedAt = finite(listener?.rtdbCommittedAtMs);
    const browserListenerAt = finite(listener?.browserEstimatedServerAtMs);
    const browserRenderAt = finite(render?.browserEstimatedServerAtMs);
    const listenerMonotonicAt = finite(listener?.browserMonotonicAtMs);
    const renderMonotonicAt = finite(render?.browserMonotonicAtMs);
    const settledMonotonicAt = finite(settled?.browserMonotonicAtMs);
    const settledServerAt = finite(settled?.browserEstimatedServerAtMs);

    rows.push({
      key,
      seq: accepted.seq,
      sampledAtDeviceMs: sampledAt,
      scenario: typeof listener?.scenario === "string" ? listener.scenario : "unclassified",
      motionState: accepted.motionState ?? listener?.motionState ?? "unknown",
      attempts: attempts.length,
      deviceQueueMs: elapsedBetween(deviceSentAt, sampledAt),
      receiverUtcMs: capture?.receiverBacked === true ? finite(capture.receiverUtcMs) : null,
      receiverClockToCaptureMs: capture?.receiverBacked === true && sampledAt !== null && finite(capture.receiverUtcMs) !== null
        ? sampledAt - capture.receiverUtcMs : null,
      rmcReadMs: monotonicElapsed(receiverAt, finite(capture?.receiverStartedAtMonotonicMs)),
      receiverToEvaluationMs: monotonicElapsed(evaluationAt, receiverAt),
      evaluationToEnqueueMs: monotonicElapsed(enqueueAt, evaluationAt),
      enqueueToSendMs: monotonicElapsed(sendAt, enqueueAt),
      responseDrainMs: monotonicElapsed(drainAt, finite(completion?.headersAtMonotonicMs)),
      completeDeviceCycleMs: monotonicElapsed(drainAt, receiverAt),
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
      browserListenerToMarkerSettledMs: elapsedBetween(settledMonotonicAt, listenerMonotonicAt),
      markerAnimationMs: elapsedBetween(settledMonotonicAt, renderMonotonicAt),
      endToEndMarkerSettledMs:
        clock && sampledAt !== null && settledServerAt !== null
          ? nonNegative(settledServerAt - (sampledAt + clock.offsetMs)) : null,
      endToEndMs:
        clock && sampledAt !== null && browserRenderAt !== null
          ? nonNegative(browserRenderAt - (sampledAt + clock.offsetMs))
          : null,
      captureUpdateGapMs: null,
      backendIngressUpdateGapMs: null,
      browserListenerUpdateGapMs: null,
      browserRenderUpdateGapMs: null,
      _serverReceivedAtMs: serverReceivedAt,
    });
  }
  rows.sort((left, right) => (left._serverReceivedAtMs ?? left.sampledAtDeviceMs ?? 0) - (right._serverReceivedAtMs ?? right.sampledAtDeviceMs ?? 0));
  rows.forEach((row, index) => {
    const previous = rows[index - 1];
    if (previous && previous.scenario === row.scenario) {
      row.captureUpdateGapMs = elapsedBetween(row.sampledAtDeviceMs, previous.sampledAtDeviceMs);
      row.backendIngressUpdateGapMs = elapsedBetween(row._serverReceivedAtMs, previous._serverReceivedAtMs);
    }
    const listener = listeners.get(row.key);
    const phase = listener && browserPhaseKey(listener);
    row.browserListenerUpdateGapMs = cadence.byPhase.get(JSON.stringify([phase, "browser_listener", row.scenario])) ?? null;
    row.browserRenderUpdateGapMs = cadence.byPhase.get(JSON.stringify([phase, "browser_render", row.scenario])) ?? null;
  });
  rows.forEach((row) => {
    delete row._serverReceivedAtMs;
  });
  const requests = deviceRecords.filter(record => finite(record.httpStatus) !== null);
  const connections = deviceRecords.filter(record => record.event === "network_connect" && record.channel !== "diagnostics");
  const gaps = [
    ...rows.flatMap(row => ["captureUpdateGapMs", "backendIngressUpdateGapMs"].flatMap(metric =>
      row[metric] > 2000 ? [{ seq: row.seq, scenario: row.scenario, metric, milliseconds: row[metric], scope: "serial-observed accepted samples" }] : [])),
    ...cadence.updates.flatMap(row => ["browserListenerUpdateGapMs", "browserRenderUpdateGapMs"].flatMap(metric =>
      row[metric] > 2000 ? [{ seq: row.seq, scenario: row.scenario, metric, milliseconds: row[metric], scope: "browser observations" }] : [])),
  ];
  return {
    counters: {
      requests: requests.length,
      browserSamplesWithoutSession: new Set(browserRecords.filter(record =>
        record.event === "browser_listener" && !record.sessionId)
        .map(record => browserPhaseKey(record)).filter(Boolean)).size,
      malformedTraceLines: deviceRecords.filter(record => record.event === "malformed_trace").length,
      httpFailures: requests.filter(record => ![200, 202].includes(record.httpStatus)).length,
      retries: requests.filter(record => record.attempt > 1).length,
      tlsConnectionAttempts: connections.length,
      tlsReconnects: Math.max(0, connections.filter(record => record.result === 1).length - 1),
      clockDiscontinuities: requests.filter(record => finite(record.httpDurationMs) !== null &&
        Math.abs((record.deviceReceivedAtDeviceMs - record.deviceSentAtDeviceMs) - record.httpDurationMs) > 100).length,
    },
    connections,
    browserUpdates: cadence.updates,
    gaps,
    rows,
    missing: {
      acceptedDeviceSamples: rows.length,
      withoutListener: rows.filter((row) => !listeners.has(row.key)).length,
      withoutRender: rows.filter((row) => row.browserListenerToRenderMs === null).length,
      withoutMarkerSettled: rows.filter((row) => row.browserListenerToMarkerSettledMs === null).length,
      withoutClockEstimate: rows.filter((row) => row.clockOffsetMs === null).length,
    },
  };
}

const METRICS = [
  ["Receiver UTC → capture (device/receiver clock comparison)", "receiverClockToCaptureMs"],
  ["RMC first byte → checksum commit", "rmcReadMs"],
  ["RMC commit → evaluation", "receiverToEvaluationMs"],
  ["Evaluation → enqueue", "evaluationToEnqueueMs"],
  ["Enqueue → request send", "enqueueToSendMs"],
  ["Response headers → bounded body drain", "responseDrainMs"],
  ["RMC commit → completed response drain", "completeDeviceCycleMs"],
  ["Device queue", "deviceQueueMs"],
  ["HTTP round trip", "httpRoundTripMs"],
  ["Clock offset estimate", "clockOffsetMs"],
  ["Clock uncertainty", "clockUncertaintyMs"],
  ["Device send → backend ingress", "deviceToBackendIngressMs"],
  ["Backend request", "backendRequestMs"],
  ["Backend ingress → RTDB commit", "backendToRtdbMs"],
  ["RTDB commit → browser listener", "rtdbToBrowserListenerMs"],
  ["Browser listener → React marker snapshot", "browserListenerToRenderMs"],
  ["Capture → React marker snapshot", "endToEndMs"],
  ["Browser listener → marker target (5 cm tolerance)", "browserListenerToMarkerSettledMs"],
  ["Marker animation after React snapshot", "markerAnimationMs"],
  ["Capture → marker target (5 cm tolerance)", "endToEndMarkerSettledMs"],
  ["Capture interval between serial-observed accepted samples", "captureUpdateGapMs"],
  ["Ingress interval between serial-observed accepted samples", "backendIngressUpdateGapMs"],
];

const BROWSER_CADENCE_METRICS = [
  ["Observed browser listener update gap", "browserListenerUpdateGapMs"],
  ["Observed browser marker-render update gap", "browserRenderUpdateGapMs"],
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
  const scenarios = [...new Set([...analysis.rows, ...analysis.browserUpdates].map((row) => row.scenario))];
  const sections = [
    "# Telemetry latency baseline",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Clock offset uses the four HTTP timestamps. The uncertainty column is half of the network-only round trip; cross-clock latency values should be read with that bound.",
    "Use one device per input. Capture gaps describe accepted samples, not the underlying GNSS sampling cadence. Missing or malformed records limit gap and failure counts.",
    "Ingress intervals between serial-observed accepted samples do not establish a backend outage: USB disconnection or missing serial records can omit successful intervening requests. Browser cadence uses all unique browser samples on each tab's monotonic clock, including samples absent from serial. Tabs, routes, rides and scenario transitions are isolated. Missing monotonic timestamps are unavailable. Browser gaps describe the exported observations; suspension, export truncation and missing records can also create gaps. Check recorder coverage and an independent cloud observer before attributing an outage.",
    `Browser samples without a recorded ride session: ${analysis.counters.browserSamplesWithoutSession}. Location-only samples cannot establish boarding, stop progression, completion or automatic return.`,
    "Version 2 firmware records retain receiver UTC, RMC first-byte/checksum arrival, evaluation/enqueue, request send, response headers and completed body drain separately. Monotonic phases handle one rollover and reject impossible intervals. Missing phases remain unavailable, including RTC/checkpoint recovery. Receiver UTC comparisons include clock disagreement and UART buffering; they are not pure network latency. HTTP round trip remains the header phase used for clock estimation; the complete device cycle includes body drain.",
    "",
    "## Correlation coverage",
    "",
    `- Accepted device samples: ${analysis.missing.acceptedDeviceSamples}`,
    `- Missing browser listener correlation: ${analysis.missing.withoutListener}`,
    `- Missing marker-render correlation: ${analysis.missing.withoutRender}`,
    `- Missing marker-target correlation: ${analysis.missing.withoutMarkerSettled}`,
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
    "| Sequence | Scenario | Scope | Stage | Gap ms |",
    "|---|---|---|---|---:|",
    ...[...analysis.gaps].sort((a, b) => b.milliseconds - a.milliseconds)
      .map(gap => `| ${gap.seq} | ${gap.scenario} | ${gap.scope} | ${gap.metric} | ${gap.milliseconds} |`),
    "",
    "## Browser cadence independent of serial (ms)",
    "",
    metricTable(analysis.browserUpdates, BROWSER_CADENCE_METRICS),
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
      "",
      metricTable(analysis.browserUpdates.filter((row) => row.scenario === scenario), BROWSER_CADENCE_METRICS),
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

export function parseDeviceRecords(text) {
  const records = [];
  const jsonSpans = [];
  const networkPattern = /\[NetworkTiming\] dnsMs=(\d+) tlsConnectMs=(\d+) timeoutMs=(\d+) (?:handshakeMs|configuredHandshakeTimeoutMs)=(\d+) result=(\d+)(?: channel=(\w+) preparationMs=(\d+))?/g;
  // Concurrent firmware tasks can concatenate lines or append other output.
  // Parse the framed JSON object, respecting quoted braces/escaped quotes.
  // A damaged fragment is retained and scanning resumes at the next prefix.
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(DEVICE_TRACE_PREFIX, cursor);
    if (start < 0) break;
    const jsonStart = start + DEVICE_TRACE_PREFIX.length;
    let depth = 0, quoted = false, escaped = false, end = -1;
    if (text[jsonStart] === "{") for (let index = jsonStart; index < Math.min(text.length, jsonStart + 65_536); index++) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        // An unescaped newline cannot occur inside a valid JSON string.
        else if (character === "\n" || character === "\r") break;
      } else if (character === '"') quoted = true;
      else if (character === "{") depth++;
      else if (character === "}" && --depth === 0) { end = index + 1; break; }
      else if (text.startsWith(DEVICE_TRACE_PREFIX, index)) break;
    }
    try {
      if (end < 0) throw new Error("Incomplete serial record");
      records.push(JSON.parse(text.slice(jsonStart, end)));
      jsonSpans.push([jsonStart, end]);
      cursor = end;
    } catch {
      records.push({ event: "malformed_trace" });
      cursor = jsonStart;
    }
  }
  let span = 0;
  for (const match of text.matchAll(networkPattern)) {
    while (span < jsonSpans.length && jsonSpans[span][1] <= match.index) span++;
    if (span < jsonSpans.length && match.index >= jsonSpans[span][0]) continue;
    records.push({ event: "network_connect", dnsMs: Number(match[1]), tlsConnectMs: Number(match[2]), result: Number(match[5]), channel: match[6] ?? "unknown", preparationMs: match[7] ? Number(match[7]) : null });
  }
  return records;
}

async function readDeviceRecords(filename) {
  return parseDeviceRecords(await readFile(filename, "utf8"));
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
