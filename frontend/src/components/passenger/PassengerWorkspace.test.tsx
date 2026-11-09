// @vitest-environment jsdom
import { lazy, Suspense, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, fireEvent, render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PassengerWorkspace from "./PassengerWorkspace";
import { BUS_EXPIRY_MS } from "@/lib/liveBusFreshness";
import { setScenario } from "../../../../e2e/fixtures/state";
import * as fixtures from "../../../../e2e/fixtures/state";
import type { PassengerMapProps } from "@/components/maps/PassengerMap";
import { stopEstimateContext, type PassengerStopEstimates } from "@/lib/passengerStopEstimates";
configure({ asyncUtilTimeout: 5_000 });
vi.mock("@/hooks/useAuth", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useLiveRouteCatalog", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useRoutes", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useSettings", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useRTDBResume", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/lib/liveBusStore", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/lib/joinedRideStatus", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/lib/authState", async () => import("../../../../e2e/fixtures/state"));
vi.mock("next/dynamic", () => ({ default: (loader: () => Promise<{ default: ComponentType<Record<string, unknown>> }>) => {
  const Loaded = lazy(loader);
  return function TestDynamic(props: Record<string, unknown>) { return <Suspense><Loaded {...props} /></Suspense>; };
} }));
vi.mock("@/components/maps/PassengerTrackingMap", () => ({ default: ({ targetStop, selectedDestinationStopId, route, selectedBusKey, onStopEstimatesChange }: PassengerMapProps) => <div data-testid="tracking-map" data-target={targetStop.id} data-selected={selectedDestinationStopId ?? ""}>QA map<button onClick={() => route && onStopEstimatesChange?.({ context: stopEstimateContext(route, selectedBusKey), minutes: { b: 3 } })}>Publish estimates</button></div> }));
vi.mock("@/components/passenger/PassengerBoardingView", () => ({ default: ({ sessionId, stopEstimates }: { sessionId: string; stopEstimates?: PassengerStopEstimates }) => <><div>Boarding {sessionId}</div><span data-testid="boarding-eta">{stopEstimates?.minutes.b ?? "unknown"}</span></> }));
vi.mock("@/components/passenger/AccountTab", () => ({ default: () => <button>QA account control</button> }));
vi.mock("@/components/passenger/RoutesTab", () => ({ default: () => <h2>QA route schedules</h2> }));
vi.mock("@/components/shared/MessagingPanel", () => ({ default: () => <div>QA chat</div> }));
vi.mock("@/components/shared/FeedbackModal", () => ({ default: () => <div>QA feedback</div> }));
beforeEach(() => {
  window.history.replaceState(null, "", window.location.pathname);
  setScenario("pending");
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("passenger workspace navigation", () => {
  it("retains an open stale ride as paused while removing it from new route choices, then recovers", async () => {
    render(<PassengerWorkspace />); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    await screen.findByRole("combobox", { name: "Destination station" });
    act(() => setScenario("stale"));
    await screen.findByText("Live tracking lost");
    expect(screen.queryByRole("combobox", { name: "Destination station" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open live chat" })).toBeNull();
    expect(screen.queryByText("QA feedback")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back to home" }));
    expect(screen.queryByRole("button", { name: "Track QA route" })).toBeNull();
    act(() => setScenario("pending"));
    expect(await screen.findByRole("button", { name: "Track QA route" })).toBeTruthy();
  });
  it("says GPS is lost the moment a GNSS-loss packet arrives, keeping the ride card and chat (field ride, 29 Oct 2026)", async () => {
    render(<PassengerWorkspace />); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    await screen.findByRole("combobox", { name: "Destination station" });
    act(() => setScenario("gnss-lost"));
    expect(await screen.findByText("GPS signal lost")).toBeTruthy();
    expect(screen.queryByText("Live tracking paused")).toBeNull();
    // The boarding card stays mounted (Board is disabled inside it); chat needs no GPS fix.
    expect(screen.getByText("Boarding qa-session")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open live chat" })).toBeTruthy();
    act(() => setScenario("forward"));
    expect(await screen.findByText("Boarding qa-session")).toBeTruthy();
    expect(screen.queryByText("GPS signal lost")).toBeNull();
  });
  it("offers only the fresh bus when a selected bus on the same route becomes stale", async () => {
    render(<PassengerWorkspace />); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    act(() => setScenario("multiple-stale"));
    await screen.findByText("Live tracking lost");
    await user.click(screen.getByRole("combobox", { name: "Live bus" }));
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.click(screen.getByRole("option", { name: "Bus qa-bus-2 · B → A" }));
    expect(await screen.findByText("Boarding qa-session-2")).toBeTruthy();
  });
  it("does not offer cached routes while the passenger connection is offline", async () => {
    setScenario("reconnecting"); render(<PassengerWorkspace />);
    expect(screen.queryByRole("button", { name: "Track QA route" })).toBeNull();
    expect(screen.getByText("Reconnecting to live bus data…")).toBeTruthy();
    expect(screen.getByText("Unable to reach live data. Check your connection.")).toBeTruthy();
  });
  it("labels an initial connection separately from reconnecting", () => {
    const resume=vi.spyOn(fixtures,"useRTDBResume").mockReturnValue({isConnected:false,isResuming:true,resumeGeneration:0,connectionGeneration:0,markSnapshotReceived:()=>{}});
    try { render(<PassengerWorkspace />);expect(screen.getByText("Connecting to live bus data…")).toBeTruthy(); }
    finally {resume.mockRestore();}
  });
  it("does not blame the connection while connected but waiting on the live projection", () => {
    setScenario("projection-unready");
    const resume = vi.spyOn(fixtures, "useRTDBResume").mockReturnValue({ isConnected: true, isResuming: true,
      resumeGeneration: 0, connectionGeneration: 1, markSnapshotReceived: () => {} });
    try {
      render(<PassengerWorkspace />);
      expect(screen.getByText("Live bus data is unavailable.")).toBeTruthy();
      expect(screen.getByText("Live bus data is not available right now.")).toBeTruthy();
      expect(screen.queryByText("Reconnecting to live bus data…")).toBeNull();
      expect(screen.queryByText("Unable to reach live data. Check your connection.")).toBeNull();
    } finally { resume.mockRestore(); }
  });
  it("pauses tracking without blaming the connection while connected and waiting for a snapshot", async () => {
    setScenario("forward");
    const resume = vi.spyOn(fixtures, "useRTDBResume").mockReturnValue({ isConnected: true, isResuming: true,
      resumeGeneration: 0, connectionGeneration: 1, markSnapshotReceived: () => {} });
    try {
      render(<PassengerWorkspace />); const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: "Track QA route" }));
      expect((await screen.findAllByText("Live tracking paused")).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Live bus data is not available right now\./).length).toBeGreaterThan(0);
      expect(screen.queryByText(/This device is reconnecting/)).toBeNull();
      expect(screen.queryByText("Reconnecting to live bus data…")).toBeNull();
    } finally { resume.mockRestore(); }
  });
  it("acknowledges a ready empty catalog without waiting for a nonexistent bus subscription", async () => {
    setScenario("empty");
    const received = vi.fn();
    const resume = vi.spyOn(fixtures, "useRTDBResume").mockReturnValue({ isConnected: true, isResuming: true,
      resumeGeneration: 0, connectionGeneration: 1, markSnapshotReceived: received });
    try {
      render(<PassengerWorkspace />);
      // Connected and waiting with no error: the hint must not depend on liveDataError alone.
      expect(screen.getByText("Live bus data is not available right now.")).toBeTruthy();
      await waitFor(() => expect(received).toHaveBeenCalled());
    } finally { resume.mockRestore(); }
  });
  it("shows a stored service start time containing replacement patterns literally in the empty state", () => {
    setScenario("empty");
    const settings = vi.spyOn(fixtures, "useSettings").mockReturnValue({ loading: false, saveSettings: async () => {},
      settings: { noBusesMessage: "No buses running", noBusesSubMessage: "Service starts at {time}",
        serviceStartTime: "$& sharp ($$ fare)", announcementActive: false, announcementText: "" } });
    try {
      render(<PassengerWorkspace />);
      expect(screen.getByText("Service starts at $& sharp ($$ fare)")).toBeTruthy();
    } finally { settings.mockRestore(); }
  });
  it("shares map estimates with boarding and immediately invalidates them when the selected bus changes", async () => {
    setScenario("multiple"); render(<PassengerWorkspace />); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    await screen.findByText("Boarding qa-session");
    await user.click(await screen.findByRole("button", { name: "Publish estimates" }));
    expect(screen.getByTestId("boarding-eta").textContent).toBe("3");
    await user.click(screen.getByRole("combobox", { name: "Live bus" }));
    await user.click(screen.getByRole("option", { name: "Bus qa-bus-2 · B → A" }));
    await screen.findByText("Boarding qa-session-2");
    expect(screen.getByTestId("boarding-eta").textContent).toBe("unknown");
  });
  it("keeps Routes on the list when tapped repeatedly", async () => {
    render(<PassengerWorkspace />); const user = userEvent.setup();
    await screen.findByRole("button", { name: "Track QA route" });
    await user.click(screen.getByRole("button", { name: "Live" }));
    expect(screen.getByRole("button", { name: "Track QA route" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back to home" })).toBeNull();
  });
  it("dismisses chat before leaving tracking with Back", async () => {
    setScenario("forward"); render(<PassengerWorkspace />); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    await user.click(await screen.findByRole("button", { name: "Open live chat" }));
    await screen.findByText("QA chat");
    await user.click(screen.getByRole("button", { name: "Close live chat" }));
    expect(screen.queryByText("QA chat")).toBeNull();
    expect(screen.getByRole("button", { name: "Back to home" })).toBeTruthy();
  });
  it("returns keyboard focus to the same route after its card remounts during tracking", async () => {
    // jsdom drops :focus-visible during the click that Enter dispatches; browsers keep it.
    const matches = Element.prototype.matches;
    const focusVisible = vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
      return selector === ":focus-visible" ? this === document.activeElement : matches.call(this, selector);
    });
    try {
      const { container } = render(<PassengerWorkspace />); const user = userEvent.setup();
      const card = await screen.findByRole("button", { name: "Track QA route" });
      await user.tab();
      expect(document.activeElement).toBe(card);
      await user.keyboard("{Enter}");
      const back = await screen.findByRole("button", { name: "Back to home" });
      expect(document.activeElement).toBe(back);
      // A connection gap empties the hidden list, so the route comes back as a new card.
      act(() => setScenario("reconnecting"));
      expect(card.isConnected).toBe(false);
      act(() => setScenario("pending"));
      await waitFor(() => expect(container.querySelector("[data-passenger-route='qa-route']")).not.toBeNull());
      expect(document.activeElement).toBe(back);
      await user.keyboard("{Enter}");
      const returned = await screen.findByRole("button", { name: "Track QA route" });
      expect(returned).not.toBe(card);
      expect(document.activeElement).toBe(returned);
    } finally { focusVisible.mockRestore(); }
  });
  it("unmounts the chat dialog when leaving tracking so hidden dialog focus handlers cannot remain active", async () => {
    setScenario("forward"); render(<PassengerWorkspace />); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    await user.click(await screen.findByRole("button", { name: "Open live chat" }));
    expect(await screen.findByText("QA chat")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Profile" }));
    expect(screen.queryByText("QA chat")).toBeNull();
  });
  it("only exposes controls in the active panel and opens pending service", async () => {
    const { container } = render(<PassengerWorkspace />); const user = userEvent.setup();
    await screen.findByRole("button", { name: "Track QA route" });
    expect(screen.queryByRole("button", { name: "Back to home" })).toBeNull();
    expect(screen.queryByRole("button", { name: "QA account control" })).toBeNull();
    const back = Array.from(container.querySelectorAll("button")).find(button => button.getAttribute("aria-label") === "Back to home");
    expect(back?.closest("[inert][aria-hidden='true']")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Track QA route" }));
    expect(await screen.findByRole("button", { name: "Back to home" })).toBeTruthy();
    expect(screen.getAllByText("Direction pending").some(element => !element.closest('[aria-hidden="true"]'))).toBe(true);
    expect(screen.queryByRole("button", { name: "Track QA route" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back to home" }));
    expect(await screen.findByRole("button", { name: "Track QA route" })).toBeTruthy();
  });
  it("switches buses without retaining the first bus's boarding session", async () => {
    setScenario("multiple"); render(<PassengerWorkspace />); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    expect(await screen.findByText("Boarding qa-session")).toBeTruthy();
    await user.click(screen.getByRole("combobox", { name: "Live bus" }));
    await user.click(screen.getByRole("option", { name: "Bus qa-bus-2 · B → A" }));
    expect(await screen.findByText("Boarding qa-session-2")).toBeTruthy();
    expect(screen.queryByText("Boarding qa-session")).toBeNull();
  });
  it("exposes profile only after navigation and returns to routes", async () => {
    render(<PassengerWorkspace />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Profile" }));
    expect(await screen.findByRole("button", { name: "QA account control" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Live" }));
    expect(await screen.findByRole("button", { name: "Track QA route" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "QA account control" })).toBeNull();
  });
  it("does not ask an unjoined passenger for post-ride feedback", async () => {
    render(<PassengerWorkspace />); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    vi.useFakeTimers();
    act(() => setScenario("completed"));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(screen.queryByText("QA feedback")).toBeNull();
  });
});

describe("device preview lifecycle", () => {
  it("keeps the preview camera fallback separate from destination selection and clearing", async () => {
    render(<PassengerWorkspace />); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    const map = await screen.findByTestId("tracking-map");
    expect(map.getAttribute("data-target")).toBe("b");
    expect(map.getAttribute("data-selected")).toBe("");
    await user.click(screen.getByRole("combobox", { name: "Destination station" }));
    await user.click(screen.getByRole("option", { name: "Beta" }));
    expect(map.getAttribute("data-selected")).toBe("b");
    await user.click(screen.getByRole("combobox", { name: "Destination station" }));
    await user.click(screen.getByRole("option", { name: "Choose destination stop" }));
    expect(map.getAttribute("data-selected")).toBe("");
    expect(map.getAttribute("data-target")).toBe("b");
  });
  it("opens the unarmed stationary bus map and never exposes boarding or live chat", async () => {
    setScenario("device"); render(<PassengerWorkspace />); const user=userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    expect(await screen.findByText("QA map")).toBeTruthy();
    expect(screen.getByText("Bus online · service not started")).toBeTruthy();
    expect(screen.queryByText(/Boarding qa-session/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Open live chat" })).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Destination station" }));
    expect(screen.getByRole("listbox", { name: "Destination station" })).toBeTruthy();
    await user.click(screen.getByRole("option", { name: "Beta" }));
    expect(screen.getByRole("combobox", { name: "Destination station" }).textContent).toContain("Beta");
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back to home" }));
    expect(await screen.findByRole("button", { name: "Track QA route" })).toBeTruthy();
  });
  it("shows the map while direction is pending and transitions to armed boarding when direction resolves", async () => {
    render(<PassengerWorkspace />); const user=userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    expect(await screen.findByText("QA map")).toBeTruthy();
    expect(screen.queryByText("Boarding qa-session")).toBeNull();
    act(() => setScenario("forward"));
    expect(await screen.findByText("Boarding qa-session")).toBeTruthy();
  });
  it("expires silent sessionless hardware without requiring another RTDB event", async () => {
    vi.useFakeTimers();
    setScenario("device");
    await act(async () => { render(<PassengerWorkspace />); });
    expect(screen.getByRole("button", { name: "Track QA route" })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(BUS_EXPIRY_MS + 2_001); });
    expect(screen.queryByRole("button", { name: "Track QA route" })).toBeNull();
    expect(screen.getByText("No buses running")).toBeTruthy();
  });
});

describe("selected bus identity during service start", () => {
  it("keeps the selected device when it acquires a new session alongside another bus", async () => {
    setScenario("mixed"); render(<PassengerWorkspace />); const user=userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    await user.click(screen.getByRole("combobox", { name: "Live bus" }));
    await user.click(screen.getByRole("option", { name: "Bus qa-bus-2 · Service not started" }));
    expect(screen.getByText("Bus online · service not started")).toBeTruthy();
    act(() => setScenario("multiple"));
    expect(await screen.findByText("Boarding qa-session-2")).toBeTruthy();
    expect(screen.queryByText("Boarding qa-session")).toBeNull();
  });
});
describe("passenger tab switching and footer", () => {
  it("mounts Profile on first visit and keeps it (inert) afterwards so leaving never blanks the view", async () => {
    render(<PassengerWorkspace />); const user = userEvent.setup();
    expect(screen.queryByText("QA account control")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Profile" }));
    const account = await screen.findByText("QA account control");
    await user.click(screen.getByRole("button", { name: "Live" }));
    expect(account.isConnected).toBe(true);
    expect(account.closest("[inert]")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Profile" }));
    expect(screen.getByText("QA account control")).toBe(account);
    expect(account.closest("[inert]")).toBeNull();
  });
  it("marks the selected section immediately and survives rapid switching", async () => {
    render(<PassengerWorkspace />); const user = userEvent.setup();
    const routes = screen.getByRole("button", { name: "Live" }); const profile = screen.getByRole("button", { name: "Profile" });
    expect(routes.getAttribute("aria-current")).toBe("page");
    for (let i = 0; i < 9; i++) await user.click(i % 2 ? routes : profile);
    expect(profile.getAttribute("aria-current")).toBe("page");
    expect(routes.getAttribute("aria-current")).toBeNull();
    await user.click(routes);
    expect(routes.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("QA account control").closest("[inert]")).not.toBeNull();
  });
  it("opens the Routes schedule tab from the navigation and returns to the map", async () => {
    render(<PassengerWorkspace />); const user = userEvent.setup();
    const map = screen.getByRole("button", { name: "Live" });
    const routes = screen.getByRole("button", { name: "Routes" });
    const profile = screen.getByRole("button", { name: "Profile" });
    // Order in the bar: Live, Routes, Profile.
    expect(screen.getAllByRole("button").filter(button => [map, routes, profile].includes(button))).toEqual([map, routes, profile]);
    expect(screen.queryByText("QA route schedules")).toBeNull();
    await user.click(routes);
    const schedules = await screen.findByRole("heading", { name: "QA route schedules" });
    expect(routes.getAttribute("aria-current")).toBe("page");
    expect(map.getAttribute("aria-current")).toBeNull();
    expect(screen.queryByRole("button", { name: "Track QA route" })).toBeNull();
    await user.click(map);
    expect(await screen.findByRole("button", { name: "Track QA route" })).toBeTruthy();
    expect(map.getAttribute("aria-current")).toBe("page");
    // Mounted once, then kept inert like Profile.
    expect(schedules.isConnected).toBe(true);
    expect(schedules.closest("[inert]")).not.toBeNull();
    await user.click(routes);
    expect(screen.getByRole("heading", { name: "QA route schedules" })).toBe(schedules);
  });
  it("closes live chat when switching to the Routes tab", async () => {
    setScenario("forward"); render(<PassengerWorkspace />); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    await user.click(await screen.findByRole("button", { name: "Open live chat" }));
    await screen.findByText("QA chat");
    await user.click(screen.getByRole("button", { name: "Routes" }));
    await screen.findByRole("heading", { name: "QA route schedules" });
    expect(screen.queryByText("QA chat")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Live" }));
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    expect(await screen.findByRole("button", { name: "Open live chat" })).toBeTruthy();
    expect(screen.queryByText("QA chat")).toBeNull();
  });
  it("does not use the half-second view fade", () => {
    const { container } = render(<PassengerWorkspace />);
    expect(container.querySelector('[class*="duration-500"]')).toBeNull();
  });
  it("paints the navigation surface through the safe-area padding", () => {
    render(<PassengerWorkspace />);
    const nav = screen.getByRole("navigation", { name: "Passenger sections" });
    const frame = nav.closest(".pb-safe") as HTMLElement;
    expect(frame).not.toBeNull();
    expect(frame.classList.contains("passenger-nav-frame")).toBe(true);
  });
});
describe("phone Live routes sheet", () => {
  // jsdom has no matchMedia; the stub decides whether this is a touch screen
  // and can switch it live, as rotating or docking a device would.
  const TOUCH_QUERY = "not all and (any-pointer: fine)";
  let touch = false;
  const mediaListeners = new Set<() => void>();
  const useTouchScreen = (value: boolean) => {
    touch = value;
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() { return touch && query === TOUCH_QUERY; },
      media: query,
      addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
    }));
  };
  const switchTouchScreen = (value: boolean) => act(() => { touch = value; mediaListeners.forEach(listener => listener()); });

  // jsdom does no layout, so give the panel and its heading the sizes a phone
  // would: the peek is the heading's bottom edge inside the panel.
  const geometry = { panel: 600, peek: 120 };
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
  const originalOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop")!;
  beforeEach(() => {
    geometry.panel = 600; geometry.peek = 120;
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get(this: HTMLElement) {
      return this.classList.contains("passenger-home-panel") ? geometry.panel : this.classList.contains("passenger-home-heading") ? geometry.peek : 0;
    } });
    Object.defineProperty(HTMLElement.prototype, "offsetTop", { configurable: true, get: () => 0 });
  });
  afterEach(async () => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    Object.defineProperty(HTMLElement.prototype, "offsetTop", originalOffsetTop);
    mediaListeners.clear();
    vi.unstubAllGlobals();
    await saveSettings({ announcementActive: false, announcementText: "" });
  });
  async function saveSettings(partial: { announcementActive?: boolean; announcementText?: string }) {
    let save: ((value: typeof partial) => Promise<void>) | undefined;
    function Probe() { save = fixtures.useSettings().saveSettings; return null; }
    const probe = render(<Probe />);
    await act(() => save!(partial));
    probe.unmount();
  }

  it("rests low on touch screens, keeping the hidden list out of reach until the peek is tapped", async () => {
    useTouchScreen(true);
    render(<PassengerWorkspace />); const user = userEvent.setup();
    const card = await screen.findByRole("button", { name: "Track QA route" });
    const toggle = screen.getByRole("button", { name: "Show live routes" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(card.closest("[inert]")).not.toBeNull();
    expect(document.getElementById(toggle.getAttribute("aria-controls") ?? "")?.contains(card)).toBe(true);

    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Hide live routes");
    expect(card.closest("[inert]")).toBeNull();
    expect(card.closest("[data-home-sheet]")?.getAttribute("data-home-sheet")).toBe("open");

    await user.click(toggle);
    expect(toggle.getAttribute("aria-label")).toBe("Show live routes");
    expect(card.closest("[inert]")).not.toBeNull();
  });

  it("raises with an upward swipe on the peek and lowers with a downward one", async () => {
    useTouchScreen(true);
    render(<PassengerWorkspace />);
    const card = await screen.findByRole("button", { name: "Track QA route" });
    const toggle = screen.getByRole("button", { name: "Show live routes" });
    const drag = (fromY: number, toY: number) => {
      fireEvent.pointerDown(toggle, { pointerId: 1, pointerType: "touch", clientX: 100, clientY: fromY });
      fireEvent.pointerUp(toggle, { pointerId: 1, pointerType: "touch", clientX: 100, clientY: toY });
      fireEvent.click(toggle);
    };
    drag(600, 450);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(card.closest("[inert]")).toBeNull();
    drag(450, 600);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(card.closest("[inert]")).not.toBeNull();
  });

  it("returns from tracking to the raised list even when the route was chosen from the lowered sheet", async () => {
    useTouchScreen(true);
    render(<PassengerWorkspace />); const user = userEvent.setup();
    expect(await screen.findByRole("button", { name: "Show live routes" })).toBeTruthy();
    // jsdom ignores inert, which lets this reach the choose-a-route path directly.
    await user.click(screen.getByRole("button", { name: "Track QA route" }));
    await user.click(await screen.findByRole("button", { name: "Back to home" }));
    const card = await screen.findByRole("button", { name: "Track QA route" });
    expect(card.closest("[inert]")).toBeNull();
    expect(screen.getByRole("button", { name: "Hide live routes" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("ignores a route tap while the sheet is still rising", async () => {
    useTouchScreen(true);
    render(<PassengerWorkspace />); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Show live routes" }));
    await user.click(screen.getByRole("button", { name: "Track QA route" }));
    expect(screen.queryByRole("button", { name: "Back to home" })).toBeNull();
    await act(() => new Promise(resolve => setTimeout(resolve, 500)));
    await user.click(screen.getByRole("button", { name: "Track QA route" }));
    expect(await screen.findByRole("button", { name: "Back to home" })).toBeTruthy();
  });

  it("opens by itself to show an announcement, and the passenger's own choice wins", async () => {
    useTouchScreen(true);
    await saveSettings({ announcementActive: true, announcementText: "Route 2 is diverted today" });
    render(<PassengerWorkspace />); const user = userEvent.setup();
    const note = await screen.findByText("Route 2 is diverted today");
    const toggle = screen.getByRole("button", { name: "Hide live routes" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(note.closest("[inert]")).toBeNull();
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(note.closest("[inert]")).not.toBeNull();
  });

  it("opens by itself when no route can be chosen, so the reason shows", async () => {
    useTouchScreen(true);
    setScenario("offline");
    render(<PassengerWorkspace />);
    const reason = await screen.findByText("No buses running");
    expect(reason.closest("[inert]")).toBeNull();
    expect(screen.getByRole("button", { name: "Hide live routes" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("drops the sheet when the heading leaves too little to hide, as with very large text", async () => {
    useTouchScreen(true);
    geometry.peek = 560;
    render(<PassengerWorkspace />);
    const card = await screen.findByRole("button", { name: "Track QA route" });
    expect(screen.queryByRole("button", { name: /live routes$/ })).toBeNull();
    expect(card.closest("[inert]")).toBeNull();
  });

  it("follows a live switch between touch and pointer input", async () => {
    useTouchScreen(false);
    render(<PassengerWorkspace />);
    const card = await screen.findByRole("button", { name: "Track QA route" });
    expect(screen.queryByRole("button", { name: "Show live routes" })).toBeNull();
    await switchTouchScreen(true);
    expect(screen.getByRole("button", { name: "Show live routes" })).toBeTruthy();
    expect(card.closest("[inert]")).not.toBeNull();
    await switchTouchScreen(false);
    expect(screen.queryByRole("button", { name: "Show live routes" })).toBeNull();
    expect(card.closest("[inert]")).toBeNull();
  });

  it("never hides the list or shows a toggle on pointer devices", async () => {
    useTouchScreen(false);
    render(<PassengerWorkspace />);
    const card = await screen.findByRole("button", { name: "Track QA route" });
    expect(card.closest("[inert]")).toBeNull();
    expect(screen.queryByRole("button", { name: /live routes$/ })).toBeNull();
  });
});
