import { describe, expect, it, vi } from "vitest";
import { createLatestPendingScheduler } from "./latestPendingScheduler";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("latest pending scheduler", () => {
  it("keeps only the latest pending task for one busy key", async () => {
    const gate = deferred();
    const processed: number[] = [];
    const scheduler = createLatestPendingScheduler<string, number>(
      async (_key, value) => {
        processed.push(value);
        if (value === 1) await gate.promise;
      },
      vi.fn(),
    );

    scheduler.schedule("bus-a", 1);
    scheduler.schedule("bus-a", 2);
    scheduler.schedule("bus-a", 3);
    expect(scheduler.snapshot()).toMatchObject({
      scheduled: 3,
      coalesced: 1,
      activeWorkers: 1,
      pendingKeys: 1,
    });

    gate.resolve();
    await scheduler.drain();
    expect(processed).toEqual([1, 3]);
    expect(scheduler.snapshot()).toMatchObject({
      processed: 2,
      activeWorkers: 0,
      pendingKeys: 0,
    });
  });

  it("isolates keys and continues after a processor error", async () => {
    const processed: string[] = [];
    const errors = vi.fn();
    const scheduler = createLatestPendingScheduler<string, number>(
      async (key, value) => {
        processed.push(`${key}:${value}`);
        if (value === 1) throw new Error("simulated");
      },
      errors,
    );

    scheduler.schedule("bus-a", 1);
    scheduler.schedule("bus-a", 2);
    scheduler.schedule("bus-b", 3);
    await scheduler.drain();

    expect(processed).toEqual(expect.arrayContaining(["bus-a:1", "bus-a:2", "bus-b:3"]));
    expect(errors).toHaveBeenCalledOnce();
    expect(scheduler.snapshot()).toMatchObject({ failed: 1, processed: 3 });
  });

  it("reports queue age for work delayed behind an in-flight task", async () => {
    const gate = deferred();
    let clock = 1_000;
    const scheduler = createLatestPendingScheduler<string, number>(
      async (_key, value) => {
        if (value === 1) await gate.promise;
      },
      vi.fn(),
      () => clock,
    );
    scheduler.schedule("bus-a", 1);
    clock = 1_025;
    scheduler.schedule("bus-a", 2);
    clock = 1_075;
    gate.resolve();
    await scheduler.drain();

    expect(scheduler.snapshot()).toMatchObject({
      lastQueueAgeMs: 50,
      maxQueueAgeMs: 50,
    });
  });
});
