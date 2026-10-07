// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import PassengerMap from "./PassengerMap";
import { StopProjectionCache } from "@/lib/busEta";
import { routeInRideDirection } from "@/lib/rideDirection";
import { SIGNAL_LOST_MS } from "@/lib/liveBusFreshness";
import { route, fixtureBus } from "../../../../e2e/fixtures/state";
const state = vi.hoisted(() => ({
  geometries: new Map(), snapshot: {} as Record<string, unknown>, listener: undefined as undefined | ((value: Record<string, unknown>) => void),
  unsubscribe: vi.fn(), arrivals: vi.fn(), panTo: vi.fn(), setZoom: vi.fn(), fitBounds: vi.fn(),
  markerRenders: new Map<string, number>(),
}));
const map = { panTo: state.panTo, setZoom: state.setZoom, fitBounds: state.fitBounds };
vi.mock("@vis.gl/react-google-maps", () => ({
  Map: ({ children }: { children: ReactNode }) => <div aria-label="Map">{children}</div>,
  AdvancedMarker: ({ children, position }: { children: ReactNode; position: unknown }) => {
    const key = JSON.stringify(position);
    state.markerRenders.set(key, (state.markerRenders.get(key) ?? 0) + 1);
    return <div data-marker={key}>{children}</div>;
  },
  useMap: () => map,
}));
vi.mock("@/lib/liveBusStore", () => ({ subscribeLiveBusesByRoute: (_routeId: string, listener: typeof state.listener) => {
  state.listener = listener; listener?.(state.snapshot); return state.unsubscribe;
} }));
vi.mock("@/components/maps/DirectionsRoute", () => ({ default: () => <div>Configured road geometry</div> }));
vi.mock("@/hooks/useDynamicRouteGeometries", () => ({ useDynamicRouteGeometries: () => state.geometries }));
// Animation has its own real RAF suite; this test isolates map/session routing.
vi.mock("@/hooks/useSmoothPosition", () => ({ useSmoothPosition: (position: unknown) => position }));
vi.mock("@/lib/busEta", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/busEta")>()),
  busStopArrivalTimestamps: state.arrivals,
}));
beforeEach(() => {
  vi.clearAllMocks(); state.listener = undefined;
  state.markerRenders.clear();
  state.snapshot = { bus: fixtureBus("forward") };
  state.arrivals.mockReturnValue({ b: Date.now() + 60_000 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const directed = { ...routeInRideDirection(route, "forward"), polyline: "_ekkC_omvLo}@o}@", polylineQuality: "HIGH_QUALITY" as const };
describe("passenger map device and ride contexts", () => {
  it("does not render an unchanged bus marker on another bus's tick", () => {
    const first = fixtureBus("forward");
    const second = { ...fixtureBus("forward", "qa-session-2", "qa-bus-2"), lat: 23.005, lng: 72.005 };
    state.snapshot = { first, second };
    render(<PassengerMap route={directed} targetStop={route.stops[1]} />);
    const secondPosition = JSON.stringify({ lat: second.lat, lng: second.lng });
    const before = state.markerRenders.get(secondPosition) ?? 0;
    expect(before).toBeGreaterThan(0);
    act(() => state.listener?.({ first: { ...first, lat: 23.001, seq: (first.seq ?? 0) + 1 }, second }));
    expect(state.markerRenders.get(secondPosition)).toBe(before);
    expect(state.markerRenders.get(JSON.stringify({ lat: 23.001, lng: first.lng }))).toBeGreaterThan(0);
  });
  it("clears route projection state on route switch and unmount", () => {
    const clear = vi.spyOn(StopProjectionCache.prototype, "clear");
    const view = render(<PassengerMap route={directed} targetStop={route.stops[1]} />);
    view.rerender(<PassengerMap route={{ ...directed, id: "other-route" }} targetStop={route.stops[1]} />);
    expect(clear).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(clear).toHaveBeenCalledTimes(2);
    clear.mockRestore();
  });
  it("does not use the first bus's progress in a multi-bus view", async () => {
    state.snapshot = {
      bus: { ...fixtureBus("forward"), currentStopIndex: 1 },
      second: { ...fixtureBus("forward", "qa-session-2", "qa-bus-2"), currentStopIndex: 0 },
    };
    render(<PassengerMap route={directed} targetStop={route.stops[1]} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Route Timeline" }));
    expect(screen.queryByText("Next Stop")).toBeNull();
    expect(screen.getByText(/Earliest arrival across buses/)).toBeTruthy();
    act(() => state.listener?.({ second: state.snapshot.second, bus: state.snapshot.bus }));
    expect(screen.queryByText("Next Stop")).toBeNull();
  });
  it("withholds road ETA for missing, corrupt, or untrusted geometry", async () => {
    const { rerender } = render(<PassengerMap route={{ ...directed, polyline: "" }} targetStop={route.stops[1]} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Route Timeline" }));
    expect(screen.getByText(/Road geometry unavailable/)).toBeTruthy();
    expect(state.arrivals).not.toHaveBeenCalled();
    rerender(<PassengerMap route={{ ...directed, polyline: "~" }} targetStop={route.stops[1]} />);
    expect(state.arrivals).not.toHaveBeenCalled();
    rerender(<PassengerMap route={{ ...directed, polylineQuality: undefined }} targetStop={route.stops[1]} />);
    expect(state.arrivals).not.toHaveBeenCalled();
  });
  it("withholds a rerouted bus's ETA until its own geometry arrives", () => {
    state.snapshot = { bus: { ...fixtureBus("forward"), routeSource: "dynamic-reroute", routeVersion: 2 } };
    render(<PassengerMap route={directed} targetStop={route.stops[1]} />);
    expect(state.arrivals).not.toHaveBeenCalled();
  });
  it("renders stopped device coordinates and configured stops without computing ride ETAs or progress", async () => {
    state.snapshot = { bus: { ...fixtureBus(), sessionId: undefined, status: "offline", tripState: undefined, speed: 0 } };
    render(<PassengerMap route={directed} targetStop={route.stops[1]} preview selectedBusKey="bus:qa-route:qa-bus" />);
    expect(await screen.findByTitle(/qa-bus/)).toBeTruthy();
    expect(state.fitBounds).toHaveBeenLastCalledWith({ north: 23.01, south: 23, east: 72.01, west: 72 }, expect.any(Object));
    expect(state.panTo).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Configured route" }));
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("Next Stop")).toBeNull();
    expect(screen.queryByText("Boarding Stop")).toBeNull();
    expect(state.arrivals).not.toHaveBeenCalled();
  });
  it("frames an off-route stationary bus with the route, then lets the passenger focus the bus", async () => {
    const device = { ...fixtureBus(), sessionId: undefined, status: "offline", tripState: undefined, lat: 23.1, lng: 72.1 };
    state.snapshot = { bus: device };
    render(<PassengerMap route={directed} targetStop={route.stops[1]} preview />);
    expect(await screen.findByTitle(/qa-bus/)).toBeTruthy();
    expect(state.fitBounds).toHaveBeenLastCalledWith({ north: 23.1, south: 23, east: 72.1, west: 72 }, expect.any(Object));
    const fitted = state.fitBounds.mock.calls.length;
    act(() => state.listener?.({ bus: { ...device, lat: 23.11, seq: 2 } }));
    expect(state.fitBounds).toHaveBeenCalledTimes(fitted);
    fireEvent.pointerDown(screen.getByLabelText("Map").parentElement!);
    act(() => state.listener?.({ bus: { ...device, lat: 23.12, seq: 3 } }));
    expect(state.fitBounds).toHaveBeenCalledTimes(fitted);
    expect(state.panTo).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Center on bus" }));
    expect(state.panTo).toHaveBeenLastCalledWith({ lat: 23.12, lng: 72.1 });
    expect(state.setZoom).toHaveBeenLastCalledWith(16);
  });
  it("frames the route while GPS is missing and includes the first fix without resetting on every update", async () => {
    state.snapshot = {};
    render(<PassengerMap route={directed} targetStop={route.stops[1]} preview />);
    expect(state.fitBounds).toHaveBeenLastCalledWith({ north: 23.01, south: 23, east: 72.01, west: 72 }, expect.any(Object));
    act(() => state.listener?.({ bus: { ...fixtureBus(), sessionId: undefined, status: "offline", tripState: undefined, lat: 23.1, lng: 72.1 } }));
    expect(await screen.findByTitle(/qa-bus/)).toBeTruthy();
    expect(state.fitBounds).toHaveBeenLastCalledWith({ north: 23.1, south: 23, east: 72.1, west: 72 }, expect.any(Object));
  });
  it("keeps a direction-pending session visible as raw GPS without inferred progress", async () => {
    state.snapshot = { bus: fixtureBus() };
    render(<PassengerMap route={directed} targetStop={route.stops[1]} preview selectedBusKey="session:qa-session" />);
    expect(await screen.findByTitle(/qa-bus/)).toBeTruthy();
    expect(state.arrivals).not.toHaveBeenCalled();
  });
  it("switches same-route buses and centers/estimates only the selected session", async () => {
    state.snapshot.second = { ...fixtureBus("forward", "qa-session-2", "qa-bus-2"), lat: 23.005, lng: 72.005 };
    const { rerender } = render(<PassengerMap route={directed} targetStop={route.stops[1]} selectedBusKey="session:qa-session" />);
    expect(await screen.findByTitle(/^qa-bus(?: —.*)?$/)).toBeTruthy();
    expect(screen.queryByTitle(/qa-bus-2/)).toBeNull();
    rerender(<PassengerMap route={directed} targetStop={route.stops[1]} selectedBusKey="session:qa-session-2" />);
    expect(await screen.findByTitle(/qa-bus-2/)).toBeTruthy();
    expect(screen.queryByTitle(/^qa-bus(?: —.*)?$/)).toBeNull();
    expect(state.panTo).toHaveBeenLastCalledWith({ lat: 23.005, lng: 72.005 });
    expect(state.unsubscribe).toHaveBeenCalled();
  });
  it("shows a waiting message for an online device that has no usable GPS fix", () => {
    state.snapshot = { bus: { ...fixtureBus(), sessionId: undefined, tripState: undefined, status: "offline", lat: undefined, lng: undefined } };
    render(<PassengerMap route={directed} targetStop={route.stops[1]} preview />);
    expect(screen.getByRole("status").textContent).toContain("Waiting for a valid GPS fix");
    expect(state.arrivals).not.toHaveBeenCalled();
  });
  it("announces signal loss when an armed bus goes silent without another network event", async () => {
    vi.useFakeTimers(); state.snapshot = { bus: fixtureBus("forward") };
    await act(async () => { render(<PassengerMap route={directed} targetStop={route.stops[1]} />); });
    expect(screen.queryByText(/GPS signal lost/)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(SIGNAL_LOST_MS + 15_001); });
    expect(screen.getByText(/GPS signal lost/)).toBeTruthy();
  });
  it("clears old ETAs after the selected bus disappears", async () => {
    render(<PassengerMap route={directed} targetStop={route.stops[1]} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Route Timeline" }));
    expect(screen.getByText("min")).toBeTruthy();
    act(() => state.listener?.({}));
    expect(screen.queryByText("min")).toBeNull();
  });
});
