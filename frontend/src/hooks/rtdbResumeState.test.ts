import { describe, expect, it } from "vitest";
import {
  initialRTDBResumeLifecycle,
  reduceRTDBResumeLifecycle,
} from "./rtdbResumeState";

describe("RTDB resume lifecycle", () => {
  it("starts disconnected and waiting for confirmed data", () => {
    expect(initialRTDBResumeLifecycle).toMatchObject({
      connected: false,
      awaitingSnapshot: true,
    });
  });

  it("starts one reconnect generation and suppresses duplicates", () => {
    const requested = reduceRTDBResumeLifecycle(
      initialRTDBResumeLifecycle,
      { type: "reconnect-requested" },
    );
    const duplicate = reduceRTDBResumeLifecycle(requested, {
      type: "reconnect-requested",
    });

    expect(requested.resumeGeneration).toBe(1);
    expect(duplicate).toBe(requested);
  });

  it("does not accept a cached snapshot while disconnected", () => {
    const result = reduceRTDBResumeLifecycle(
      initialRTDBResumeLifecycle,
      { type: "snapshot-received" },
    );

    expect(result.awaitingSnapshot).toBe(true);
  });

  it("clears reconnecting only after connection and snapshot", () => {
    const connected = reduceRTDBResumeLifecycle(
      initialRTDBResumeLifecycle,
      { type: "connection", connected: true },
    );
    const ready = reduceRTDBResumeLifecycle(connected, {
      type: "snapshot-received",
    });

    expect(connected.awaitingSnapshot).toBe(true);
    expect(ready.awaitingSnapshot).toBe(false);
    expect(ready.connectionGeneration).toBe(1);
  });

  it("returns to reconnecting when RTDB disconnects", () => {
    const ready = {
      ...initialRTDBResumeLifecycle,
      connected: true,
      awaitingSnapshot: false,
    };
    const disconnected = reduceRTDBResumeLifecycle(ready, {
      type: "connection",
      connected: false,
    });

    expect(disconnected).toMatchObject({
      connected: false,
      awaitingSnapshot: true,
    });
  });
});
