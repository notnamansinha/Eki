import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ receive: null as ((s: { val: () => unknown }) => void) | null,
  detach: vi.fn() }));
vi.mock("firebase/database", () => ({ ref: (_: unknown, path: string) => ({ path }),
  onValue: (_: unknown, receive: typeof fixture.receive) => { fixture.receive = receive; return fixture.detach; },
  onChildAdded: () => fixture.detach, onChildChanged: () => fixture.detach, onChildRemoved: () => fixture.detach }));
vi.mock("./firebaseDatabase", () => ({ rtdb: {} }));
beforeEach(() => { vi.resetModules(); fixture.detach.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); });
describe("live bus auth isolation with the real verification gate", () => {
  it("synchronously revokes existing subscribers and blocks cache replay and attachment during reverification", async () => {
    const auth = await import("./authState"); auth.notifyAuthReady();
    const { subscribeLiveBusesByRoute } = await import("./liveBusStore");
    const first = vi.fn(); const stopFirst = subscribeLiveBusesByRoute("A", first);
    await Promise.resolve(); await Promise.resolve();
    const old = fixture.receive!;
    old({ val: () => ({ "node:bus": { timestamp: Date.now() } }) });
    expect(first).toHaveBeenLastCalledWith({ "node:bus": { timestamp: expect.any(Number) } }, "listener");
    auth.beginAuthVerification();
    expect(first).toHaveBeenLastCalledWith(null, "invalidation");
    expect(fixture.detach).toHaveBeenCalledTimes(4);
    const next = vi.fn(); const stopNext = subscribeLiveBusesByRoute("A", next);
    old({ val: () => ({ "node:private": { timestamp: Date.now() } }) });
    await Promise.resolve(); expect(next).not.toHaveBeenCalled();
    auth.notifyAuthReady(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    fixture.receive!({ val: () => null });
    expect(next).toHaveBeenLastCalledWith(null, "listener");
    stopFirst(); stopNext();
  });
  it("delivers an initial terminal snapshot to joined-ride observers before expiry hides the marker", async () => {
    const auth = await import("./authState"); auth.notifyAuthReady();
    const { subscribeLiveBusChangesByRoute } = await import("./liveBusStore");
    const next = vi.fn(); const stop = subscribeLiveBusChangesByRoute("A", next);
    await Promise.resolve(); await Promise.resolve();
    const bus = { timestamp: Date.now(), sessionId: "joined", tripState: "completed" };
    fixture.receive!({ val: () => ({ "node:bus": bus }) });
    expect(next).toHaveBeenCalledWith({ type: "reset", snapshot: { "node:bus": bus }, source: "listener" });
    stop();
  });
});
