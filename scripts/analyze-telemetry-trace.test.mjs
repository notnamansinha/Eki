import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTelemetryTraces,
  estimateDeviceClockOffset,
  percentileSummary,
  parseDeviceRecords,
} from "./analyze-telemetry-trace.mjs";

test("accepts configured handshake limits and legacy labels without reporting them as measured duration", () => {
  for (const label of ["handshakeMs", "configuredHandshakeTimeoutMs"]) {
    const records = parseDeviceRecords(`[NetworkTiming] dnsMs=1 tlsConnectMs=20 timeoutMs=3000 ${label}=8000 result=1 channel=telemetry preparationMs=5`);
    assert.equal(records.length, 1);
    assert.equal(records[0].tlsConnectMs, 20);
    assert.equal(records[0].handshakeMs, undefined);
  }
});

test("estimates clock offset and network uncertainty from four timestamps", () => {
  assert.deepEqual(estimateDeviceClockOffset({
    deviceSentAtDeviceMs: 1_000,
    serverReceivedAtMs: 1_100,
    serverRespondedAtMs: 1_150,
    deviceReceivedAtDeviceMs: 1_250,
  }), {
    offsetMs: 0,
    uncertaintyMs: 100,
    networkRoundTripMs: 200,
  });
});

test("correlates device, listener, and render phases without mixing clocks", () => {
  const device = [{
    event: "device_http",
    seq: 7,
    motionState: "moving",
    sampledAtDeviceMs: 900,
    deviceSentAtDeviceMs: 1_000,
    serverReceivedAtMs: 1_100,
    serverRespondedAtMs: 1_150,
    deviceReceivedAtDeviceMs: 1_250,
    httpStatus: 202,
  }];
  const browser = [{
    event: "browser_listener",
    runId: "browser-run",
    seq: 7,
    sampledAtDeviceMs: 900,
    rtdbCommittedAtMs: 1_160,
    browserEstimatedServerAtMs: 1_200,
    browserMonotonicAtMs: 50,
    scenario: "moving",
  }, {
    event: "browser_render",
    runId: "browser-run",
    displayKind: "raw",
    seq: 7,
    sampledAtDeviceMs: 900,
    browserEstimatedServerAtMs: 1_230,
    browserMonotonicAtMs: 80,
    scenario: "moving",
  }];

  const analysis = analyzeTelemetryTraces(device, browser);

  assert.deepEqual(analysis.rows[0], {
    key: "7:900",
    seq: 7,
    sampledAtDeviceMs: 900,
    scenario: "moving",
    motionState: "moving",
    attempts: 1,
    deviceQueueMs: 100,
    receiverUtcMs: null,
    receiverClockToCaptureMs: null,
    rmcReadMs: null,
    receiverToEvaluationMs: null,
    evaluationToEnqueueMs: null,
    enqueueToSendMs: null,
    responseDrainMs: null,
    completeDeviceCycleMs: null,
    httpRoundTripMs: 250,
    clockOffsetMs: 0,
    clockUncertaintyMs: 100,
    deviceToBackendIngressMs: 100,
    backendRequestMs: 50,
    backendToRtdbMs: 60,
    rtdbToBrowserListenerMs: 40,
    browserListenerToRenderMs: 30,
    browserListenerToMarkerSettledMs: null,
    markerAnimationMs: null,
    endToEndMarkerSettledMs: null,
    endToEndMs: 330,
    captureUpdateGapMs: null,
    backendIngressUpdateGapMs: null,
    browserListenerUpdateGapMs: null,
    browserRenderUpdateGapMs: null,
  });
});

