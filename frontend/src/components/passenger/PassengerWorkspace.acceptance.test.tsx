// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Delivery = "listener" | "cache" | "expiry" | "invalidation";
type BusSnapshot = Record<string, Record<string, unknown>> | null;
type RouteListener = { routeId: string; next: (change: { type: "reset"; snapshot: BusSnapshot; source: Delivery }) => void; fail: (error: Error) => void; active: boolean };
const fixture = vi.hoisted(() => ({
  mark: vi.fn(), retryCatalog: vi.fn(), retryDetails: vi.fn(), generation: 1, connectionGeneration: 0, resumeGeneration: 0,
  revision: 0, observers: new Set<() => void>(), listeners: [] as RouteListener[],
  user: { uid: "passenger", role: "passenger" } as { uid: string; role: string } | null,
  route: { id: "A", name: "A route", waypoints: [], stops: [{ id: "a", name: "Alpha", lat: 23, lng: 72 }, { id: "b", name: "Beta", lat: 23.01, lng: 72.01 }] },
  catalogError: null as string | null, projectionReady: true, catalogReady: true,
  activeB: 1, availableB: 0,
  carousel: null as null | { getDirectionState: (id: string) => unknown; getAvailableBusesCount: (id: string) => number },
  visibility: "visible" as "visible" | "hidden", online: true,
  status: vi.fn<(sessionId: string, signal?: AbortSignal) => Promise<{ sessionId: string; busId: string; routeId: string; status: string }>>(),
}));
const observe = (next: () => void) => { fixture.observers.add(next); return () => { fixture.observers.delete(next); }; };
const revision = () => fixture.revision;
function useFixtureRevision() { useSyncExternalStore(observe, revision); }
function refresh() { fixture.revision++; fixture.observers.forEach(next => next()); }
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => { useFixtureRevision(); return { user: fixture.user, loading: false }; } }));
vi.mock("@/hooks/useRoutes", () => ({ useRoutes: () => ({ routes: [fixture.route, { ...fixture.route, id: "B", name: "B route" }], error: null, retry: vi.fn() }) }));
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => ({ settings: {} }) }));
vi.mock("@/lib/authState", () => ({ getAuthVerificationGeneration: () => fixture.generation, waitForAuth: () => Promise.resolve() }));
vi.mock("@/lib/joinedRideStatus", () => ({ getJoinedRideStatus: (sessionId: string, signal?: AbortSignal) => fixture.status(sessionId, signal) }));
vi.mock("@/hooks/useRTDBResume", () => ({ useRTDBResume: () => {
  useFixtureRevision();
  return { isResuming: true, isConnected: true, connectionGeneration: fixture.connectionGeneration, resumeGeneration: fixture.resumeGeneration, markSnapshotReceived: fixture.mark };
} }));
vi.mock("@/hooks/useLiveRouteCatalog", () => ({ useLiveRouteCatalog: () => {
  useFixtureRevision();
  return { catalog: { A: { active: 1, available: 0, freshestAt: 0 }, B: { active: fixture.activeB, available: fixture.availableB, freshestAt: 0 } },
    error: fixture.catalogError, projectionReady: fixture.projectionReady, catalogReady: fixture.catalogReady, retry: fixture.retryCatalog,
    source: "listener", revision: fixture.revision };
} }));
vi.mock("@/lib/liveBusStore", () => ({
  subscribeLiveBusChangesByRoute: (routeId: string, next: RouteListener["next"], fail: RouteListener["fail"]) => {
    const listener = { routeId, next, fail, active: true }; fixture.listeners.push(listener);
    return () => { listener.active = false; };
  },
  invalidateLiveBusCache: fixture.retryDetails,
  retryClientRouteData: fixture.retryDetails,
}));
vi.mock("next/dynamic", () => ({ default: (loader: () => unknown) => {
  const source = loader.toString();
  if (source.includes("RouteCarousel")) return function FixtureRouteCarousel(props: { onClick: (id: string) => void; getDirectionState: (id: string) => unknown; getAvailableBusesCount: (id: string) => number }) { fixture.carousel = props; return <><button onClick={() => props.onClick("A")}>Track A</button><button onClick={() => props.onClick("B")}>Track B</button></>; };
  if (source.includes("PassengerBoardingView")) return function FixtureBoarding({ sessionId, onJoined }: { sessionId: string; onJoined: () => void }) { return <button onClick={onJoined}>Join {sessionId}</button>; };
  if (source.includes("FeedbackModal")) return function FixtureFeedback({ sessionId }: { sessionId: string }) { return <div>Feedback {sessionId}</div>; };
  return function FixturePanel() { return <div>Fixture map or panel</div>; };
} }));
import PassengerWorkspace from "./PassengerWorkspace";
const flush = async () => { for (let step = 0; step < 6; step++) await Promise.resolve(); };
function bus(sessionId = "old", routeId = "A") { return { busId: "bus", routeId, sessionId, driverId: "driver", lat: 23, lng: 72,
  timestamp: Date.now(), backendReceivedAt: Date.now(), deviceState: "online", status: "active", tripState: "in_service", direction: "forward", directionState: "resolved" }; }
