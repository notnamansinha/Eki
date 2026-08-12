import { describe, expect, it } from "vitest";
import { SerializedChangeWriter } from "./serializedChangeWriter";

/** Resolves after a couple of microtask turns so ordering is observable. */
function tick(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

describe("SerializedChangeWriter", () => {
  it("serializes writes for the same key in FIFO order", async () => {
    const writer = new SerializedChangeWriter();
    const order: string[] = [];
    const write = (name: string) => async () => {
      order.push(`start:${name}`);
      await tick();
      order.push(`end:${name}`);
    };

    await Promise.all([
      writer.enqueue("bus-1", null, write("a")),
      writer.enqueue("bus-1", null, write("b")),
      writer.enqueue("bus-1", null, write("c")),
    ]);

    expect(order).toEqual([
      "start:a",
      "end:a",
      "start:b",
      "end:b",
      "start:c",
      "end:c",
    ]);
  });

  it("keeps independent queues for different keys", async () => {
    const writer = new SerializedChangeWriter();
    const order: string[] = [];
    const write = (name: string) => async () => {
      order.push(`start:${name}`);
      await tick();
      order.push(`end:${name}`);
    };

    await Promise.all([
      writer.enqueue("bus-1", null, write("1a")),
      writer.enqueue("bus-2", null, write("2a")),
      writer.enqueue("bus-1", null, write("1b")),
    ]);

    // bus-1 stays strictly ordered even though bus-2's write is interleaved:
    // a write for bus-2 starts before the second bus-1 write is queued behind
    // the first one.
    expect(order.indexOf("start:1a")).toBeLessThan(order.indexOf("start:1b"));
    expect(order.indexOf("end:1a")).toBeLessThan(order.indexOf("start:1b"));
    expect(order.indexOf("start:2a")).toBeLessThan(order.indexOf("start:1b"));
  });

  it("skips a write whose fingerprint matches the last enqueued one", async () => {
    const writer = new SerializedChangeWriter();
    const calls: string[] = [];

    const first = writer.enqueue("bus-1", "fingerprint-1", async () => {
      calls.push("first");
      await tick();
      return "first-result";
    });
    const second = writer.enqueue("bus-1", "fingerprint-1", async () => {
      calls.push("second");
      return "second-result";
    });

    expect(await first).toBe("first-result");
    // The deduped call resolves with the pending write's own result.
    expect(await second).toBe("first-result");
    expect(calls).toEqual(["first"]);
  });

  it("re-enqueues after retry() clears the dedup fingerprint", async () => {
    const writer = new SerializedChangeWriter();
    const calls: string[] = [];

    await writer.enqueue("bus-1", "fingerprint-1", async () => {
      calls.push("first");
    });
    // Identical state is now suppressed…
    await writer.enqueue("bus-1", "fingerprint-1", async () => {
      calls.push("suppressed");
    });
    expect(calls).toEqual(["first"]);

    // …until the fingerprint is invalidated, e.g. a lock check failed.
    writer.retry("bus-1", "fingerprint-1");
    await writer.enqueue("bus-1", "fingerprint-1", async () => {
      calls.push("retried");
    });
    expect(calls).toEqual(["first", "retried"]);
  });

  it("lets a later event retry after a rejected write", async () => {
    const writer = new SerializedChangeWriter();
    const calls: string[] = [];

    await expect(
      writer.enqueue("bus-1", "fingerprint-1", async () => {
        calls.push("failing");
        throw new Error("transaction failed");
      }),
    ).rejects.toThrow("transaction failed");

    await writer.enqueue("bus-1", "fingerprint-1", async () => {
      calls.push("after-failure");
    });
    expect(calls).toEqual(["failing", "after-failure"]);
  });

  it("does not poison later writes for the same key after a rejection", async () => {
    const writer = new SerializedChangeWriter();
    const calls: string[] = [];

    const failing = writer.enqueue("bus-1", null, async () => {
      calls.push("failing");
      throw new Error("boom");
    });
    const following = writer.enqueue("bus-1", null, async () => {
      calls.push("following");
    });

    await expect(failing).rejects.toThrow("boom");
    await following;
    expect(calls).toEqual(["failing", "following"]);
  });

  it("forgetFingerprint() drops dedup state without touching the queue", async () => {
    const writer = new SerializedChangeWriter();
    const calls: string[] = [];

    await writer.enqueue("bus-1", "fingerprint-1", async () => {
      calls.push("first");
    });
    writer.forgetFingerprint("bus-1");
    await writer.enqueue("bus-1", "fingerprint-1", async () => {
      calls.push("second");
    });
    expect(calls).toEqual(["first", "second"]);
  });

  it("invalidate() drops dedup state and any pending write", async () => {
    const writer = new SerializedChangeWriter();
    const calls: string[] = [];

    const pending = writer.enqueue("bus-1", "fingerprint-1", async () => {
      calls.push("pending");
      await tick();
    });
    writer.invalidate("bus-1");

    // A new enqueue starts a fresh queue instead of chaining behind the
    // dropped write, and its fingerprint is no longer suppressed.
    await writer.enqueue("bus-1", "fingerprint-1", async () => {
      calls.push("fresh");
    });
    await pending;
    expect(calls).toEqual(["pending", "fresh"]);
  });

  it("pending() reports in-flight writes and clear() resets everything", async () => {
    const writer = new SerializedChangeWriter();
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = writer.enqueue("bus-1", "fingerprint-1", async () => {
      calls.push("pending");
      await gate;
      calls.push("done");
    });

    await tick();
    expect(Array.from(writer.pending())).toHaveLength(1);

    writer.clear();
    expect(Array.from(writer.pending())).toHaveLength(0);

    // The dedup fingerprint is gone too: the same state can be written again
    // on a fresh queue instead of chaining behind the dropped write.
    await writer.enqueue("bus-1", "fingerprint-1", async () => {
      calls.push("after-clear");
    });
    expect(calls).toEqual(["pending", "after-clear"]);

    release();
    await pending;
    expect(calls).toEqual(["pending", "after-clear", "done"]);
  });
});