test("held targets do not count as arrivals and settled timing stays in the listener's run", () => {
  const device = [{ seq: 1, sampledAtDeviceMs: 900, deviceSentAtDeviceMs: 1000, serverReceivedAtMs: 1100, serverRespondedAtMs: 1150, deviceReceivedAtDeviceMs: 1250, httpStatus: 202 }];
  const common = { seq: 1, sampledAtDeviceMs: 900, runId: "current", displayKind: "raw" };
  const browser = [
    { ...common, event: "browser_listener", browserMonotonicAtMs: 50 },
    { ...common, event: "browser_render", displayKind: "held", browserMonotonicAtMs: 60 },
    { ...common, event: "browser_render", browserMonotonicAtMs: 80 },
    { ...common, event: "browser_marker_settled", runId: "other", browserMonotonicAtMs: 100 },
    { ...common, event: "browser_marker_settled", displayKind: "held", browserMonotonicAtMs: 110 },
    { ...common, event: "browser_marker_settled", browserMonotonicAtMs: 210, browserEstimatedServerAtMs: 1400 },
  ];
  const { rows } = analyzeTelemetryTraces(device, browser);
  assert.equal(rows[0].browserListenerToRenderMs, 30);
  assert.equal(rows[0].browserListenerToMarkerSettledMs, 160);
  assert.equal(rows[0].markerAnimationMs, 130);
  assert.equal(rows[0].endToEndMarkerSettledMs, 500);
});

test("does not mix another ride or route's arrival in the same browser run", () => {
  const common = { seq: 8, sampledAtDeviceMs: 1900, runId: "browser", nodeKey: "bus_route", sessionId: "ride" };
  const device = [{ ...common, deviceSentAtDeviceMs: 2000, serverReceivedAtMs: 2100, serverRespondedAtMs: 2150, deviceReceivedAtDeviceMs: 2250, httpStatus: 202 }];
  const browser = [
    { ...common, event: "browser_listener", browserMonotonicAtMs: 50 },
    { ...common, event: "browser_marker_settled", displayKind: "raw", nodeKey: "bus_other_route", browserMonotonicAtMs: 55 },
    { ...common, event: "browser_marker_settled", displayKind: "raw", sessionId: "old-ride", browserMonotonicAtMs: 60 },
    { ...common, event: "browser_marker_settled", displayKind: "raw", browserMonotonicAtMs: 150 },
  ];
  assert.equal(analyzeTelemetryTraces(device, browser).rows[0].browserListenerToMarkerSettledMs, 100);
  assert.equal(analyzeTelemetryTraces(device, browser.slice(0, 3)).rows[0].browserListenerToMarkerSettledMs, null);
});

test("uses nearest-rank percentiles", () => {
  assert.deepEqual(percentileSummary([10, 20, 30, 40, 100]), {
    samples: 5,
    average: 40,
    p50: 30,
    p95: 100,
    p99: 100,
    maximum: 100,
  });
});

test("correlates projected wire keys with logical map keys without crossing rides", () => {
  const common = { seq: 8, sampledAtDeviceMs: 1900, runId: "browser", sessionId: "ride" };
  const device = [{ ...common, httpStatus: 202 }];
  const browser = [
    { ...common, event: "browser_listener", nodeKey: "node:bus_route", browserMonotonicAtMs: 50 },
    { ...common, event: "browser_render", nodeKey: "bus_route", displayKind: "raw", browserMonotonicAtMs: 75 },
    { ...common, event: "browser_marker_settled", nodeKey: "bus_route", sessionId: "old", displayKind: "raw", browserMonotonicAtMs: 80 },
    { ...common, event: "browser_marker_settled", nodeKey: "bus_route", displayKind: "raw", browserMonotonicAtMs: 150 },
  ];
  const row = analyzeTelemetryTraces(device, browser).rows[0];
  assert.equal(row.browserListenerToRenderMs, 25);
  assert.equal(row.browserListenerToMarkerSettledMs, 100);
});

test("pairs a listener with a render from the same browser run", () => {
  const device = [{
    seq: 8,
    sampledAtDeviceMs: 1_900,
    deviceSentAtDeviceMs: 2_000,
    serverReceivedAtMs: 2_100,
    serverRespondedAtMs: 2_150,
    deviceReceivedAtDeviceMs: 2_250,
    httpStatus: 202,
  }];
  const browser = [{
    event: "browser_listener",
    runId: "admin",
    seq: 8,
    sampledAtDeviceMs: 1_900,
    rtdbCommittedAtMs: 2_160,
    browserEstimatedServerAtMs: 2_200,
    browserMonotonicAtMs: 900,
  }, {
    event: "browser_render",
    runId: "passenger",
    displayKind: "raw",
    seq: 8,
    sampledAtDeviceMs: 1_900,
    browserEstimatedServerAtMs: 2_205,
    browserMonotonicAtMs: 15,
  }, {
    event: "browser_render",
    runId: "admin",
    displayKind: "raw",
    seq: 8,
    sampledAtDeviceMs: 1_900,
    browserEstimatedServerAtMs: 2_230,
    browserMonotonicAtMs: 930,
  }];

  const analysis = analyzeTelemetryTraces(device, browser);

  assert.equal(analysis.rows[0].browserListenerToRenderMs, 30);
  assert.equal(analysis.rows[0].endToEndMs, 330);
});


