// @vitest-environment jsdom
// One file = one page session: Vitest isolates modules per file, so vis.gl's
// map cache and Maps loader start empty here. The first test is the first open.
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import {
  expectReusedInto, installScriptInterceptingFakeSdk, lastMap, reuseCall, sdkCounters, snapshotCounters,
  type CounterSnapshot, type FakeMap,
} from "@/test-support/fakeGoogleMapsSdk";
import PassengerTrackingMap from "@/components/maps/PassengerTrackingMap";
import { routeInRideDirection } from "@/lib/rideDirection";
import { setScenario, route } from "../../../../e2e/fixtures/state";

vi.mock("@vis.gl/react-google-maps", async importOriginal => ({
  ...(await importOriginal<typeof import("@vis.gl/react-google-maps")>()),
  // The real marker needs the `marker` library; markers are not map loads.
  AdvancedMarker: ({ children }: { children: ReactNode }) => <div data-fake-marker>{children}</div>,
}));
vi.mock("@/components/maps/DirectionsRoute", () => ({ default: () => null }));
vi.mock("@/lib/liveBusStore", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useDynamicRouteGeometries", async () => import("../../../../e2e/fixtures/state"));

const routeB = {
  ...route, id: "qa-route-2", name: "QA route B",
  stops: [{ id: "c", name: "Gamma", shortName: "C", lat: 23.02, lng: 72.03 }, { id: "d", name: "Delta", shortName: "D", lat: 23.05, lng: 72.06 }],
};
const forward = routeInRideDirection(route, "forward");
const reverse = routeInRideDirection(route, "reverse");
const otherForward = routeInRideDirection(routeB, "forward");
const base = { targetStop: route.stops[1], liveUpdatesAvailable: true };

let stopIntercepting: () => void;
beforeAll(() => { stopIntercepting = installScriptInterceptingFakeSdk(); });
afterEach(() => { cleanup(); setScenario("pending"); });
afterAll(() => stopIntercepting());

const mapContainer = () => document.querySelector("[data-passenger-map]");

async function waitForMountedMap() {
  await waitFor(() => expect(lastMap()?.getDiv().isConnected).toBe(true));
  await waitFor(() => expect(mapContainer()?.contains(lastMap()!.getDiv())).toBe(true));
  return lastMap()!;
}

/** Wait for vis.gl to reattach the cached instance, then assert nothing was constructed. */
async function expectRemountReused(map: FakeMap, before: CounterSnapshot) {
  await waitFor(() => expect(sdkCounters.mapsReused - before.mapsReused).toBe(1));
  await waitFor(() => expect(mapContainer()?.contains(map.getDiv())).toBe(true));
  expectReusedInto(map, before, mapContainer());
}

function expectFollowCamera(map: FakeMap) {
  const reused = reuseCall(map);
  expect(reused?.options.zoom).toBe(15);
  const center = reused?.options.center as { lat: number; lng: number };
  expect(Number.isFinite(center.lat) && Number.isFinite(center.lng)).toBe(true);
}

describe("passenger map loads (real PassengerTrackingMap + real vis.gl Map, fake SDK)", () => {
  it("constructs one google.maps.Map and loads the Maps script once on first open", async () => {
    setScenario("forward");
    const before = snapshotCounters();
    render(<PassengerTrackingMap {...base} route={forward} preview selectedBusKey={undefined} />);
    await waitForMountedMap();
    expect(sdkCounters.mapsConstructed - before.mapsConstructed).toBe(1);
    expect(sdkCounters.scriptLoads).toBe(1);
  });

  it("reuses the same map instance when the selected bus, preview state, ride direction or route changes", async () => {
    setScenario("forward");
    // Setup: constructs the map when run alone, reattaches it after an earlier test.
    const view = render(<PassengerTrackingMap {...base} route={forward} preview selectedBusKey={undefined} />);
    const map = await waitForMountedMap();

    const transitions = [
      <PassengerTrackingMap key="t" {...base} route={forward} preview selectedBusKey="session:qa-session" />,
      <PassengerTrackingMap key="t" {...base} route={forward} selectedBusKey="session:qa-session" />,
      <PassengerTrackingMap key="t" {...base} route={reverse} selectedBusKey="session:qa-session" />,
      <PassengerTrackingMap key="t" {...base} route={otherForward} selectedBusKey="session:qa-session" />,
    ];
    for (const next of transitions) {
      const before = snapshotCounters();
      view.rerender(next);
      await expectRemountReused(map, before);
      expectFollowCamera(map);
    }
    expect(sdkCounters.mapsConstructed).toBe(1);
    expect(sdkCounters.scriptLoads).toBe(1);
  });

  it("re-centres a reused preview map on the target stop and refits it to the new route", async () => {
    setScenario("empty");
    const view = render(<PassengerTrackingMap {...base} route={forward} preview />);
    const map = await waitForMountedMap();

    const before = snapshotCounters();
    const targetStop = routeB.stops[1];
    view.rerender(<PassengerTrackingMap {...base} targetStop={targetStop} route={otherForward} preview />);
    await expectRemountReused(map, before);

    const reused = reuseCall(map)!;
    expect(reused.options.center).toEqual({ lat: targetStop.lat, lng: targetStop.lng });
    await waitFor(() => expect(map.fitBoundsCalls.at(-1)?.seq ?? 0).toBeGreaterThan(reused.seq));
    expect(lastMap()).toBe(map);
    const bounds = map.fitBoundsCalls.at(-1)!.bounds as { north: number; south: number; east: number; west: number };
    for (const stop of routeB.stops) {
      expect(stop.lat).toBeGreaterThanOrEqual(bounds.south);
      expect(stop.lat).toBeLessThanOrEqual(bounds.north);
      expect(stop.lng).toBeGreaterThanOrEqual(bounds.west);
      expect(stop.lng).toBeLessThanOrEqual(bounds.east);
    }
  });

  it("follows the bus on a reused ride-mode map", async () => {
    setScenario("forward");
    const view = render(<PassengerTrackingMap {...base} route={forward} selectedBusKey="session:qa-session" />);
    const map = await waitForMountedMap();

    act(() => setScenario("reverse"));
    const before = snapshotCounters();
    view.rerender(<PassengerTrackingMap {...base} route={reverse} selectedBusKey="session:qa-session" />);
    await expectRemountReused(map, before);

    const reused = reuseCall(map)!;
    await waitFor(() => expect(map.panToCalls.at(-1)?.seq ?? 0).toBeGreaterThan(reused.seq));
    const panned = map.panToCalls.at(-1)!;
    expect(Number.isFinite(panned.lat) && Number.isFinite(panned.lng)).toBe(true);
    const zoom = map.setZoomCalls.at(-1)!;
    expect(zoom.seq).toBeGreaterThan(reused.seq);
    expect(zoom.zoom).toBe(16);
  });

  it("a same-session live GPS update never constructs or reattaches a map", async () => {
    setScenario("forward");
    render(<PassengerTrackingMap {...base} route={forward} selectedBusKey="session:qa-session" />);
    await waitForMountedMap();
    await waitFor(() => expect(document.querySelector("[data-fake-marker] [aria-label^='qa-bus']")).not.toBeNull());

    const before = snapshotCounters();
    await act(async () => {
      setScenario("forward");
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(sdkCounters.mapsConstructed - before.mapsConstructed).toBe(0);
    expect(sdkCounters.mapsReused - before.mapsReused).toBe(0);
    expect(sdkCounters.mapsConstructed).toBe(1);
  });
});
