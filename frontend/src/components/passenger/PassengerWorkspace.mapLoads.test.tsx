// @vitest-environment jsdom
// One file = one page session: Vitest isolates modules per file, so vis.gl's
// map cache and Maps loader start empty here. The first test is the first open.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  expectReusedInto, installScriptInterceptingFakeSdk, lastMap, sdkCounters, snapshotCounters,
  type CounterSnapshot, type FakeMap,
} from "@/test-support/fakeGoogleMapsSdk";
import PassengerWorkspace from "@/components/passenger/PassengerWorkspace";
import { setScenario } from "../../../../e2e/fixtures/state";

configure({ asyncUtilTimeout: 5_000 });

vi.mock("@vis.gl/react-google-maps", async importOriginal => ({
  ...(await importOriginal<typeof import("@vis.gl/react-google-maps")>()),
  // The real marker needs the `marker` library; markers are not map loads.
  AdvancedMarker: ({ children }: { children: ReactNode }) => <div data-fake-marker>{children}</div>,
}));
vi.mock("@/components/maps/DirectionsRoute", () => ({ default: () => null }));
vi.mock("@/hooks/useAuth", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useLiveRouteCatalog", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useRoutes", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useSettings", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useRTDBResume", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useDynamicRouteGeometries", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/lib/liveBusStore", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/lib/joinedRideStatus", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/lib/authState", async () => import("../../../../e2e/fixtures/state"));
vi.mock("next/dynamic", () => ({ default: (loader: () => Promise<{ default: ComponentType<Record<string, unknown>> }>) => {
  const Loaded = lazy(loader);
  return function TestDynamic(props: Record<string, unknown>) { return <Suspense><Loaded {...props} /></Suspense>; };
} }));
vi.mock("@/components/passenger/PassengerBoardingView", () => ({ default: ({ sessionId }: { sessionId: string }) => <div>Boarding {sessionId}</div> }));
vi.mock("@/components/passenger/AccountTab", () => ({ default: () => <div>QA account</div> }));
vi.mock("@/components/shared/MessagingPanel", () => ({ default: () => <div>QA chat</div> }));
vi.mock("@/components/shared/FeedbackModal", () => ({ default: () => <div>QA feedback</div> }));

let stopIntercepting: () => void;
beforeAll(() => { stopIntercepting = installScriptInterceptingFakeSdk(); });
afterEach(() => { cleanup(); setScenario("pending"); });
afterAll(() => stopIntercepting());

const mapContainer = () => document.querySelector("[data-passenger-map]");

async function openRoute(name: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name }));
  await waitFor(() => expect(lastMap()?.getDiv().isConnected).toBe(true));
  await waitFor(() => expect(mapContainer()?.contains(lastMap()!.getDiv())).toBe(true));
  await screen.findByRole("button", { name: "Back to home" });
  return lastMap()!;
}

/** Wait for vis.gl to reattach the cached instance, then assert nothing was constructed. */
async function expectRemountReused(map: FakeMap, before: CounterSnapshot) {
  await waitFor(() => expect(sdkCounters.mapsReused - before.mapsReused).toBe(1));
  await waitFor(() => expect(mapContainer()?.contains(map.getDiv())).toBe(true));
  expectReusedInto(map, before, mapContainer());
}

/** The map cached earlier in this page session; opens and closes one first when the test runs alone. */
async function cachedMap() {
  if (!lastMap()) {
    render(<PassengerWorkspace />);
    await openRoute("Track QA route");
    cleanup();
  }
  return lastMap()!;
}

async function reopenReused(map: FakeMap, name = "Track QA route") {
  const before = snapshotCounters();
  await openRoute(name);
  await expectRemountReused(map, before);
}

/** The tracking map unmounted: its div is detached and nothing was constructed. */
async function expectUnmountedWithoutLoad(map: FakeMap, before: CounterSnapshot) {
  await waitFor(() => expect(map.getDiv().isConnected).toBe(false));
  expect(sdkCounters.mapsConstructed - before.mapsConstructed).toBe(0);
}

/** A live-data transition that remounts the keyed map content reattaches the same instance. */
async function transition(map: FakeMap, scenario: string) {
  const before = snapshotCounters();
  act(() => setScenario(scenario));
  await expectRemountReused(map, before);
}

describe("passenger workspace map loads (real PassengerTrackingMap + real vis.gl Map, fake SDK)", () => {
  it("reopening, Profile/Routes tab switching and route switching add no map loads within a page session", async () => {
    setScenario("forward");
    render(<PassengerWorkspace />);
    const user = userEvent.setup();

    let before = snapshotCounters();
    const map = await openRoute("Track QA route");
    expect(sdkCounters.mapsConstructed - before.mapsConstructed).toBe(1);
    expect(sdkCounters.scriptLoads).toBe(1);

    before = snapshotCounters();
    await user.click(screen.getByRole("button", { name: "Back to home" }));
    await expectUnmountedWithoutLoad(map, before);
    await reopenReused(map);

    before = snapshotCounters();
    await user.click(screen.getByRole("button", { name: "Profile" }));
    await expectUnmountedWithoutLoad(map, before);
    // The first section button returns to the live route list.
    const liveRoutes = within(screen.getByRole("navigation", { name: "Passenger sections" })).getAllByRole("button")[0];
    await user.click(liveRoutes);
    await waitFor(() => expect(liveRoutes.getAttribute("aria-current")).toBe("page"));
    expect(sdkCounters.mapsConstructed - before.mapsConstructed).toBe(0);
    expect(map.getDiv().isConnected).toBe(false);
    await reopenReused(map);

    act(() => setScenario("two-routes"));
    before = snapshotCounters();
    await user.click(screen.getByRole("button", { name: "Back to home" }));
    await expectUnmountedWithoutLoad(map, before);
    await reopenReused(map, "Track QA route B");
    await waitFor(() => expect(document.querySelector("[data-passenger-tracking]")?.textContent).toContain("QA route B"));

    expect(sdkCounters.mapsConstructed).toBe(1);
    expect(sdkCounters.scriptLoads).toBe(1);
  }, 30_000);

  it("direction resolution, bus disappearance/reappearance and service start add no map loads", async () => {
    setScenario("pending");
    const map = await cachedMap();
    render(<PassengerWorkspace />);
    await reopenReused(map);

    await transition(map, "forward");
    await transition(map, "reverse");

    await transition(map, "forward");
    await transition(map, "empty");
    await transition(map, "forward");

    cleanup();
    setScenario("device");
    render(<PassengerWorkspace />);
    await reopenReused(map);
    await transition(map, "pending");

    expect(sdkCounters.mapsConstructed).toBe(1);
    expect(sdkCounters.scriptLoads).toBe(1);
  }, 30_000);

  it("choosing another live bus on the same route adds no map load", async () => {
    setScenario("multiple");
    const map = await cachedMap();
    render(<PassengerWorkspace />);
    await reopenReused(map);
    const user = userEvent.setup();

    const before = snapshotCounters();
    await user.click(screen.getByRole("combobox", { name: "Live bus" }));
    await user.click(screen.getByRole("option", { name: "Bus qa-bus-2 · B → A" }));
    await expectRemountReused(map, before);

    expect(sdkCounters.mapsConstructed).toBe(1);
  }, 30_000);
});
