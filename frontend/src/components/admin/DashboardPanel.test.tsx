// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DashboardPanel from "./DashboardPanel";
import type { ActiveBusEntry } from "@/lib/activeBusEntries";
import type { RouteData } from "@/hooks/useRoutes";
import { fixtureBus, route } from "../../../../e2e/fixtures/state";
const state = vi.hoisted(() => ({ entries: [] as ActiveBusEntry[], geometries: new Map(), routes: [] as RouteData[] }));
vi.mock("@vis.gl/react-google-maps", () => ({ Map: ({children}: {children: ReactNode}) => <div>{children}</div>, AdvancedMarker: ({ children, position, anchorLeft, anchorTop }: { children: ReactNode; position: unknown; anchorLeft?: string; anchorTop?: string }) => <div data-marker={JSON.stringify(position)} data-anchor={JSON.stringify([anchorLeft, anchorTop])}>{children}</div>, useMap: () => null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ role: "admin", user: {uid: "qa-admin"} }) }));
vi.mock("@/hooks/useActiveBuses", () => ({ useActiveBuses: () => state.entries }));
vi.mock("@/hooks/useDynamicRouteGeometries", () => ({ useDynamicRouteGeometries: () => state.geometries }));
vi.mock("@/hooks/useRTDBResume", () => ({ useRTDBResume: () => ({ isResuming: false }) }));
vi.mock("@/hooks/useBuses", () => ({ useBuses: () => ({ buses: [{id: "qa-bus", name: "QA bus", assignedRoutes: ["qa-route"]}] }) }));
vi.mock("@/hooks/useDrivers", () => ({ useDrivers: () => ({ drivers: [{id: "qa-driver", name: "QA driver", assignedBusId: "qa-bus"}] }) }));
vi.mock("@/hooks/useRoutes", () => ({ useRoutes: () => ({ routes: state.routes }) }));
vi.mock("@/components/maps/DirectionsRoute", () => ({ default: ({ nextStopIndices }: ComponentProps<typeof import("../maps/DirectionsRoute").default>) => <div data-testid="road" data-next={JSON.stringify(nextStopIndices)} /> }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: {currentUser: {getIdToken: async () => "synthetic-token"}} }));
vi.mock("@/components/ui/CustomSelect", () => ({default: ({ariaLabel, value, options, onChange, disabled}: {ariaLabel: string; value: string; options: {value: string; label: string}[]; onChange: (value: string) => void; disabled?: boolean}) => <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}));
beforeEach(() => { state.entries = []; state.routes = [{ ...route, stops: [] }]; state.geometries.clear(); vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.test"); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function prepare() {
  const user = userEvent.setup(); render(<DashboardPanel />);
  expect((screen.getByRole("button", {name: "Start service"}) as HTMLButtonElement).disabled).toBe(true);
  await user.selectOptions(screen.getByRole("combobox", {name: "Operator"}), "qa-driver");
  return user;
}
describe("admin service creation", () => {
  it("marks retained telemetry delayed using the passenger threshold and recovers on a fresh receipt", async () => {
    const { SIGNAL_LOST_MS } = await import("@/lib/liveBusFreshness");
    const now = Date.now();
    state.entries = [{ ...fixtureBus("forward"), timestamp: now - SIGNAL_LOST_MS - 1000, backendReceivedAt: now - SIGNAL_LOST_MS - 1000 } as ActiveBusEntry];
    const user = userEvent.setup(); const view = render(<DashboardPanel />);
    expect(screen.getByText("Live location updates delayed")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open live details for qa-bus" }));
    expect(within(screen.getByRole("dialog")).getByText("Live location updates delayed")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).queryByText("Connected")).toBeNull();
    state.entries = [{ ...state.entries[0], timestamp: Date.now(), backendReceivedAt: Date.now() }];
    view.rerender(<DashboardPanel />);
    expect(screen.queryByText("Live location updates delayed")).toBeNull();
    expect(within(screen.getByRole("dialog")).getByText("Connected")).toBeTruthy();
  });
  it("does not infer receiver failure from uncertain motion", () => {
    state.entries = [{ ...fixtureBus("forward"), motionState: "uncertain" } as ActiveBusEntry];
    render(<DashboardPanel />);
    expect(screen.getByText("Motion uncertain")).toBeTruthy();
    expect(screen.queryByText("No GPS")).toBeNull();
  });
  it.each(["forward", "reverse"] as const)("shows only published passed stops and the ordered next stop in %s travel", async direction => {
    state.routes = [{ ...route, stops: [...route.stops, { id: "c", name: "Gamma", shortName: "C", lat: 23.02, lng: 72.02 }] }];
    state.entries = [{ ...fixtureBus(direction), currentStopIndex: 2 } as ActiveBusEntry];
    const user = userEvent.setup(); render(<DashboardPanel />);
    await user.click(screen.getByText("QA bus").closest("button")!);
    expect(screen.getByText("2/3 passed")).toBeTruthy();
    expect(screen.queryByText("3/3 stops")).toBeNull();
    expect(screen.getByText("Next Stop").nextElementSibling?.textContent).toBe(direction === "forward" ? "Gamma" : "Alpha");
    expect(screen.getByTestId("road").getAttribute("data-next")).toBe("[2]");
  });
  it.each([undefined, -1, 0.5, 3])("does not invent admin progress for published index %s", async currentStopIndex => {
    state.routes = [{ ...route, stops: [...route.stops, { id: "c", name: "Gamma", shortName: "C", lat: 23.02, lng: 72.02 }] }];
    state.entries = [{ ...fixtureBus("forward"), currentStopIndex } as ActiveBusEntry];
    const user = userEvent.setup(); render(<DashboardPanel />);
    await user.click(screen.getByText("QA bus").closest("button")!);
    expect(screen.queryByText("Next Stop")).toBeNull();
    expect(screen.queryByText("Following Stop")).toBeNull();
    expect(screen.queryByText("Route Progress")).toBeNull();
    expect(screen.getByTestId("road").getAttribute("data-next")).toBe("[]");
    await user.click(screen.getByRole("button", { name: "Open live details for qa-bus" }));
    const drawer = within(screen.getByRole("dialog", { name: "Live details for qa-bus" }));
    expect(drawer.getByText("Next stop").parentElement?.textContent).toBe("Next stop—");
  });
  it("centers the bus glyph on its coordinate while its label stays outside the anchor box", () => {
    state.entries = [{ busId: "qa-bus", routeId: "qa-route", lat: 23, lng: 72, timestamp: Date.now(), deviceState: "online", motionState: "stopped", speed: 0 }];
    render(<DashboardPanel />);
    const glyph = screen.getByTitle(/^qa-bus —/);
    expect(glyph.closest("[data-marker]")?.getAttribute("data-anchor")).toBe('["-50%","-50%"]');
    expect(glyph.style.width).toBe("36px"); expect(glyph.style.height).toBe("36px");
    expect((glyph.lastElementChild as HTMLElement).style.position).toBe("absolute");
    expect(glyph.closest("[data-marker]")?.getAttribute("data-marker")).toBe('{"lat":23,"lng":72}');
  });
  it("keeps the online counter current when telemetry arrives between clock ticks", () => {
    vi.useFakeTimers(); const start = Date.now();
    state.entries = [{ busId: "qa-bus", routeId: "qa-route", deviceState: "online", timestamp: start }];
    const view = render(<DashboardPanel />);
    expect(screen.getByText("1 device online · 0 services")).toBeTruthy();
    vi.setSystemTime(start + 12_000);
    state.entries = [{ ...state.entries[0], timestamp: Date.now() }];
    view.rerender(<DashboardPanel />);
    expect(screen.getByText("1 device online · 0 services")).toBeTruthy();
  });
  it.each([200, 503])("reuses the operation key after an uncertain HTTP %i reply and accepts only a confirmed session", async status => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', {status})).mockResolvedValueOnce(new Response('{"sessionId":"qa-session","direction":null}'));
    vi.stubGlobal("fetch", fetchMock); const user = await prepare();
    await user.click(screen.getByRole("button", {name: "Start service"}));
    expect(await screen.findByText(status === 200 ? /did not confirm/ : /HTTP 503/)).toBeTruthy();
    await user.click(screen.getByRole("button", {name: "Start service"}));
    expect(await screen.findByText(/Service started \(qa-session\)/)).toBeTruthy();
    const first = new Headers(fetchMock.mock.calls[0][1].headers).get("Idempotency-Key");
    expect(first).toBeTruthy();
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get("Idempotency-Key")).toBe(first);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.test/api/v2/ride-sessions");
  });
  it("keeps the start button locked while the server response is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const user = await prepare(); await user.click(screen.getByRole("button", {name: "Start service"}));
    await waitFor(() => expect((screen.getByRole("button", {name: "Start service"}) as HTMLButtonElement).disabled).toBe(true));
  });
});
