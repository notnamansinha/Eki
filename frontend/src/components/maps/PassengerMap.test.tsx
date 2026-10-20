// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from "react";
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
  onReadError: undefined as undefined | ((error: Error) => void),
  unsubscribe: vi.fn(), arrivals: vi.fn(), panTo: vi.fn(), setZoom: vi.fn(), fitBounds: vi.fn(),
  markerRenders: new Map<string, number>(),
}));
const map = { panTo: state.panTo, setZoom: state.setZoom, fitBounds: state.fitBounds };
vi.mock("@vis.gl/react-google-maps", () => ({
  Map: ({ children }: { children: ReactNode }) => <div aria-label="Map">{children}</div>,
  AdvancedMarker: ({ children, position, anchorLeft, anchorTop }: { children: ReactNode; position: unknown; anchorLeft?: string; anchorTop?: string }) => {
    const key = JSON.stringify(position);
    state.markerRenders.set(key, (state.markerRenders.get(key) ?? 0) + 1);
    return <div data-marker={key} data-anchor={JSON.stringify([anchorLeft, anchorTop])}>{children}</div>;
  },
  useMap: () => map,
}));
vi.mock("@/lib/liveBusStore", () => ({ subscribeLiveBusesByRoute: (_routeId: string, listener: typeof state.listener, onReadError?: typeof state.onReadError) => {
  state.listener = listener; state.onReadError = onReadError; listener?.(state.snapshot); return state.unsubscribe;
} }));
vi.mock("@/components/maps/DirectionsRoute", () => ({ default: ({ nextStopIndices, firstStopIndex }: ComponentProps<typeof import("./DirectionsRoute").default>) => <div data-testid="road" data-next={JSON.stringify(nextStopIndices)} data-first={firstStopIndex}>Configured road geometry</div> }));
vi.mock("@/hooks/useDynamicRouteGeometries", () => ({ useDynamicRouteGeometries: () => state.geometries }));
// Animation has its own real RAF suite; this test isolates map/session routing.
vi.mock("@/hooks/useSmoothPosition", () => ({ useSmoothPosition: (position: unknown) => position }));
vi.mock("@/lib/busEta", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/busEta")>()),
  busStopArrivalTimestamps: state.arrivals,
}));
beforeEach(() => {
  vi.clearAllMocks(); state.listener = undefined; state.onReadError = undefined; state.geometries.clear();
  state.markerRenders.clear();
  state.snapshot = { bus: { ...fixtureBus("forward"), currentStopIndex: 0 } };
  state.arrivals.mockReturnValue({ b: Date.now() + 60_000 });
});

