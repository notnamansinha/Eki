import { describe, expect, it } from "vitest";
import { createHealthState } from "./healthState";

describe("createHealthState", () => {
  it("reports each store separately when only one is down", async () => {
    const health = createHealthState();

    await health.probe(
      async () => {
        throw new Error("firestore unreachable");
      },
      async () => undefined,
    );

    const snapshot = health.snapshot();
    expect(snapshot.ready).toBe(false);
    expect(snapshot.firestore).toBe("disconnected");
    expect(snapshot.rtdb).toBe("connected");
    expect(snapshot.checkedAt).toBeTruthy();
  });

  it("is ready only when both stores pass", async () => {
    const health = createHealthState();

    await health.probe(async () => undefined, async () => undefined);

    expect(health.snapshot().ready).toBe(true);
    expect(health.snapshot().firestore).toBe("connected");
    expect(health.snapshot().rtdb).toBe("connected");
  });

  it("recovers to ready after a store comes back", async () => {
    const health = createHealthState();
    await health.probe(
      async () => {
        throw new Error("down");
      },
      async () => undefined,
    );
    expect(health.snapshot().ready).toBe(false);

    await health.probe(async () => undefined, async () => undefined);
    expect(health.snapshot().ready).toBe(true);
  });
});
