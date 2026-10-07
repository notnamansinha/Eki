// @vitest-environment jsdom
import { lazy, Suspense, type ComponentType } from "react";
import type { LiveBusChange } from "@/lib/liveBusStore";
import PassengerWorkspace from "./PassengerWorkspace";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  mark: vi.fn(), retryCatalog: vi.fn(), invalidate: vi.fn(), generation: 0,
  listeners: new Map<string, { next: (change: LiveBusChange) => void; error: (error: Error) => void }>(),
  user: { uid: "passenger", role: "passenger" },
}));
const routes = ["A", "B"].map(id => ({ id, name: id, stops: [{ id: "origin", name: "Origin", lat: 23, lng: 72 }, { id: "end", name: "End", lat: 23.01, lng: 72.01 }] }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: fixture.user }) }));
vi.mock("@/hooks/useRoutes", () => ({ useRoutes: () => ({ routes, error: null, retry: vi.fn() }) }));
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => ({ settings: {} }) }));
vi.mock("@/hooks/useLiveRouteCatalog", () => ({ useLiveRouteCatalog: () => ({ catalog: { A: { active: 1, available: 0 }, B: { active: 1, available: 0 } }, projectionReady: true, catalogReady: true, error: null, retry: fixture.retryCatalog }) }));
vi.mock("@/lib/authState", () => ({ getAuthVerificationGeneration: () => fixture.generation }));
vi.mock("@/lib/joinedRideStatus", () => ({ getJoinedRideStatus: async (sessionId: string) => ({ sessionId, busId: "bus", routeId: "A", status: "active" }) }));
vi.mock("@/hooks/useRTDBResume", () => ({ useRTDBResume: () => ({ isResuming: true, connectionGeneration: fixture.generation, resumeGeneration: 0, markSnapshotReceived: fixture.mark }) }));
vi.mock("@/lib/liveBusStore", () => ({ invalidateLiveBusCache: fixture.invalidate,
  subscribeLiveBusChangesByRoute: (route: string, next: (change: LiveBusChange) => void, error: (error: Error) => void) => {
    const listener = { next, error }; fixture.listeners.set(route, listener);
    return () => { if (fixture.listeners.get(route) === listener) fixture.listeners.delete(route); };
  } }));
vi.mock("next/dynamic", () => ({ default: (loader: () => Promise<{ default: ComponentType<Record<string, unknown>> }>) => {
  const Loaded = lazy(loader); return function TestDynamic(props: Record<string, unknown>) { return <Suspense><Loaded {...props} /></Suspense>; };
} }));
vi.mock("@/components/maps/PassengerTrackingMap", () => ({ default: () => <div>Map</div> }));
vi.mock("@/components/passenger/PassengerBoardingView", () => ({ default: ({ onJoined, sessionId }: { onJoined: () => void; sessionId: string }) => <button onClick={onJoined}>Join {sessionId}</button> }));
vi.mock("@/components/passenger/ui/RouteCarousel", () => ({ default: ({ onClick }: { onClick: (route: string) => void }) => <><button onClick={() => onClick("A")}>Track A</button><button onClick={() => onClick("B")}>Track B</button></> }));
vi.mock("@/components/passenger/AccountTab", () => ({ default: () => <div>Account</div> }));
vi.mock("@/components/shared/MessagingPanel", () => ({ default: () => <div>Chat</div> }));
vi.mock("@/components/shared/FeedbackModal", () => ({ default: ({ sessionId }: { sessionId: string }) => <div>Feedback {sessionId}</div> }));
const bus = (route = "A", session = "joined") => ({ busId: "bus", routeId: route, sessionId: session, driverId: "driver", status: "active", tripState: "in_service", direction: "forward", lat: 23, lng: 72, timestamp: Date.now() });
const deliver = (route: string, value = bus(route)) => fixture.listeners.get(route)!.next({ type: "reset", snapshot: { [`node:bus_${route}`]: value }, source: "listener" });
beforeEach(() => { fixture.listeners.clear(); fixture.mark.mockClear(); fixture.invalidate.mockClear(); fixture.generation = 0; });
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function join() {
  render(<PassengerWorkspace />);
  act(() => deliver("A"));
  fireEvent.click(await screen.findByRole("button", { name: "Track A" }));
  fireEvent.click(await screen.findByRole("button", { name: "Join joined" }));
  await act(async () => { await Promise.resolve(); });
}
describe("passenger route recovery", () => {
  it("waits for authoritative snapshots from both selected and joined routes and fences detached callbacks", async () => {
    await join();
    fireEvent.click(screen.getByRole("button", { name: "Back to home" }));
    fireEvent.click(await screen.findByRole("button", { name: "Track B" }));
    fixture.mark.mockClear();
    const oldA = fixture.listeners.get("A")!.next;
    act(() => fixture.listeners.get("B")!.next({ type: "reset", snapshot: null, source: "cache" }));
    expect(fixture.mark).not.toHaveBeenCalled();
    act(() => deliver("B", bus("B", "other"))); expect(fixture.mark).not.toHaveBeenCalled();
    act(() => fixture.listeners.get("A")!.next({ type: "upsert", key: "node:bus_A", value: bus(), source: "listener" })); expect(fixture.mark).toHaveBeenCalledOnce();
    fixture.mark.mockClear();
    act(() => fixture.listeners.get("A")!.next({ type: "reset", snapshot: null, source: "invalidation" }));
    act(() => deliver("B", bus("B", "other"))); expect(fixture.mark).not.toHaveBeenCalled();
    cleanup(); act(() => oldA({ type: "reset", snapshot: { bus: bus() }, source: "listener" }));
    expect(fixture.mark).not.toHaveBeenCalled();
  });
  it("shows detail permission denial and retries without treating invalidation as an empty fleet", async () => {
    render(<PassengerWorkspace />); await act(async () => { await Promise.resolve(); });
    act(() => fixture.listeners.get("A")!.error(new Error("permission denied")));
    expect(screen.getByRole("alert").textContent).toContain("Live bus data");
    fireEvent.click(screen.getByRole("button", { name: "Retry" })); expect(fixture.invalidate).toHaveBeenCalledOnce();
    act(() => deliver("A")); expect(screen.queryByRole("alert")).toBeNull();
  });
  it("finishes the joined predecessor and prompts feedback after a coalesced automatic return", async () => {
    await join(); vi.useFakeTimers();
    act(() => deliver("A", { ...bus("A", "return"), tripState: "pre_departure", automaticTurnaround: true, previousSessionId: "joined" } as ReturnType<typeof bus>));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Route ended")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(screen.getByText("Feedback joined")).toBeTruthy();
    expect(screen.queryByText("Feedback return")).toBeNull();
  });
});
