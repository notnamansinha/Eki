import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory destination that applies the committed rules' fence, with a way
// to hold a leaf write's acknowledgement after the write has landed.
const store = vi.hoisted(() => ({ data: {} as Record<string, any>, release: null as null | (() => void), held: false }));
vi.mock("../lib/firebaseAdmin", () => {
  const ref = (path: string) => ({ path, once: async () => ({ val: () => path.split("/").reduce((node: any, key) => node?.[key], store.data) ?? null }) });
  return { rtdb: { ref }, liveProjectionWriterRtdb: () => ({ ref }) };
});
vi.mock("../lib/workerFence", () => ({
  isRtdbPermissionDenied: (error: unknown) => /permission/i.test(String((error as Error)?.message)),
  workerRtdbTransaction: async (ref: { path: string }, update: (current: any) => any) => {
    const key = ref.path.split("/")[1], current = store.data.publicRouteBuses?.[key] ?? null;
    if (Number(current?._workerGeneration ?? 0) > 4) return { committed: false, snapshot: { val: () => current } };
    const next = update(structuredClone(current));
    if (next === undefined) return { committed: false, snapshot: { val: () => current } };
    const stamped = { ...next, _workerGeneration: 4 };
    store.data.publicRouteBuses = { ...store.data.publicRouteBuses, [key]: stamped };
    return { committed: true, snapshot: { val: () => structuredClone(stamped) } };
  },
  workerRtdbFencedUpdate: async (ref: { path: string }, values: Record<string, unknown>) => {
    const key = ref.path.split("/")[1], current = store.data.publicRouteBuses?.[key];
    if (!current || current._workerGeneration !== 4 || values.revision !== current.revision + 1) throw new Error("PERMISSION_DENIED");
    for (const [path, value] of Object.entries({ ...values, _workerGeneration: 4 })) {
      const parts = path.split("/"); let target = current;
      for (const part of parts.slice(0, -1)) target = target[part] ??= {};
      if (value === null) delete target[parts.at(-1)!]; else target[parts.at(-1)!] = structuredClone(value);
    }
    if (store.held) await new Promise<void>(resolve => { store.release = resolve; });
  },
}));
import { createLiveBusProjectionWriter } from "./liveBusProjectionWriter";

const counters = () => ({ transactionAttempts: 0, committed: 0, publicBytes: 0, routeClaims: 0, leafWriteAttempts: 0, leafWrites: 0,
  leafWriteDenials: 0, leafWriteFallbacks: 0, leafWriteDrifts: 0 });
beforeEach(() => { store.data = {}; store.release = null; store.held = false; });

describe("live bus projection writer", () => {
  it("does not keep a copy that recovery discarded while a leaf write was in flight", async () => {
    const count = counters(), writer = createLiveBusProjectionWriter({ generation: 4, counters: count, isStopped: () => false });
    const a = { busId: "A", routeId: "r", lat: 1 }, b = { busId: "B", routeId: "r", lat: 1 };
    await writer.publish("r", "node:A_r", a); await writer.publish("r", "node:B_r", b);
    const floor = store.data.publicRouteBuses["route:r"].revision;
    // A's next write lands, but its acknowledgement is held.
    store.held = true;
    const inFlight = writer.publish("r", "node:A_r", { ...a, lat: 2 });
    await vi.waitFor(() => expect(store.release).not.toBeNull());
    // The destination is erased and a recovery pass restores its lineage, discarding the copy.
    delete store.data.publicRouteBuses["route:r"];
    await writer.restoreLineage("r", floor);
    store.held = false; store.release!(); await inFlight;
    // An unchanged replay of B must claim afresh and write B back, not trust the old copy.
    const claims = count.routeClaims;
    await writer.publish("r", "node:B_r", b);
    expect(count.routeClaims).toBe(claims + 1);
    expect(store.data.publicRouteBuses["route:r"].buses).toEqual({ "node:B_r": b });
  });
});
