// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DashboardPanel from "./DashboardPanel";
import type { ActiveBusEntry } from "@/lib/activeBusEntries";
import type { RouteData } from "@/hooks/useRoutes";
import type { BusLocationData } from "@/hooks/useBusLocations";
import { fixtureBus, route } from "../../../../e2e/fixtures/state";
const state = vi.hoisted(() => ({ entries: [] as ActiveBusEntry[], geometries: new Map(), routes: [] as RouteData[], resuming: false, driversLoading: false, busLocations: [] as BusLocationData[], busLocationsError: null as string | null, retryBusLocations: vi.fn() }));
vi.mock("@vis.gl/react-google-maps", () => ({ Map: ({children}: {children: ReactNode}) => <div>{children}</div>, AdvancedMarker: ({ children, position, anchorLeft, anchorTop }: { children: ReactNode; position: unknown; anchorLeft?: string; anchorTop?: string }) => <div data-marker={JSON.stringify(position)} data-anchor={JSON.stringify([anchorLeft, anchorTop])}>{children}</div>, useMap: () => null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ role: "admin", user: {uid: "qa-admin"} }) }));
vi.mock("@/hooks/useActiveBuses", () => ({ useActiveBuses: () => state.entries }));
vi.mock("@/hooks/useBusLocations", () => ({ useBusLocations: () => ({ busLocations: state.busLocations, error: state.busLocationsError, retry: state.retryBusLocations }) }));
vi.mock("@/hooks/useDynamicRouteGeometries", () => ({ useDynamicRouteGeometries: () => state.geometries }));
vi.mock("@/hooks/useRTDBResume", () => ({ useRTDBResume: () => ({ isResuming: state.resuming }) }));
vi.mock("@/hooks/useBuses", () => ({ useBuses: () => ({ buses: [{id: "qa-bus", name: "QA bus", assignedRoutes: ["qa-route"]}] }) }));
vi.mock("@/hooks/useDrivers", () => ({ useDrivers: () => ({ drivers: state.driversLoading ? [] : [{id: "qa-driver", name: "QA driver", assignedBusId: "qa-bus"}], loading: state.driversLoading }) }));
vi.mock("@/hooks/useRoutes", () => ({ useRoutes: () => ({ routes: state.routes }) }));
vi.mock("@/components/maps/DirectionsRoute", () => ({ default: ({ nextStopIndices }: ComponentProps<typeof import("../maps/DirectionsRoute").default>) => <div data-testid="road" data-next={JSON.stringify(nextStopIndices)} /> }));
vi.mock("@/components/shared/MessagingPanel", () => ({ default: ({ sessionId }: { sessionId: string }) => <p>Chat session {sessionId}</p> }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: {currentUser: {getIdToken: async () => "synthetic-token"}} }));
vi.mock("@/components/ui/CustomSelect", () => ({default: ({ariaLabel, value, options, onChange, disabled}: {ariaLabel: string; value: string; options: {value: string; label: string}[]; onChange: (value: string) => void; disabled?: boolean}) => <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}));
beforeEach(() => { state.entries = []; state.busLocations = []; state.busLocationsError = null; state.retryBusLocations.mockReset(); state.resuming = false; state.driversLoading = false; state.routes = [{ ...route, stops: [] }]; state.geometries.clear(); vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.test"); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("admin service creation", () => {
  it("offers recovery for a terminal automatic intent without reviving the old ride",()=>{
    state.entries=[{...fixtureBus(),sessionId:undefined,status:"offline",automaticServiceState:"paused"} as ActiveBusEntry];
    render(<DashboardPanel />);
    expect(screen.getByRole("button",{name:"Resume automatic tracking for qa-bus"})).toBeTruthy();
  });
  it("offers one resume per paused route of the same bus", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    state.entries=[{...fixtureBus(),sessionId:undefined,status:"offline",automaticServiceState:"paused"} as ActiveBusEntry,
      {...fixtureBus(),routeId:"qa-route-2",sessionId:undefined,status:"offline",automaticServiceState:"paused"} as ActiveBusEntry];
    render(<DashboardPanel />);
    expect(screen.getAllByRole("button",{name:"Resume automatic tracking for qa-bus"})).toHaveLength(2);
    expect(errors.mock.calls.some(call => String(call[0]).includes("same key"))).toBe(false);
    errors.mockRestore();
  });
  it("waits for the operator list instead of reporting a missing operator", async () => {
    state.driversLoading = true;
    state.entries=[{...fixtureBus(),status:"offline",sessionId:undefined,automaticServicePaused:true} as ActiveBusEntry];
    const send = vi.fn(); vi.stubGlobal("fetch", send);
    render(<DashboardPanel />);
    await userEvent.setup().click(screen.getByRole("button",{name:"Resume automatic tracking for qa-bus"}));
    expect(screen.getByText(/Operators are still loading/)).toBeTruthy();
    expect(screen.queryByText(/Assign exactly one operator/)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
  it("explains a blocked automatic setup using the authoritative assignment state",()=>{
    state.entries=[{...fixtureBus(),sessionId:undefined,status:"offline",automaticServiceState:"assignment_required"} as ActiveBusEntry];
    render(<DashboardPanel />);
    expect(screen.getByText("Assignment required")).toBeTruthy();
  });
  it.each([200,503])("retries an uncertain resume response %s with the same operation key",async status=>{
    state.entries=[{...fixtureBus(),status:"offline",sessionId:undefined,automaticServicePaused:true} as ActiveBusEntry];
    const send=vi.fn().mockResolvedValueOnce(new Response('{}',{status})).mockResolvedValueOnce(new Response('{"sessionId":"resumed-session"}'));
    vi.stubGlobal("fetch",send);render(<DashboardPanel />);const user=userEvent.setup();
    await user.click(screen.getByRole("button",{name:"Resume automatic tracking for qa-bus"}));
    await screen.findByText(status===200?/did not confirm/:/HTTP 503/);
    await user.click(screen.getByRole("button",{name:"Resume automatic tracking for qa-bus"}));
    await screen.findByText(/Automatic tracking resumed/);
    const first=new Headers(send.mock.calls[0][1].headers).get("Idempotency-Key");
    expect(first).toBeTruthy();expect(new Headers(send.mock.calls[1][1].headers).get("Idempotency-Key")).toBe(first);
  });
  it("retains an offline session as paused without counting it as a live service", () => {
    state.entries=[{...fixtureBus("forward"),deviceState:"offline"} as ActiveBusEntry];
    render(<DashboardPanel />);
    expect(screen.getByText("Service paused")).toBeTruthy();
    expect(screen.getByText("0 devices online · 0 services")).toBeTruthy();
  });
  it("keeps a bus at its last known location after its live record is removed", () => {
    state.busLocations = [{ id: "qa-bus", routeId: "qa-route", lastKnownLocation: { lat: 23.5, lng: 72.5, sampledAt: Date.now() - 3 * 3_600_000 } }];
    const { container } = render(<DashboardPanel />);
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.getByText("Last seen 3h ago")).toBeTruthy();
    expect(container.querySelector('[data-marker*="23.5"]')).toBeTruthy();
    expect(screen.getByText("0 devices online · 0 services")).toBeTruthy();
  });
  it("reports unavailable last known locations instead of an empty fleet and retries them", async () => {
    state.busLocationsError = "Missing or insufficient permissions.";
    render(<DashboardPanel />);
    expect(screen.getByRole("alert").textContent).toContain("Last known locations of offline buses are unavailable.");
    await userEvent.setup().click(within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }));
    expect(state.retryBusLocations).toHaveBeenCalledOnce();
  });
  it("places a live ride with no fix yet at the bus's last known location", async () => {
    state.entries = [{ ...fixtureBus("forward"), lat: undefined, lng: undefined } as ActiveBusEntry];
    state.busLocations = [{ id: "qa-bus", routeId: "qa-route", lastKnownLocation: { lat: 23.5, lng: 72.5, sampledAt: Date.now() - 2 * 3_600_000 } }];
    const { container } = render(<DashboardPanel />);
    expect(container.querySelector('[data-marker*="23.5"]')).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Open live details for qa-bus" })).toHaveLength(1);
    await userEvent.setup().click(screen.getByText("QA bus").closest("button")!);
    expect(screen.getByText(/last known 2h ago/)).toBeTruthy();
  });
  it("prefers the live record over the durable last fix", () => {
    state.entries = [{ ...fixtureBus("forward") } as ActiveBusEntry];
    state.busLocations = [{ id: "qa-bus", routeId: "qa-route", lastKnownLocation: { lat: 23.5, lng: 72.5, sampledAt: 1 } }];
    render(<DashboardPanel />);
    expect(screen.getAllByRole("button", { name: "Open live details for qa-bus" })).toHaveLength(1);
    expect(screen.queryByText("Offline")).toBeNull();
  });
  it("labels an ended ride on an offline bus as completed, not paused", () => {
    state.entries = [{ ...fixtureBus("forward"), tripState: "completed", status: "offline", deviceState: "offline" } as ActiveBusEntry];
    render(<DashboardPanel />);
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.queryByText("Service paused")).toBeNull();
  });
  it("does not offer resume while the paused receiver is offline", () => {
    state.entries = [{ ...fixtureBus(), status: "offline", sessionId: undefined, automaticServicePaused: true, deviceState: "offline" } as ActiveBusEntry];
    render(<DashboardPanel />);
    expect(screen.getByText("Tracking paused")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resume automatic tracking for qa-bus" })).toBeNull();
  });
  it("offers an explicit resume only for an intentionally paused receiver", async () => {
    state.entries=[{...fixtureBus(),status:"offline",sessionId:undefined,automaticServicePaused:true} as ActiveBusEntry];
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response('{"sessionId":"resumed-session","direction":null}')));
    render(<DashboardPanel />);
    await userEvent.setup().click(screen.getByRole("button",{name:"Resume automatic tracking for qa-bus"}));
    expect(await screen.findByText(/Automatic tracking resumed/)).toBeTruthy();
  });
  it("explains automatic service admission without a manual start control", () => {
    render(<DashboardPanel />);
    expect(screen.queryByRole("button", {name:"Start service"})).toBeNull();
    expect(screen.getByText(/Services start automatically/)).toBeTruthy();
  });
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
  it("keeps one bus's delay change locked while another bus's delay change completes", async () => {
    state.entries = [{ ...fixtureBus("forward") } as ActiveBusEntry, { ...fixtureBus("forward", "qa-session-2", "qa-bus-2"), routeId: route.id } as ActiveBusEntry];
    const pending: Array<(response: Response) => void> = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { pending.push(resolve); })));
    const user = userEvent.setup(); render(<DashboardPanel />);
    for (const card of screen.getAllByRole("button", { expanded: false })) await user.click(card);
    await user.click(screen.getByRole("button", { name: "Increase delay by 1 minutes for qa-bus" }));
    await user.click(screen.getByRole("button", { name: "Increase delay by 1 minutes for qa-bus-2" }));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1](new Response('{"saved":true,"delayMinutes":1}'));
    await screen.findByText("Delay updated to 1 minutes for qa-bus-2.");
    expect((screen.getByRole("button", { name: "Increase delay by 1 minutes for qa-bus" }) as HTMLButtonElement).disabled).toBe(true);
    pending[0](new Response('{"saved":true,"delayMinutes":1}'));
    await screen.findByText("Delay updated to 1 minutes for qa-bus.");
    expect((screen.getByRole("button", { name: "Increase delay by 1 minutes for qa-bus" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("shows why ending a ride early failed instead of leaving the reason behind the dialog", async () => {
    state.entries = [{ ...fixtureBus("forward") } as ActiveBusEntry];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"Ride session changed."}', { status: 409 })));
    const user = userEvent.setup(); render(<DashboardPanel />);
    await user.click(screen.getByRole("button", { expanded: false }));
    await user.click(screen.getByRole("button", { name: "End ride early" }));
    await user.click(within(screen.getByRole("dialog", { name: "End ride early?" })).getByRole("button", { name: "End ride" }));
    expect(await screen.findByText("Ride session changed.")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "End ride early?" })).toBeNull();
  });
  it("shows why clearing ride messages failed instead of leaving the reason behind the dialog", async () => {
    state.entries = [{ ...fixtureBus("forward") } as ActiveBusEntry];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"Messages are locked."}', { status: 409 })));
    const user = userEvent.setup(); render(<DashboardPanel />);
    await user.click(screen.getByRole("button", { expanded: false }));
    await user.click(screen.getByRole("button", { name: "Open live details for qa-bus" }));
    await user.click(screen.getByRole("button", { name: "Clear Messages" }));
    await user.click(within(screen.getByRole("dialog", { name: "Clear Messages?" })).getByRole("button", { name: "Clear Messages" }));
    expect(await screen.findByText("Error: Messages are locked.")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Clear Messages?" })).toBeNull();
  });
  it("keeps an open admin chat tied to the live receiver rather than the bus state at the moment it was opened", () => {
    vi.useFakeTimers(); const start = Date.now();
    state.entries = [{ ...fixtureBus("forward") } as ActiveBusEntry];
    const view = render(<DashboardPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open live chat for qa-bus" }));
    expect(screen.getByText("Chat session qa-session")).toBeTruthy();
    vi.setSystemTime(start + 6 * 60_000);
    state.entries = [{ ...state.entries[0], timestamp: Date.now(), backendReceivedAt: Date.now() }];
    view.rerender(<DashboardPanel />);
    expect(screen.getByText("Chat session qa-session")).toBeTruthy();
    state.entries = [{ ...state.entries[0], deviceState: "offline" }];
    view.rerender(<DashboardPanel />);
    expect(screen.queryByText("Chat session qa-session")).toBeNull();
  });
  it("keeps an open admin chat through a live data gap and closes it only once the ride is known gone", () => {
    state.entries = [{ ...fixtureBus("forward") } as ActiveBusEntry];
    const view = render(<DashboardPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open live chat for qa-bus" }));
    state.resuming = true; state.entries = [];
    view.rerender(<DashboardPanel />);
    expect(screen.getByText("Chat session qa-session")).toBeTruthy();
    state.resuming = false; state.entries = [{ ...fixtureBus("forward"), timestamp: Date.now(), backendReceivedAt: Date.now() } as ActiveBusEntry];
    view.rerender(<DashboardPanel />);
    expect(screen.getByText("Chat session qa-session")).toBeTruthy();
    state.entries = [];
    view.rerender(<DashboardPanel />);
    expect(screen.queryByText(/Chat session/)).toBeNull();
  });
  it("does not reopen a closed admin chat when its receiver reconnects or a new ride replaces it", () => {
    state.entries = [{ ...fixtureBus("forward") } as ActiveBusEntry];
    const view = render(<DashboardPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open live chat for qa-bus" }));
    state.entries = [{ ...state.entries[0], deviceState: "offline" }];
    view.rerender(<DashboardPanel />);
    state.entries = [{ ...state.entries[0], deviceState: "online", timestamp: Date.now(), backendReceivedAt: Date.now() }];
    view.rerender(<DashboardPanel />);
    expect(screen.queryByText(/Chat session/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open live chat for qa-bus" }));
    expect(screen.getByText("Chat session qa-session")).toBeTruthy();
    state.entries = [{ ...state.entries[0], sessionId: "qa-next-session" }];
    view.rerender(<DashboardPanel />);
    expect(screen.queryByText(/Chat session/)).toBeNull();
  });
});
