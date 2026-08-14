import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBackgroundFailureTracker,
  recordBackgroundFailure,
  backgroundFailures,
} from "./backgroundFailureTracker";

const WINDOW_MS = 5 * 60_000;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("backgroundFailureTracker", () => {
  it("counts failures per source and reports them in the snapshot", () => {
    const tracker = createBackgroundFailureTracker({ alertMinFailures: 5 });
    const now = 1_000_000;

    tracker.record("a.source", "Alpha", "first failure", now);
    tracker.record("a.source", "Alpha", "second failure", now + 1_000);
    tracker.record("b.source", "Beta", "first failure", now + 2_000);

    const snapshot = tracker.snapshot(now + 3_000);
    expect(snapshot.totalFailures).toBe(3);
    expect(snapshot.sources["a.source"]).toMatchObject({
      label: "Alpha",
      totalFailures: 2,
      windowFailures: 2,
      sustained: false,
      lastMessage: "second failure",
    });
    expect(snapshot.sources["b.source"].totalFailures).toBe(1);
  });

  it("marks a source sustained once it crosses the window threshold", () => {
    const tracker = createBackgroundFailureTracker({
      alertMinFailures: 3,
      alertWindowMs: WINDOW_MS,
    });
    const now = 1_000_000;

    tracker.record("tripState.backgroundTask", "Trip state", "fail 1", now);
    tracker.record("tripState.backgroundTask", "Trip state", "fail 2", now + 1_000);
    expect(tracker.snapshot(now + 1_000).sustainedSources).toEqual([]);

    tracker.record("tripState.backgroundTask", "Trip state", "fail 3", now + 2_000);
    const snapshot = tracker.snapshot(now + 2_000);
    expect(snapshot.sources["tripState.backgroundTask"].sustained).toBe(true);
    expect(snapshot.sources["tripState.backgroundTask"].windowFailures).toBe(3);
    expect(snapshot.sustainedSources).toEqual(["tripState.backgroundTask"]);
    expect(snapshot.sources["tripState.backgroundTask"].lastFailureAt).toBe(
      new Date(now + 2_000).toISOString(),
    );
  });

  it("alerts exactly once per sustained episode, not on every failure", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tracker = createBackgroundFailureTracker({
      alertMinFailures: 3,
      alertWindowMs: WINDOW_MS,
    });
    const now = 1_000_000;

    for (let i = 0; i < 3; i += 1) {
      tracker.record("tripState.backgroundTask", "Trip state", `fail ${i}`, now + i * 1_000);
    }
    // Two more failures inside the window must not re-alert.
    tracker.record("tripState.backgroundTask", "Trip state", "fail 3", now + 3_000);
    tracker.record("tripState.backgroundTask", "Trip state", "fail 4", now + 4_000);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("SUSTAINED failure alert");
    expect(errorSpy.mock.calls[0][0]).toContain("tripState.backgroundTask");
  });

  it("re-arms and alerts again after failures age out of the window", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = createBackgroundFailureTracker({
      alertMinFailures: 2,
      alertWindowMs: WINDOW_MS,
    });
    const now = 1_000_000;

    tracker.record("devices.durableRideRestore", "Restore", "episode 1", now);
    tracker.record("devices.durableRideRestore", "Restore", "episode 1b", now + 1_000);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    // Episode 1 ages out entirely.
    const later = now + WINDOW_MS + 1_000;
    const recovered = tracker.snapshot(later);
    expect(recovered.sources["devices.durableRideRestore"].windowFailures).toBe(0);
    expect(recovered.sources["devices.durableRideRestore"].sustained).toBe(false);
    // The last-failure timestamp survives window pruning.
    expect(recovered.sources["devices.durableRideRestore"].lastFailureAt).toBe(
      new Date(now + 1_000).toISOString(),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("recovered"),
    );

    tracker.record("devices.durableRideRestore", "Restore", "episode 2", later + 1_000);
    tracker.record("devices.durableRideRestore", "Restore", "episode 2b", later + 2_000);
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps the retained window even when the failure count exceeds the cap", () => {
    const tracker = createBackgroundFailureTracker({
      alertMinFailures: 100,
      alertWindowMs: WINDOW_MS,
      maxRecordedFailures: 10,
    });
    const now = 1_000_000;
    for (let i = 0; i < 25; i += 1) {
      tracker.record("hot.source", "Hot", `fail ${i}`, now + i * 1_000);
    }
    const snapshot = tracker.snapshot(now + 25_000);
    // Timestamps capped but the lifetime counter is not.
    expect(snapshot.sources["hot.source"].windowFailures).toBe(10);
    expect(snapshot.sources["hot.source"].totalFailures).toBe(25);
  });

  it("evicts the least-recently-active source when the source cap is hit", () => {
    const tracker = createBackgroundFailureTracker({
      alertMinFailures: 2,
      maxSources: 2,
    });
    const now = 1_000_000;
    tracker.record("old.source", "Old", "first", now);
    tracker.record("new.source", "New", "first", now + 1_000);
    tracker.record("extra.source", "Extra", "first", now + 2_000);

    const snapshot = tracker.snapshot(now + 2_000);
    expect(Object.keys(snapshot.sources).sort()).toEqual([
      "extra.source",
      "new.source",
    ]);
    expect(snapshot.sources["old.source"]).toBeUndefined();
  });

  it("keeps per-failure warn visibility while recording through the shared helper", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new Error("boom");
    recordBackgroundFailure("test.source", "Test", "context:", error);
    expect(warnSpy).toHaveBeenCalledWith("context:", error);
    expect(backgroundFailures.snapshot().sources["test.source"].totalFailures).toBe(1);
  });
});
