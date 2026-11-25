// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import DashboardPanel from "./DashboardPanel";
import type { UseActiveBusesOptions } from "@/hooks/useActiveBuses";
import { route } from "../../../../e2e/fixtures/state";
const state = vi.hoisted(() => ({
  options: null as UseActiveBusesOptions | null,
  connected: true,
  resuming: true,
}));
vi.mock("@vis.gl/react-google-maps", () => ({ Map: ({ children }: { children: ReactNode }) => <div>{children}</div>, AdvancedMarker: () => null, useMap: () => null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ role: "admin", user: { uid: "qa-admin" } }) }));
vi.mock("@/hooks/useActiveBuses", () => ({ useActiveBuses: (options: UseActiveBusesOptions) => { state.options = options; return []; } }));
vi.mock("@/hooks/useBusLocations", () => ({ useBusLocations: () => ({ busLocations: [], error: null, retry: () => {} }) }));
vi.mock("@/hooks/useRTDBResume", () => ({ useRTDBResume: () => ({ isConnected: state.connected, isResuming: state.resuming, connectionGeneration: 1, resumeGeneration: 0, markSnapshotReceived: () => {} }) }));
vi.mock("@/hooks/useBuses", () => ({ useBuses: () => ({ buses: [] }) }));
vi.mock("@/hooks/useDrivers", () => ({ useDrivers: () => ({ drivers: [], loading: false }) }));
vi.mock("@/hooks/useRoutes", () => ({ useRoutes: () => ({ routes: [{ ...route, stops: [] }] }) }));
vi.mock("@/components/shared/MessagingPanel", () => ({ default: () => null }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: { currentUser: null } }));
beforeEach(() => { state.options = null; state.connected = true; state.resuming = true; });
afterEach(() => { cleanup(); });

function rtdbError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("admin live data read failures", () => {
  it("reports a permission denial as an access problem, not a reconnect", () => {
    render(<DashboardPanel />);
    act(() => state.options?.onReadError?.(rtdbError("PERMISSION_DENIED", "permission_denied at /publicRouteBuses: Client doesn't have permission to access the desired data.")));
    expect(screen.getByRole("alert").textContent).toContain("not permitted to read live data");
    expect(screen.queryByText(/Check your connection/)).toBeNull();
    expect(screen.queryByText("Offline / reconnecting to live data...")).toBeNull();
    expect(screen.getAllByText("Live data access denied").length).toBeGreaterThan(0);
    expect(screen.queryByText("Live data unavailable")).toBeNull();
  });

  it("keeps the connection advice for a read failure that is not a denial", () => {
    render(<DashboardPanel />);
    act(() => state.options?.onReadError?.(new Error("network error")));
    expect(screen.getByRole("alert").textContent).toContain("Check your connection and reload to retry.");
    expect(screen.getByText("Offline / reconnecting to live data...")).toBeTruthy();
  });

  it("keeps the empty fleet list neutral for a non-permission failure once data has arrived", () => {
    state.resuming = false;
    render(<DashboardPanel />);
    act(() => state.options?.onReadError?.(new Error("network error")));
    const empty = screen.getByText("No buses active").parentElement!;
    expect(empty.className).toContain("text-ui-quiet");
    expect(empty.className).not.toContain("text-ui-warning");
  });

  it("still shows reconnecting while the socket is down, even after a denial", () => {
    state.connected = false;
    render(<DashboardPanel />);
    act(() => state.options?.onReadError?.(rtdbError("PERMISSION_DENIED", "permission_denied at /x")));
    expect(screen.getByText("Offline / reconnecting to live data...")).toBeTruthy();
  });

  it("clears the denial once a live delivery recovers the read", () => {
    state.resuming = false;
    render(<DashboardPanel />);
    act(() => state.options?.onReadError?.(rtdbError("PERMISSION_DENIED", "permission_denied at /x")));
    expect(screen.getAllByText("Live data access denied").length).toBeGreaterThan(0);
    act(() => state.options?.onReadRecovered?.());
    expect(screen.queryByText("Live data access denied")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
