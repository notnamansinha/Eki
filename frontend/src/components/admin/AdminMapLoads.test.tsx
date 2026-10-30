// @vitest-environment jsdom
// One file = one page session: Vitest isolates modules per file, so vis.gl's
// map cache and Maps loader start empty here. The first test is the first open.
// Real admin layout MapProviders + AdminPage tab switching + DashboardPanel /
// RouteManagementPanel + DirectionsRoute + vis.gl Map, fake SDK boundary.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, configure, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  allOverlays, expectReusedInto, installScriptInterceptingFakeSdk, lastMap, reuseCall, sdkCounters, snapshotCounters,
  type CounterSnapshot, type FakeMap,
} from "@/test-support/fakeGoogleMapsSdk";
import MapProviders from "@/components/MapProviders";
import AdminPage from "@/app/admin/page";
import { route } from "../../../../e2e/fixtures/state";

configure({ asyncUtilTimeout: 5_000 });

// Two stops with stored road geometry; the editor passes no routeId, so
// DirectionsRoute never requests geometry from the backend.
const adminRoute = { ...route, polyline: "_ekkC_omvLg^_Xg^od@", polylineQuality: "HIGH_QUALITY" as const, configVersion: 1 };

vi.mock("@vis.gl/react-google-maps", async importOriginal => ({
  ...(await importOriginal<typeof import("@vis.gl/react-google-maps")>()),
  // The real marker needs the `marker` library; markers are not map loads.
  AdvancedMarker: ({ children }: { children: ReactNode }) => <div data-fake-marker>{children}</div>,
}));
vi.mock("next/dynamic", () => ({ default: (loader: () => Promise<{ default: ComponentType<Record<string, unknown>> }>) => {
  const Loaded = lazy(loader);
  return function TestDynamic(props: Record<string, unknown>) { return <Suspense fallback="Loading panel"><Loaded {...props} /></Suspense>; };
} }));
vi.mock("@/components/admin/FleetManagementPanel", () => ({ default: () => <p>Fleet content</p> }));
vi.mock("@/components/admin/RideHistoryPanel", () => ({ default: () => <p>History content</p> }));
vi.mock("@/components/admin/FeedbackPanel", () => ({ default: () => <p>Feedback content</p> }));
vi.mock("@/components/admin/SettingsPanel", () => ({ default: () => <p>Settings content</p> }));
vi.mock("@/components/shared/MessagingPanel", () => ({ default: () => <p>Chat</p> }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ role: "admin", user: { uid: "qa-admin" } }) }));
vi.mock("@/hooks/useActiveBuses", () => ({ useActiveBuses: () => [] }));
vi.mock("@/hooks/useBusLocations", () => ({ useBusLocations: () => ({ busLocations: [], error: null, retry: () => {} }) }));
vi.mock("@/hooks/useDynamicRouteGeometries", () => ({ useDynamicRouteGeometries: () => new Map() }));
vi.mock("@/hooks/useRTDBResume", () => ({ useRTDBResume: () => ({ isResuming: false }) }));
vi.mock("@/hooks/useBuses", () => ({ useBuses: () => ({ buses: [] }) }));
vi.mock("@/hooks/useDrivers", () => ({ useDrivers: () => ({ drivers: [], loading: false }) }));
vi.mock("@/hooks/useRoutes", () => ({ useRoutes: () => ({ routes: [adminRoute], loading: false, error: null, retry: () => {} }) }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: { currentUser: { getIdToken: async () => "synthetic" } } }));
vi.mock("@/lib/routeSaveClient", () => ({ saveRoute: vi.fn(), newRouteSaveId: () => "qa" }));
vi.mock("@/lib/apiClient", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/apiClient")>()),
  // No admin map transition may reach the backend.
  apiRequest: vi.fn(async () => { throw new Error("unexpected backend request in map-load test"); }),
}));

let stopIntercepting: () => void;
beforeAll(() => { stopIntercepting = installScriptInterceptingFakeSdk(); });
afterAll(() => { cleanup(); stopIntercepting(); });

const tabpanel = () => document.querySelector("[role='tabpanel']");

async function waitForMountedMap() {
  await waitFor(() => expect(lastMap()?.getDiv().isConnected).toBe(true));
  await waitFor(() => expect(tabpanel()?.contains(lastMap()!.getDiv())).toBe(true));
  return lastMap()!;
}