describe("published passenger stop progress", () => {
  it("distinguishes a camera fallback from an explicitly selected or cleared destination", async () => {
    const props = { route: directed, targetStop: route.stops[1], preview: true };
    const view = render(<PassengerMap {...props} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Configured route" }));
    expect(screen.queryByText("Selected stop")).toBeNull();
    expect(screen.getAllByText("Route endpoint")).toHaveLength(2);
    view.rerender(<PassengerMap {...props} selectedDestinationStopId="b" />);
    expect(screen.getByText("Selected stop").parentElement?.parentElement?.textContent).toContain("Beta");
    view.rerender(<PassengerMap {...props} selectedDestinationStopId="" />);
    expect(screen.queryByText("Selected stop")).toBeNull();
    expect(screen.getAllByText("Route endpoint")).toHaveLength(2);
  });
  const stops = ["Alpha", "Beta", "Gamma", "Delta"].map((name, index) => ({
    id: name.toLowerCase(), name, shortName: name[0], lat: 23 + index * 0.01, lng: 72 + index * 0.01,
  }));
  const tripRoute = { ...route, stops };
  const road = { polyline: "_ekkC_omvLo}@o}@o}@o}@o}@o}@", polylineQuality: "HIGH_QUALITY" as const };
  const row = (name: string) => screen.getByText(name).parentElement!.parentElement!;
  const next = () => screen.queryByText("Next Stop")?.parentElement?.textContent;
  const openTimeline = () => userEvent.setup().click(screen.getByRole("button", { name: "Route Timeline" }));

  it.each(["forward", "reverse"] as const)("keeps timeline, labels, ETA and active leg on published progress in %s travel", async direction => {
    const directedRoute = { ...routeInRideDirection(tripRoute, direction), ...road };
    const downstream = directedRoute.stops[2];
    const bus = { ...fixtureBus(direction), lat: downstream.lat + 25 / 111_320, lng: downstream.lng, currentStopIndex: 1 };
    state.snapshot = { bus };
    const view = render(<PassengerMap route={directedRoute} targetStop={directedRoute.stops[3]} />);
    await openTimeline();
    const expected = directedRoute.stops[1];
    expect(next()).toContain(expected.name);
    expect(row(expected.name).className).toContain("opacity-100");
    const marker = view.container.querySelector(`[data-marker='${JSON.stringify({ lat: expected.lat, lng: expected.lng })}']`);
    expect((marker?.firstElementChild as HTMLElement).style.opacity).not.toBe("0.6");
    expect(screen.getByTestId("road").getAttribute("data-next")).toBe("[1]");
    expect(state.arrivals.mock.lastCall?.[0].remainingStops.map((stop: { id: string }) => stop.id)).toEqual(directedRoute.stops.slice(1).map(stop => stop.id));
    // A repeated snapshot and more fixes inside/outside the old hysteresis
    // must not borrow downstream proximity as proof of ordered arrival.
    for (const offset of [25, 24, 50, 25]) {
      act(() => state.listener?.({ bus: { ...bus, lat: downstream.lat + offset / 111_320, seq: offset } }));
      expect(next()).toContain(expected.name);
      expect(screen.getByTestId("road").getAttribute("data-next")).toBe("[1]");
    }
    act(() => state.listener?.({ bus: { ...bus, currentStopIndex: 2, seq: 100 } }));
    expect(next()).toContain(downstream.name);
    expect(row(expected.name).className).toContain("opacity-25");
    expect(screen.getByTestId("road").getAttribute("data-next")).toBe("[2]");
    expect(state.arrivals.mock.lastCall?.[0].remainingStops.map((stop: { id: string }) => stop.id)).toEqual(directedRoute.stops.slice(2).map(stop => stop.id));
  });

  it("accepts a corrected index and clears it when progress disappears or a session changes", async () => {
    const directedRoute = { ...routeInRideDirection(tripRoute, "forward"), ...road };
    const bus = { ...fixtureBus("forward"), lat: stops[1].lat, lng: stops[1].lng, currentStopIndex: 2 };
    state.snapshot = { bus };
    render(<PassengerMap route={directedRoute} targetStop={stops[3]} />);
    await openTimeline();
    expect(next()).toContain("Gamma");
    act(() => state.listener?.({ bus: { ...bus, currentStopIndex: 1 } }));
    expect(next()).toContain("Beta");
    const etaCalls = state.arrivals.mock.calls.length;
    act(() => state.listener?.({ bus: { ...bus, currentStopIndex: undefined } }));
    expect(next()).toBeUndefined();
    expect(state.arrivals).toHaveBeenCalledTimes(etaCalls);
    expect(screen.getByText("Stop progress unavailable.")).toBeTruthy();
    expect(screen.getByTestId("road").getAttribute("data-next")).toBe("[]");
    for (const stop of stops) expect(row(stop.name).className).toContain("opacity-100");
    state.arrivals.mockClear();
    act(() => state.listener?.({ bus: { ...bus, sessionId: "replacement-session", currentStopIndex: undefined } }));
    expect(next()).toBeUndefined();
    expect(state.arrivals).not.toHaveBeenCalled();
  });

  it("does not skip nearby stops or a colocated terminus before published departure", async () => {
    const loopStops = [stops[0], { ...stops[1], lat: stops[0].lat + 20 / 111_320, lng: stops[0].lng }, stops[2], { ...stops[3], lat: stops[0].lat, lng: stops[0].lng }];
    state.snapshot = { bus: { ...fixtureBus("forward"), currentStopIndex: 0, tripState: "pre_departure" } };
    render(<PassengerMap route={{ ...routeInRideDirection({ ...tripRoute, stops: loopStops }, "forward"), ...road }} targetStop={loopStops[3]} />);
    await openTimeline();
    expect(next()).toContain("Alpha");
    for (const stop of stops) expect(row(stop.name).className).toContain("opacity-100");
    expect(state.arrivals.mock.lastCall?.[0].remainingStops.map((stop: { id: string }) => stop.id)).toEqual(loopStops.map(stop => stop.id));
    expect(screen.getByTestId("road").getAttribute("data-next")).toBe("[0]");
  });

  it("uses only the replacement session's progress on reverse turnaround and removal", async () => {
    const bus = { ...fixtureBus("forward"), currentStopIndex: 3 };
    state.snapshot = { bus };
    const view = render(<PassengerMap route={{ ...routeInRideDirection(tripRoute, "forward"), ...road }} targetStop={stops[3]} selectedBusKey="session:qa-session" />);
    await openTimeline(); expect(next()).toContain("Delta");
    state.snapshot = { bus: { ...bus, sessionId: "reverse-session", direction: "reverse", currentStopIndex: 0, tripState: "pre_departure" } };
    view.rerender(<PassengerMap route={{ ...routeInRideDirection(tripRoute, "reverse"), ...road }} targetStop={stops[0]} selectedBusKey="session:reverse-session" />);
    await openTimeline(); expect(next()).toContain("Delta");
    for (const stop of stops) expect(row(stop.name).className).toContain("opacity-100");
    act(() => state.listener?.({}));
    expect(next()).toBeUndefined();
    expect(screen.getByTestId("road").getAttribute("data-next")).toBe("[]");
  });

  it.each([undefined, "2", -1, 1.5, 4, Number.MAX_SAFE_INTEGER])("does not infer stop progress or ETA from an invalid published index %s", async currentStopIndex => {
    state.snapshot = { bus: { ...fixtureBus("forward"), ...stops[2], currentStopIndex } };
    render(<PassengerMap route={{ ...routeInRideDirection(tripRoute, "forward"), ...road }} targetStop={stops[3]} />);
    await openTimeline();
    expect(next()).toBeUndefined();
    for (const stop of stops) expect(row(stop.name).className).toContain("opacity-100");
    expect(state.arrivals).not.toHaveBeenCalled();
    expect(screen.getByTestId("road").getAttribute("data-next")).toBe("[]");
  });

  it("keeps each bus's ETA progress and dynamic leg separate from fleet timeline progress", async () => {
    state.snapshot = {
      first: { ...fixtureBus("forward"), currentStopIndex: 1 },
      second: { ...fixtureBus("forward", "second-session", "second-bus"), currentStopIndex: 2, routeSource: "dynamic-reroute", routeVersion: 2 },
    };
    state.geometries.set("second-bus", { ...road, firstStopIndex: 2 });
    const directedRoute = { ...routeInRideDirection(tripRoute, "forward"), ...road };
    const view = render(<PassengerMap route={directedRoute} targetStop={stops[3]} />);
    await openTimeline();
    expect(next()).toBeUndefined();
    for (const stop of stops) expect(row(stop.name).className).toContain("opacity-100");
    expect(screen.getAllByTestId("road").map(node => node.getAttribute("data-next"))).toEqual(["[1]", "[2]"]);
    expect(state.arrivals.mock.calls.map(call => call[0].remainingStops[0].id)).toEqual(expect.arrayContaining([stops[1].id, stops[2].id]));
    view.rerender(<PassengerMap route={directedRoute} targetStop={stops[3]} selectedBusKey="session:second-session" />);
    await openTimeline();
    expect(next()).toContain("Gamma");
    expect(screen.getAllByTestId("road").map(node => node.getAttribute("data-next"))).toEqual(["[]", "[2]"]);
  });

  it("keeps a configured preview separate from cached dynamic geometry and live progress", () => {
    state.snapshot = { bus: { ...fixtureBus("forward"), currentStopIndex: 2, routeSource: "dynamic-reroute", routeVersion: 2 } };
    state.geometries.set("qa-bus", { ...road, firstStopIndex: 1 });
    render(<PassengerMap route={{ ...routeInRideDirection(tripRoute, "forward"), ...road }} targetStop={stops[3]} preview />);
    expect(screen.getAllByTestId("road")).toHaveLength(1);
    expect(screen.getByTestId("road").getAttribute("data-next")).toBeNull();
    expect(state.arrivals).not.toHaveBeenCalled();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const directed = { ...routeInRideDirection(route, "forward"), polyline: "_ekkC_omvLo}@o}@", polylineQuality: "HIGH_QUALITY" as const };
describe("passenger map device and ride contexts", () => {
  it("shows a live-data failure and clears it after a recovered snapshot", () => {
    render(<PassengerMap route={directed} targetStop={route.stops[1]} />);
    act(() => state.onReadError?.(new Error("permission denied")));
    expect(screen.getByRole("alert").textContent).toContain("Live bus updates are unavailable");
    act(() => state.listener?.(state.snapshot));
    expect(screen.queryByText(/Live bus updates are unavailable/)).toBeNull();
  });
  it("does not render an unchanged bus marker on another bus's tick", () => {
    const first = fixtureBus("forward");
    const second = { ...fixtureBus("forward", "qa-session-2", "qa-bus-2"), lat: 23.005, lng: 72.005 };
    state.snapshot = { first, second };
    render(<PassengerMap route={directed} targetStop={route.stops[1]} />);
    expect(screen.getByTitle(/^qa-bus(?: —.*)?$/).closest("[data-marker]")?.getAttribute("data-anchor")).toBe('["-50%","-50%"]');
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
  it("announces delayed location without diagnosing GNSS loss when an armed bus goes silent", async () => {
    vi.useFakeTimers(); state.snapshot = { bus: fixtureBus("forward") };
    await act(async () => { render(<PassengerMap route={directed} targetStop={route.stops[1]} />); });
    expect(screen.queryByText(/Live location updates delayed/)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(SIGNAL_LOST_MS + 15_001); });
    expect(screen.getByText(/Live location updates delayed/)).toBeTruthy();
    expect(screen.queryByText(/GPS signal lost|reconnecting/)).toBeNull();
    await act(async () => { state.listener?.({ bus: fixtureBus("forward") }); });
    expect(screen.queryByText(/Live location updates delayed/)).toBeNull();
  });
  it("keeps fresh streamed fixes online between the 15-second clock ticks", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    state.snapshot = { bus: fixtureBus("forward") };
    await act(async () => { render(<PassengerMap route={directed} targetStop={route.stops[1]} />); });
    // New telemetry arrives before the independent silence timer next fires.
    vi.setSystemTime(start + 12_000);
    await act(async () => { state.listener?.({ bus: fixtureBus("forward") }); });
    expect(screen.queryByText(/Live location updates delayed/)).toBeNull();
  });
  it("clears old ETAs after the selected bus disappears", async () => {
    render(<PassengerMap route={directed} targetStop={route.stops[1]} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Route Timeline" }));
    expect(screen.getByText("min")).toBeTruthy();
    act(() => state.listener?.({}));
    expect(screen.queryByText("min")).toBeNull();
  });
});
