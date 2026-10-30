// @vitest-environment jsdom
// Adversarial probes of PassengerMap live health: silent buses, GNSS flaps,
// mixed fleets, render/effect churn.
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PassengerMap from "./PassengerMap";
import { routeInRideDirection } from "@/lib/rideDirection";
import { LIVE_DELAYED_MS, SIGNAL_LOST_MS } from "@/lib/liveBusFreshness";
import { route, fixtureBus } from "../../../../e2e/fixtures/state";
const state = vi.hoisted(() => ({
  geometries: new Map(), snapshot: {} as Record<string, unknown>, listener: undefined as undefined | ((value: Record<string, unknown>) => void),
  unsubscribe: vi.fn(), arrivals: vi.fn(), renders: 0,
}));
const map = { panTo: vi.fn(), setZoom: vi.fn(), fitBounds: vi.fn(), getDiv: vi.fn<() => HTMLElement | undefined>() };
vi.mock("@vis.gl/react-google-maps", () => ({
  Map: ({ children }: { children: ReactNode }) => { state.renders++; return <div aria-label="Map">{children}</div>; },
  AdvancedMarker: ({ children, position }: { children: ReactNode; position: unknown }) => <div data-marker={JSON.stringify(position)}>{children}</div>,
  useMap: () => map,
}));
vi.mock("@/lib/liveBusStore", () => ({ subscribeLiveBusesByRoute: (_routeId: string, listener: typeof state.listener) => {
  state.listener = listener; listener?.(state.snapshot); return state.unsubscribe;
} }));
vi.mock("@/components/maps/DirectionsRoute", () => ({ default: () => <div data-testid="road" /> }));
vi.mock("@/hooks/useDynamicRouteGeometries", () => ({ useDynamicRouteGeometries: () => state.geometries }));
vi.mock("@/hooks/useSmoothPosition", () => ({ useSmoothPosition: (position: unknown) => position }));
vi.mock("@/lib/busEta", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/busEta")>()),
  busStopArrivalTimestamps: state.arrivals,
}));
const directed = { ...routeInRideDirection(route, "forward"), polyline: "_ekkC_omvLo}@o}@", polylineQuality: "HIGH_QUALITY" as const };
beforeEach(() => {
  vi.clearAllMocks(); state.listener = undefined; state.geometries.clear(); state.renders = 0;
  map.getDiv.mockReturnValue(undefined);
  state.arrivals.mockImplementation(({ now }: { now: number }) => ({ b: now + 60_000 }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("passenger map live health", () => {
  it("clears 'GPS signal lost' on the very next good fix", async () => {
    vi.useFakeTimers();
    const bus = { ...fixtureBus("forward"), currentStopIndex: 1 };
    state.snapshot = { bus };
    await act(async () => { render(<PassengerMap route={directed} targetStop={route.stops[1]} />); });
    await act(async () => { state.listener?.({ bus: { ...bus, motionState: "uncertain", signalState: "gnss_lost", timestamp: Date.now(), backendReceivedAt: Date.now(), seq: 2 } }); });
    expect(screen.getByText("GPS signal lost")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await act(async () => { state.listener?.({ bus: { ...bus, motionState: "moving", signalState: "connected", timestamp: Date.now(), backendReceivedAt: Date.now(), seq: 3 } }); });
    expect(screen.queryByText(/GPS signal lost|Live tracking lost|Updates delayed/)).toBeNull();
  });

  it("does not spam onStopEstimatesChange or re-render in a loop during a long silence", async () => {
    vi.useFakeTimers();
    state.snapshot = { bus: { ...fixtureBus("forward"), currentStopIndex: 1 } };
    const changed = vi.fn();
    await act(async () => { render(<PassengerMap route={directed} targetStop={route.stops[1]} onStopEstimatesChange={changed} />); });
    const callsAtStart = changed.mock.calls.length; const rendersAtStart = state.renders;
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    // 15 s ETA ticks (20) + 5 s degraded refresh (~60) + threshold crossings.
    expect(changed.mock.calls.length - callsAtStart).toBeLessThan(40);
    expect(state.renders - rendersAtStart).toBeLessThan(200);
  });

  it("does not keep a lost bus's earlier arrival as the fleet ETA once it is declared lost", async () => {
    vi.useFakeTimers();
    const near = { ...fixtureBus("forward"), currentStopIndex: 1, lat: 23.009, lng: 72.009 };
    const far = { ...fixtureBus("forward", "qa-session-2", "qa-bus-2"), currentStopIndex: 1, lat: 23.001, lng: 72.001 };
    state.arrivals.mockImplementation(({ busPoint, now }: { busPoint: { lat: number }; now: number }) =>
      ({ b: now + (busPoint.lat === near.lat ? 60_000 : 600_000) }));
    state.snapshot = { near, far };
    await act(async () => { render(<PassengerMap route={directed} targetStop={route.stops[1]} />); });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Route Timeline" })); });
    // 'far' keeps reporting until t=20 s, then the backend dies; 'near' went silent at t=0.
    for (let t = 0; t < 20; t++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      await act(async () => { state.listener?.({ near, far: { ...far, timestamp: Date.now(), backendReceivedAt: Date.now(), seq: t + 2 } }); });
    }
    const timelineText = () => document.querySelector("[data-map-sheet]")?.textContent ?? document.body.textContent ?? "";
    // Precondition: near's 1-minute arrival is the fleet ETA while it is still delayed.
    expect(timelineText()).toMatch(/1\s*min/);
    await act(async () => { await vi.advanceTimersByTimeAsync(SIGNAL_LOST_MS - 20_000 + 100); });
    // near is now lost; far is live (silent ~10 s).
    expect(screen.getByTitle(/qa-bus — last known location/)).toBeTruthy();
    expect(timelineText()).not.toMatch(/(^|\D)1\s*min/);
  });

  it("in the aggregate view too, when the lost threshold falls just after a 15 s ETA tick", async () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    // near last reported 14 s before mount: it is lost at t=16 s, just after the t=15 s tick.
    const near = { ...fixtureBus("forward"), currentStopIndex: 1, lat: 23.009, lng: 72.009, timestamp: t0 - 14_000, backendReceivedAt: t0 - 14_000 };
    const far = { ...fixtureBus("forward", "qa-session-2", "qa-bus-2"), currentStopIndex: 1, lat: 23.001, lng: 72.001 };
    state.arrivals.mockImplementation(({ busPoint, now }: { busPoint: { lat: number }; now: number }) =>
      ({ b: now + (busPoint.lat === near.lat ? 60_000 : 600_000) }));
    state.snapshot = { near, far };
    await act(async () => { render(<PassengerMap route={directed} targetStop={route.stops[1]} />); });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Route Timeline" })); });
    for (let t = 0; t < 10; t++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      await act(async () => { state.listener?.({ near, far: { ...far, timestamp: Date.now(), backendReceivedAt: Date.now(), seq: t + 2 } }); });
    }
    const timelineText = () => document.querySelector("[data-map-sheet]")?.textContent ?? "";
    expect(timelineText()).toMatch(/(^|\D)1\s*min/);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); }); // t = 15.1 s: ETA tick, near still 'delayed'
    await act(async () => { await vi.advanceTimersByTimeAsync(1_400); }); // t = 16.5 s: near lost
    expect(screen.getByText("Live tracking lost")).toBeTruthy();
    expect(screen.getByTitle(/^qa-bus — last known location/)).toBeTruthy();
    expect(timelineText()).not.toMatch(/(^|\D)1\s*min/);
  });

  it("a silent-but-delayed bus is not drawn as a normal moving bus", async () => {
    vi.useFakeTimers();
    const t = Date.now();
    const raw = { lat: 23.002, lng: 72.002, speed: 30, heading: 45, gpsHdop: 1, motionState: "moving", seq: 7, sampledAt: t };
    state.snapshot = { bus: { ...fixtureBus("forward"), ...raw, timestamp: t, backendReceivedAt: t, rawLocation: raw,
      routeState: "ON_ROUTE", routeDirection: "forward", routeVersion: 1,
      matchedLocation: { lat: 23.002, lng: 72.002, segmentIndex: 0, segmentFraction: 0.2, alongRouteDistanceM: 300, distanceToRouteM: 2,
        matchConfidence: 0.95, seq: 7, sampledAt: t, routeVersion: 1 } } };
    await act(async () => { render(<PassengerMap route={directed} targetStop={route.stops[1]} />); });
    // Precondition: a live, matched bus is drawn as a normal moving bus.
    expect(screen.getByTitle("qa-bus — moving")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_DELAYED_MS + 5_000); });
    expect(screen.getByText("Updates delayed")).toBeTruthy();
    // The marker label is the only per-bus status a screen reader gets.
    expect(screen.queryByTitle("qa-bus — moving")).toBeNull();
  });

  it("timeline drops 'Bus is here' once tracking is lost (backend shut down at a stop)", async () => {
    vi.useFakeTimers();
    state.snapshot = { bus: { ...fixtureBus("forward"), currentStopIndex: 1, atStopIndex: 0 } };
    await act(async () => { render(<PassengerMap route={directed} targetStop={route.stops[1]} />); });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Route Timeline" })); });
    expect(screen.getByText("Bus is here")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(SIGNAL_LOST_MS + 100); });
    expect(screen.getByText("Live tracking lost")).toBeTruthy();
    expect(screen.queryByText("Bus is here")).toBeNull();
  });
});
