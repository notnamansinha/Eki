import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  generation: 1,
  ready: Promise.resolve(),
  token: vi.fn<() => Promise<string>>(),
  auth: { currentUser: null as null | { uid: string; getIdToken: () => Promise<string> } },
  fetch: vi.fn<typeof fetch>(),
}));
vi.mock("./firebaseAuth", () => ({ auth: fixture.auth }));
vi.mock("./authState", () => ({ getAuthVerificationGeneration: () => fixture.generation, waitForAuth: () => fixture.ready }));
const flush = async () => { for (let step = 0; step < 6; step++) await Promise.resolve(); };
const status = { sessionId: "old", busId: "bus", routeId: "A", status: "completed" };
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); fixture.generation = 1; fixture.ready = Promise.resolve();
  fixture.token.mockReset(); fixture.token.mockResolvedValue("synthetic-test-token"); fixture.fetch.mockReset();
  fixture.auth.currentUser = { uid: "passenger", getIdToken: fixture.token };
  vi.stubGlobal("fetch", fixture.fetch); vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "http://127.0.0.1:8787");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("joined-session recovery transport", () => {
  it("accepts server-verified own boarding choices", async () => {
    const { getJoinedRideStatus } = await import("./joinedRideStatus");
    const body = { ...status, boarding: { boardingStopId: "origin", alightingStopId: "destination" } };
    fixture.fetch.mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(getJoinedRideStatus("old", new AbortController().signal)).resolves.toEqual(body);
  });
  it.each([null, {}, { boardingStopId: "bad/path", alightingStopId: null }, { boardingStopId: "origin", alightingStopId: "bad/path" }])("rejects malformed own stop metadata %j", async boarding => {
    const { getJoinedRideStatus } = await import("./joinedRideStatus");
    fixture.fetch.mockResolvedValue(new Response(JSON.stringify({ ...status, boarding })));
    await expect(getJoinedRideStatus("old", new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_ACKNOWLEDGEMENT" });
  });
  it("makes one authenticated request and returns a validated completed identity", async () => {
    const { getJoinedRideStatus } = await import("./joinedRideStatus");
    fixture.fetch.mockResolvedValue(new Response(JSON.stringify(status)));
    await expect(getJoinedRideStatus("old", new AbortController().signal)).resolves.toEqual(status);
    expect(fixture.fetch).toHaveBeenCalledOnce();
    const [url, init] = fixture.fetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8787/api/sessions/old/status");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer synthetic-test-token");
  });

  it.each([
    { ...status, sessionId: "other" }, { ...status, busId: "../invalid" }, { ...status, routeId: null },
    { ...status, status: "unknown" }, null,
  ])("rejects malformed recovery acknowledgement %j", async body => {
    const { getJoinedRideStatus } = await import("./joinedRideStatus");
    fixture.fetch.mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(getJoinedRideStatus("old", new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_ACKNOWLEDGEMENT" });
  });

  it("does not start HTTP after cancellation during token acquisition", async () => {
    const { getJoinedRideStatus } = await import("./joinedRideStatus");
    let answer!: (token: string) => void; fixture.token.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    const controller = new AbortController();
    const result = getJoinedRideStatus("old", controller.signal).catch(error => error);
    await flush(); controller.abort(); answer("synthetic-test-token");
    expect(await result).toBeInstanceOf(Error); expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("bounds token acquisition to ten seconds without starting HTTP", async () => {
    const { getJoinedRideStatus } = await import("./joinedRideStatus");
    fixture.token.mockImplementation(() => new Promise(() => {}));
    const result = getJoinedRideStatus("old", new AbortController().signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await result).toMatchObject({ message: "Ride status authentication timed out." });
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("bounds an aborted stalled HTTP request without starting another attempt", async () => {
    const { getJoinedRideStatus } = await import("./joinedRideStatus");
    fixture.fetch.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const result = getJoinedRideStatus("old", new AbortController().signal).catch(error => error);
    await flush(); await vi.advanceTimersByTimeAsync(10_001);
    expect(await result).toMatchObject({ code: "NETWORK_TIMEOUT" }); expect(fixture.fetch).toHaveBeenCalledOnce();
  });

  it("rejects a completed response if authentication changed while HTTP was in flight", async () => {
    const { getJoinedRideStatus } = await import("./joinedRideStatus");
    let answer!: (response: Response) => void; fixture.fetch.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    const result = getJoinedRideStatus("old", new AbortController().signal).catch(error => error);
    await flush(); fixture.generation++; answer(new Response(JSON.stringify(status)));
    expect(await result).toMatchObject({ message: "Ride status request cancelled." });
  });

  it("preserves a membership denial rather than inventing a missing/completed outcome", async () => {
    const { getJoinedRideStatus } = await import("./joinedRideStatus");
    fixture.fetch.mockResolvedValue(new Response(JSON.stringify({ error: "Ride not found or inaccessible" }), { status: 403 }));
    await expect(getJoinedRideStatus("old", new AbortController().signal)).rejects.toMatchObject({ status: 403 });
    expect(fixture.fetch).toHaveBeenCalledOnce();
  });

  it("waits for verified auth readiness before token acquisition and HTTP", async () => {
    const { getJoinedRideStatus } = await import("./joinedRideStatus");
    let verified!: () => void; fixture.ready = new Promise(resolve => { verified = resolve; });
    fixture.fetch.mockResolvedValue(new Response(JSON.stringify(status)));
    const result = getJoinedRideStatus("old", new AbortController().signal);
    await flush(); expect(fixture.token).not.toHaveBeenCalled(); expect(fixture.fetch).not.toHaveBeenCalled();
    verified(); await expect(result).resolves.toEqual(status);
    expect(fixture.fetch).toHaveBeenCalledOnce();
  });

  it("shares one ten-second authentication budget across readiness and token acquisition", async () => {
    const { getJoinedRideStatus } = await import("./joinedRideStatus");
    let verified!: () => void; fixture.ready = new Promise(resolve => { verified = resolve; });
    fixture.token.mockImplementation(() => new Promise(() => {}));
    const result = getJoinedRideStatus("old", new AbortController().signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(9_000); verified(); await flush();
    expect(fixture.token).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_001);
    expect(await result).toMatchObject({ message: "Ride status authentication timed out." });
    expect(fixture.fetch).not.toHaveBeenCalled();
  });
});