/** Wait for vis.gl to reattach the cached instance, then assert nothing was constructed. */
async function expectRemountReused(map: FakeMap, before: CounterSnapshot, zoom: number) {
  await waitFor(() => expect(sdkCounters.mapsReused - before.mapsReused).toBe(1));
  await waitFor(() => expect(tabpanel()?.contains(map.getDiv())).toBe(true));
  expectReusedInto(map, before, tabpanel());
  const reused = reuseCall(map);
  expect(reused?.options.zoom).toBe(zoom);
  const center = reused?.options.center as { lat: number; lng: number };
  expect(Number.isFinite(center.lat) && Number.isFinite(center.lng)).toBe(true);
}

/** The panel's map unmounted: its div is detached and nothing was constructed. */
async function expectUnmountedWithoutLoad(map: FakeMap, before: CounterSnapshot) {
  await waitFor(() => expect(map.getDiv().isConnected).toBe(false));
  expect(sdkCounters.mapsConstructed - before.mapsConstructed).toBe(0);
}

describe("admin map loads (real AdminPage + real vis.gl Map, fake SDK)", () => {
  it("Live Ops, route editor and Fleet switching construct one map per page session", async () => {
    const user = userEvent.setup();
    let before = snapshotCounters();
    render(<MapProviders><AdminPage /></MapProviders>);
    const map = await waitForMountedMap();
    expect(sdkCounters.mapsConstructed - before.mapsConstructed).toBe(1);
    expect(sdkCounters.scriptLoads).toBe(1);

    before = snapshotCounters();
    await user.click(screen.getByRole("tab", { name: /Routes/ }));
    await screen.findByRole("button", { name: "Add Route" });
    await expectUnmountedWithoutLoad(map, before);

    before = snapshotCounters();
    await user.click(screen.getByRole("button", { name: `Edit route ${adminRoute.name}` }));
    await expectRemountReused(map, before, 13);

    before = snapshotCounters();
    await user.click(screen.getByRole("button", { name: "Cancel route editing" }));
    await screen.findByRole("button", { name: "Add Route" });
    await expectUnmountedWithoutLoad(map, before);

    before = snapshotCounters();
    await user.click(screen.getByRole("button", { name: `Edit route ${adminRoute.name}` }));
    await expectRemountReused(map, before, 13);
    await user.click(screen.getByRole("button", { name: "Cancel route editing" }));
    await screen.findByRole("button", { name: "Add Route" });

    before = snapshotCounters();
    await user.click(screen.getByRole("tab", { name: /Live Ops/ }));
    await expectRemountReused(map, before, 12);

    before = snapshotCounters();
    await user.click(screen.getByRole("tab", { name: /Fleet/ }));
    await screen.findByText("Fleet content");
    await expectUnmountedWithoutLoad(map, before);

    before = snapshotCounters();
    await user.click(screen.getByRole("tab", { name: /Live Ops/ }));
    await expectRemountReused(map, before, 12);

    expect(sdkCounters.mapsConstructed).toBe(1);
    expect(sdkCounters.scriptLoads).toBe(1);
  }, 30_000);

  it("unmounting admin maps detaches traffic and route overlays from the cached instance", async () => {
    cleanup();
    const user = userEvent.setup();
    render(<MapProviders><AdminPage /></MapProviders>);
    const map = await waitForMountedMap();

    await user.click(screen.getByRole("tab", { name: /Routes/ }));
    let before = snapshotCounters();
    await user.click(await screen.findByRole("button", { name: `Edit route ${adminRoute.name}` }));
    await expectRemountReused(map, before, 13);
    await waitFor(() => expect(allOverlays().filter(overlay => overlay.kind === "Polyline").length).toBeGreaterThanOrEqual(2));

    before = snapshotCounters();
    cleanup();
    await expectUnmountedWithoutLoad(map, before);

    expect(allOverlays().filter(overlay => overlay.kind === "TrafficLayer").length).toBeGreaterThanOrEqual(1);
    expect(allOverlays().filter(overlay => overlay.kind === "Polyline").length).toBeGreaterThanOrEqual(2);
    for (const overlay of allOverlays()) expect(overlay.setMapHistory.at(-1)).toBeNull();
    expect(lastMap()).toBe(map);
    expect(map.listeners.size).toBe(0);
    expect(sdkCounters.mapsConstructed).toBe(1);
  }, 30_000);
});