function emit(routeId: string, value: BusSnapshot, source: Delivery = "listener") {
  fixture.listeners.filter(listener => listener.active && listener.routeId === routeId).forEach(listener => listener.next({ type: "reset", snapshot: value, source }));
}
async function mountJoined() {
  render(<PassengerWorkspace />);
  act(() => emit("A", { bus_A: bus() }));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Track A" }));
  await user.click(screen.getByRole("button", { name: "Join old" }));
  act(() => emit("A", { bus_A: bus() }));
  return user;
}
beforeEach(() => {
  fixture.mark.mockClear(); fixture.retryCatalog.mockClear(); fixture.retryDetails.mockClear(); fixture.status.mockReset();
  fixture.status.mockImplementation(async sessionId => ({ sessionId, busId: "bus", routeId: "A", status: "active" }));
  fixture.listeners = []; fixture.generation = 1; fixture.connectionGeneration = 0; fixture.resumeGeneration = 0;
  fixture.user = { uid: "passenger", role: "passenger" };
  fixture.catalogError = null; fixture.projectionReady = true; fixture.catalogReady = true; fixture.revision = 0;
  fixture.activeB = 1; fixture.availableB = 0; fixture.carousel = null;
  fixture.visibility = "visible"; fixture.online = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => fixture.visibility);
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => fixture.online);
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("scoped passenger acceptance", () => {
  it("keeps catalog-only direction unknown until scoped details explicitly report pending or resolved", async () => {
    render(<PassengerWorkspace />);
    act(() => emit("A", { bus_A: bus() }));
    expect(fixture.carousel!.getDirectionState("A")).toBe("forward");
    expect(fixture.carousel!.getDirectionState("B")).toBe("unknown");
    expect(fixture.listeners.filter(listener => listener.active).map(listener => listener.routeId)).toEqual(["A"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Track B" }));
    act(() => emit("B", { bus_B: { ...bus("other", "B"), direction: null, directionState: "pending" } }));
    expect(fixture.carousel!.getDirectionState("B")).toBe("pending");
    act(() => emit("B", { bus_B: { ...bus("other", "B"), direction: "reverse", directionState: "resolved" } }));
    expect(fixture.carousel!.getDirectionState("B")).toBe("reverse");
  });

  it("passes fresh catalog availability to an unselected stationary preview card without subscribing its detail", () => {
    fixture.activeB = 0; fixture.availableB = 1;
    render(<PassengerWorkspace />);
    expect(fixture.carousel!.getAvailableBusesCount("B")).toBe(1);
    expect(fixture.listeners.filter(listener => listener.active).map(listener => listener.routeId)).toEqual(["A"]);
  });

  it("shows detailed permission failures and offers an explicit Retry", async () => {
    render(<PassengerWorkspace />);
    act(() => fixture.listeners.find(listener => listener.active)!.fail(new Error("PERMISSION_DENIED")));
    expect(screen.getByRole("alert")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(fixture.retryCatalog.mock.calls.length + fixture.retryDetails.mock.calls.length).toBeGreaterThan(0);
  });

  it("keeps an unresolved catalog denial visible after a successful detailed delivery", async () => {
    render(<PassengerWorkspace />);
    act(() => { fixture.catalogError = "PERMISSION_DENIED"; refresh(); });
    act(() => emit("A", { bus_A: bus() }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(fixture.mark).not.toHaveBeenCalled();
  });

  it("requires both selected B and joined A authoritative deliveries; cache replay cannot finish recovery", async () => {
    const user = await mountJoined();
    await user.click(screen.getByRole("button", { name: "Back to home" }));
    await user.click(screen.getByRole("button", { name: "Track B" }));
    expect(fixture.listeners.filter(listener => listener.active).map(listener => listener.routeId).sort()).toEqual(["A", "B"]);
    fixture.mark.mockClear();
    act(() => emit("B", { bus_B: bus("other", "B") }));
    expect(fixture.mark).not.toHaveBeenCalled();
    act(() => emit("A", { bus_A: bus() }, "cache"));
    expect(fixture.mark).not.toHaveBeenCalled();
    act(() => emit("A", { bus_A: bus() }));
    expect(fixture.mark).toHaveBeenCalledOnce();
  });

  it("gates boarding while direction is pending and never invents a session for device preview", async () => {
    render(<PassengerWorkspace />);
    const user = userEvent.setup();
    act(() => emit("A", { bus_A: { ...bus(), direction: null, directionState: "pending" } }));
    await user.click(screen.getByRole("button", { name: "Track A" }));
    expect(screen.queryByRole("button", { name: "Join old" })).toBeNull();
    act(() => emit("A", { bus_A: { busId: "bus", routeId: "A", lat: 23, lng: 72, deviceState: "online", timestamp: Date.now() } }));
    expect(screen.queryByRole("button", { name: /Join / })).toBeNull();
    act(() => emit("A", { bus_A: bus("new") }));
    expect(screen.getByRole("button", { name: "Join new" })).toBeTruthy();
  });

  it("completes the joined old session from its authoritative marker across automatic turnaround", async () => {
    await mountJoined(); vi.useFakeTimers();
    await act(async () => {
      emit("A", { bus_A: { ...bus("next"), tripState: "pre_departure", direction: "reverse", lastCompletedSessionId: "old", lastCompletedAt: Date.now(), lastCompletedRouteId: "A" } });
      await flush();
    });
    expect(screen.getByText("Route ended")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(screen.getByText("Feedback old")).toBeTruthy();
  });

  it("recovers a missed completion from the joined-session oracle once, without render-driven polling", async () => {
    await mountJoined();
    let answer!: (value: { sessionId: string; busId: string; routeId: string; status: string }) => void;
    fixture.status.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    await act(async () => { emit("A", { bus_A: bus("next") }); await flush(); });
    expect(fixture.status).toHaveBeenCalledOnce();
    act(() => { refresh(); refresh(); emit("A", { bus_A: bus("next") }); });
    expect(fixture.status).toHaveBeenCalledOnce();
    vi.useFakeTimers();
    await act(async () => { answer({ sessionId: "old", busId: "bus", routeId: "A", status: "completed" }); await flush(); });
    expect(screen.getByText("Route ended")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(screen.getByText("Feedback old")).toBeTruthy();
  });

  it.each(["interrupted", "failed", "active"])("never converts oracle %s into completion or feedback", async status => {
    await mountJoined(); fixture.status.mockResolvedValue({ sessionId: "old", busId: "bus", routeId: "A", status });
    await act(async () => { emit("A", { bus_A: bus("next") }); await flush(); });
    expect(fixture.status).toHaveBeenCalledOnce();
    expect(screen.queryByText("Route ended")).toBeNull();
    vi.useFakeTimers(); await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(screen.queryByText("Feedback old")).toBeNull();
  });

  it("surfaces joined-status denial and retries that bounded query only after Retry", async () => {
    const user = await mountJoined(); fixture.status.mockRejectedValue(new Error("PERMISSION_DENIED"));
    await act(async () => { emit("A", { bus_A: bus("next") }); await flush(); });
    expect(screen.getByRole("alert")).toBeTruthy(); expect(fixture.status).toHaveBeenCalledOnce();
    act(() => { refresh(); emit("A", { bus_A: bus("next") }); });
    expect(fixture.status).toHaveBeenCalledOnce();
    fixture.status.mockResolvedValue({ sessionId: "old", busId: "bus", routeId: "A", status: "active" });
    await user.click(screen.getByRole("button", { name: "Retry" })); await act(flush);
    expect(fixture.status).toHaveBeenCalledTimes(2);
  });

  it("fences a late completed oracle response from an older auth generation", async () => {
    await mountJoined();
    let answer!: (value: { sessionId: string; busId: string; routeId: string; status: string }) => void;
    fixture.status.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    await act(async () => { emit("A", { bus_A: bus("next") }); await flush(); });
    const staleAnswer = answer;
    act(() => { fixture.generation++; refresh(); });
    await act(async () => { staleAnswer({ sessionId: "old", busId: "bus", routeId: "A", status: "completed" }); await flush(); });
    expect(screen.queryByText("Route ended")).toBeNull();
    expect(screen.queryByText("Feedback old")).toBeNull();
  });

  it("rejects a completed oracle response for a different bus or route", async () => {
    await mountJoined(); fixture.status.mockResolvedValue({ sessionId: "old", busId: "different", routeId: "B", status: "completed" });
    await act(async () => { emit("A", { bus_A: bus("next") }); await flush(); });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Route ended")).toBeNull();
    expect(screen.queryByText("Feedback old")).toBeNull();
  });

  it("never treats a missing or inaccessible joined session as a completed ride", async () => {
    await mountJoined(); fixture.status.mockRejectedValue(new Error("Ride not found or inaccessible"));
    await act(async () => { emit("A", null); await flush(); });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Route ended")).toBeNull();
    expect(screen.queryByText("Feedback old")).toBeNull();
  });

  it.each(["active", "armed", "pending"])("rechecks an absent joined projection after oracle %s and observes later completion", async status => {
    await mountJoined(); vi.useFakeTimers();
    fixture.status.mockResolvedValueOnce({ sessionId: "old", busId: "bus", routeId: "A", status })
      .mockResolvedValueOnce({ sessionId: "old", busId: "bus", routeId: "A", status: "completed" });
    await act(async () => { emit("A", null); await flush(); });
    expect(fixture.status).toHaveBeenCalledOnce(); expect(screen.queryByText("Route ended")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
    expect(fixture.status).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(2); await flush(); });
    expect(fixture.status).toHaveBeenCalledTimes(2); expect(screen.getByText("Route ended")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(45_001); });
    expect(fixture.status).toHaveBeenCalledTimes(2); expect(screen.getByText("Feedback old")).toBeTruthy();
  });

  it("never overlaps requests while a joined-status response remains in flight", async () => {
    await mountJoined(); vi.useFakeTimers(); fixture.status.mockImplementation(() => new Promise(() => {}));
    await act(async () => { emit("A", null); await flush(); });
    act(() => { window.dispatchEvent(new Event("online")); document.dispatchEvent(new Event("visibilitychange")); refresh(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_001); });
    expect(fixture.status).toHaveBeenCalledOnce();
  });

  it.each(["hidden", "offline"] as const)("suspends the nonterminal timer while %s and resumes only one visible online request", async reason => {
    await mountJoined(); vi.useFakeTimers();
    fixture.status.mockResolvedValue({ sessionId: "old", busId: "bus", routeId: "A", status: "active" });
    await act(async () => { emit("A", null); await flush(); });
    act(() => {
      if (reason === "hidden") { fixture.visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange")); }
      else { fixture.online = false; window.dispatchEvent(new Event("offline")); }
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_001); });
    expect(fixture.status).toHaveBeenCalledOnce();
    await act(async () => {
      fixture.visibility = "visible"; fixture.online = true;
      if (reason === "hidden") document.dispatchEvent(new Event("visibilitychange")); else window.dispatchEvent(new Event("online"));
      await flush();
    });
    expect(fixture.status).toHaveBeenCalledTimes(2);
  });

  it.each(["auth", "presence", "unmount"] as const)("stops the nonterminal timer after %s", async stop => {
    await mountJoined(); vi.useFakeTimers();
    fixture.status.mockResolvedValue({ sessionId: "old", busId: "bus", routeId: "A", status: "active" });
    await act(async () => { emit("A", null); await flush(); });
    act(() => {
      if (stop === "auth") { fixture.generation++; refresh(); }
      else if (stop === "presence") emit("A", { bus_A: bus() });
      else cleanup();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_001); });
    expect(fixture.status).toHaveBeenCalledOnce();
  });

  it("does not automatically retry a membership denial on the nonterminal timer or online event", async () => {
    await mountJoined(); vi.useFakeTimers(); fixture.status.mockRejectedValue(new Error("PERMISSION_DENIED"));
    await act(async () => { emit("A", null); await flush(); });
    act(() => { window.dispatchEvent(new Event("online")); document.dispatchEvent(new Event("visibilitychange")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_001); });
    expect(fixture.status).toHaveBeenCalledOnce(); expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("does not infer a completed ride or issue a joined-status request before compatible readiness and a successful join", () => {
    fixture.projectionReady = false; fixture.catalogReady = false; fixture.catalogError = "Live data is not ready.";
    render(<PassengerWorkspace />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(fixture.status).not.toHaveBeenCalled(); expect(screen.queryByText("Route ended")).toBeNull();
    expect(screen.queryByText("Feedback old")).toBeNull();
  });

  it.each(["projection", "catalog", "auth"] as const)("does not fetch joined recovery while %s readiness is closed", async gate => {
    await mountJoined();
    await act(async () => {
      if (gate === "projection") fixture.projectionReady = false;
      else if (gate === "catalog") fixture.catalogReady = false;
      else fixture.user = null;
      emit("A", null); refresh(); await flush();
    });
    expect(fixture.status).not.toHaveBeenCalled();
    expect(screen.queryByText("Route ended")).toBeNull(); expect(screen.queryByText("Feedback old")).toBeNull();
  });

  it("discards an in-flight completed response after projection compatibility is lost", async () => {
    await mountJoined();
    let answer!: (value: { sessionId: string; busId: string; routeId: string; status: string }) => void;
    fixture.status.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    await act(async () => { emit("A", null); await flush(); });
    expect(fixture.status).toHaveBeenCalledOnce();
    act(() => { fixture.projectionReady = false; refresh(); });
    await act(async () => { answer({ sessionId: "old", busId: "bus", routeId: "A", status: "completed" }); await flush(); });
    expect(screen.queryByText("Route ended")).toBeNull(); expect(screen.queryByText("Feedback old")).toBeNull();
  });
});
