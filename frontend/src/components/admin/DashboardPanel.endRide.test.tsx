// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DashboardPanel from "./DashboardPanel";
import type { ActiveBusEntry } from "@/lib/activeBusEntries";
import type { RouteData } from "@/hooks/useRoutes";
import type { BusLocationData } from "@/hooks/useBusLocations";
import { fixtureBus, route } from "../../../../e2e/fixtures/state";
// Mocks copied from DashboardPanel.test.tsx.
const state = vi.hoisted(() => ({ entries: [] as ActiveBusEntry[], geometries: new Map(), routes: [] as RouteData[], resuming: false, driversLoading: false, busLocations: [] as BusLocationData[], busLocationsError: null as string | null, retryBusLocations: vi.fn() }));
vi.mock("@vis.gl/react-google-maps", () => ({ Map: ({children}: {children: ReactNode}) => <div>{children}</div>, AdvancedMarker: ({ children }: { children: ReactNode }) => <div>{children}</div>, useMap: () => null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ role: "admin", user: {uid: "qa-admin"} }) }));
vi.mock("@/hooks/useActiveBuses", () => ({ useActiveBuses: () => state.entries }));
vi.mock("@/hooks/useBusLocations", () => ({ useBusLocations: () => ({ busLocations: state.busLocations, error: state.busLocationsError, retry: state.retryBusLocations }) }));
vi.mock("@/hooks/useDynamicRouteGeometries", () => ({ useDynamicRouteGeometries: () => state.geometries }));
vi.mock("@/hooks/useRTDBResume", () => ({ useRTDBResume: () => ({ isResuming: state.resuming }) }));
vi.mock("@/hooks/useBuses", () => ({ useBuses: () => ({ buses: [{id: "qa-bus", name: "QA bus", assignedRoutes: ["qa-route"]}] }) }));
vi.mock("@/hooks/useDrivers", () => ({ useDrivers: () => ({ drivers: [{id: "qa-driver", name: "QA driver", assignedBusId: "qa-bus"}], loading: false }) }));
vi.mock("@/hooks/useRoutes", () => ({ useRoutes: () => ({ routes: state.routes }) }));
vi.mock("@/components/maps/DirectionsRoute", () => ({ default: () => <div /> }));
vi.mock("@/components/shared/MessagingPanel", () => ({ default: ({ sessionId }: { sessionId: string }) => <p>Chat session {sessionId}</p> }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: {currentUser: {getIdToken: async () => "synthetic-token"}} }));
vi.mock("@/components/ui/CustomSelect", () => ({ default: () => <select /> }));
beforeEach(() => { state.entries = []; state.busLocations = []; state.routes = [{ ...route, stops: [] }]; state.geometries.clear(); vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.test"); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const confirmDialog = () => screen.getByRole("dialog", { name: "End ride early?" });

describe("End ride early", () => {
  it("two synchronous clicks on End ride send one request", async () => {
    state.entries = [{ ...fixtureBus("forward") } as ActiveBusEntry];
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup(); render(<DashboardPanel />);
    await user.click(screen.getByRole("button", { expanded: false }));
    await user.click(screen.getByRole("button", { name: "End ride early" }));
    const confirm = within(confirmDialog()).getByRole("button", { name: "End ride" });
    // Both clicks in one task, before React re-renders the disabled button (Chrome retest).
    act(() => { confirm.click(); confirm.click(); });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => { resolve(new Response('{"stopped":true,"interrupted":true}')); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not claim a ride that completed meanwhile was 'ended early'", async () => {
    state.entries = [{ ...fixtureBus("forward") } as ActiveBusEntry];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"stopped":true,"alreadyCompleted":true}')));
    const user = userEvent.setup(); render(<DashboardPanel />);
    await user.click(screen.getByRole("button", { expanded: false }));
    await user.click(screen.getByRole("button", { name: "End ride early" }));
    await user.click(within(confirmDialog()).getByRole("button", { name: "End ride" }));
    const status = await screen.findByText(/qa-session/);
    expect(status.textContent).not.toMatch(/ended early/);
  });

  it("drawer End ride is keyboard reachable and Cancel returns focus to the live-details opener", async () => {
    state.entries = [{ ...fixtureBus("forward") } as ActiveBusEntry];
    const user = userEvent.setup(); render(<DashboardPanel />);
    const opener = screen.getByRole("button", { name: "Open live details for qa-bus" });
    await user.click(opener);
    const drawer = screen.getByRole("dialog", { name: "Live details for qa-bus" });
    const endRide = within(drawer).getByRole("button", { name: "End ride early" });
    for (let i = 0; i < 6 && document.activeElement !== endRide; i++) await user.tab();
    expect(document.activeElement).toBe(endRide);
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: "Live details for qa-bus" })).toBeNull();
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("Keep running"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "End ride early?" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open live details for qa-bus" }));
  });

  it("drawer hides End ride once the ride completes while the drawer is open", async () => {
    state.entries = [{ ...fixtureBus("forward") } as ActiveBusEntry];
    const user = userEvent.setup(); const view = render(<DashboardPanel />);
    await user.click(screen.getByRole("button", { name: "Open live details for qa-bus" }));
    state.entries = [{ ...fixtureBus("forward"), tripState: "completed" } as ActiveBusEntry];
    view.rerender(<DashboardPanel />);
    const drawer = screen.getByRole("dialog", { name: "Live details for qa-bus" });
    expect(within(drawer).queryByRole("button", { name: "End ride early" })).toBeNull();
  });

  it("closes the open confirm when its ride is no longer endable", async () => {
    state.entries = [{ ...fixtureBus("forward") } as ActiveBusEntry];
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"stopped":true,"alreadyCompleted":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup(); const view = render(<DashboardPanel />);
    await user.click(screen.getByRole("button", { expanded: false }));
    await user.click(screen.getByRole("button", { name: "End ride early" }));
    state.entries = [{ ...fixtureBus("forward"), tripState: "completed" } as ActiveBusEntry];
    view.rerender(<DashboardPanel />);
    expect(screen.queryByRole("dialog", { name: "End ride early?" })).toBeNull();
  });
});