test("reports failed requests and gaps without deleting timestamps early", () => {
  const device = [0, 3000, 10000].map((offset, index) => ({
    seq: index + 1, sampledAtDeviceMs: 1000 + offset, deviceSentAtDeviceMs: 1000 + offset,
    serverReceivedAtMs: 1100 + offset, serverRespondedAtMs: 1150 + offset,
    deviceReceivedAtDeviceMs: 1250 + offset, httpDurationMs: 250, httpStatus: 202, attempt: 1,
  }));
  device.push({ httpStatus: -11, attempt: 2 });
  const analysis = analyzeTelemetryTraces(device, []);
  assert.equal(analysis.rows[1].backendIngressUpdateGapMs, 3000);
  assert.equal(analysis.rows[2].backendIngressUpdateGapMs, 7000);
  assert.equal(analysis.counters.httpFailures, 1);
  assert.equal(analysis.counters.retries, 1);
  assert.equal(analysis.gaps.filter(gap => gap.metric === "backendIngressUpdateGapMs").length, 2);
});

test("rejects a wall-clock jump instead of calling it transport latency", () => {
  assert.equal(estimateDeviceClockOffset({ deviceSentAtDeviceMs: 1000,
    deviceReceivedAtDeviceMs: 8250, serverReceivedAtMs: 1100, serverRespondedAtMs: 1150,
    httpDurationMs: 250 }), null);
});

test("retains receiver evaluation queue and body-drain delays across monotonic rollover", () => {
  const common = { seq: 1, sampledAtDeviceMs: 900 };
  const records = [
    { ...common, event: "device_capture", receiverBacked: true,
      receiverStartedAtMonotonicMs: 0xffffffd0, receiverAtMonotonicMs: 0xffffffe0,
      evaluationAtMonotonicMs: 0xfffffff0, enqueuedAtMonotonicMs: 0xfffffff8 },
    { ...common, httpStatus: 202, attempt: 2, deviceSentAtDeviceMs: 1000,
      deviceReceivedAtDeviceMs: 1250, serverReceivedAtMs: 1100, serverRespondedAtMs: 1150 },
    { ...common, event: "device_http_complete", attempt: 1, responseComplete: false,
      sendAtMonotonicMs: 1, headersAtMonotonicMs: 2, drainCompletedAtMonotonicMs: 3 },
    { ...common, event: "device_http_complete", attempt: 2, responseComplete: true,
      sendAtMonotonicMs: 0x10, headersAtMonotonicMs: 0x110, drainCompletedAtMonotonicMs: 0x210 },
  ];
  const { rows, counters } = analyzeTelemetryTraces(records, []);
  assert.equal(counters.requests, 1);
  assert.equal(rows[0].attempts, 1);
  assert.equal(rows[0].rmcReadMs, 16);
  assert.equal(rows[0].receiverToEvaluationMs, 16);
  assert.equal(rows[0].evaluationToEnqueueMs, 8);
  assert.equal(rows[0].enqueueToSendMs, 24);
  assert.equal(rows[0].responseDrainMs, 256);
  assert.equal(rows[0].completeDeviceCycleMs, 560);
});

test("does not invent receiver or complete-cycle evidence for recovered fixes or incomplete bodies", () => {
  const common = { seq: 1, sampledAtDeviceMs: 900 };
  const { rows } = analyzeTelemetryTraces([
    { ...common, event: "device_capture", receiverBacked: false, receiverAtMonotonicMs: 1, enqueuedAtMonotonicMs: 5 },
    { ...common, httpStatus: 202 },
    { ...common, event: "device_http_complete", responseComplete: false, sendAtMonotonicMs: 10,
      headersAtMonotonicMs: 20, drainCompletedAtMonotonicMs: 30 },
  ], []);
  assert.equal(rows[0].receiverToEvaluationMs, null);
  assert.equal(rows[0].completeDeviceCycleMs, null);
  assert.equal(rows[0].responseDrainMs, null);
});
