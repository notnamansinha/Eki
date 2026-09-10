import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTelemetryTraces,
  estimateDeviceClockOffset,
  percentileSummary,
} from "./analyze-telemetry-trace.mjs";

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
    httpRoundTripMs: 250,
    clockOffsetMs: 0,
    clockUncertaintyMs: 100,
    deviceToBackendIngressMs: 100,
    backendRequestMs: 50,
    backendToRtdbMs: 60,
    rtdbToBrowserListenerMs: 40,
    browserListenerToRenderMs: 30,
    endToEndMs: 330,
    captureUpdateGapMs: null,
    backendIngressUpdateGapMs: null,
    browserListenerUpdateGapMs: null,
    browserRenderUpdateGapMs: null,
  });
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
