// @vitest-environment jsdom
// The demo ride is a scripted bus simulated in the browser. It is listed with
// the live routes, boards without location or the backend, and ends without
// asking for feedback about a bus and driver that do not exist.
import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, configure, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PassengerWorkspace from "./PassengerWorkspace";
import { setScenario } from "../../../../e2e/fixtures/state";
import type { PassengerMapProps } from "@/components/maps/PassengerMap";
import { stopEstimateContext } from "@/lib/passengerStopEstimates";
import { DEMO_RIDE_DURATION_MS, resetDemoRideForTests } from "@/lib/demoRide";
configure({ asyncUtilTimeout: 5_000 });
const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: "qa-passenger", getIdToken: async () => "test-token" } }, mapProps: [] as PassengerMapProps[] }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: mocks.auth }));
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
// The real map computes progress from the bus; here it reports the demo bus
// standing at its fourth stop, Doordarshan Kendra.
vi.mock("@/components/maps/PassengerTrackingMap", () => ({ default: function QaMap(props: PassengerMapProps) {
  mocks.mapProps.push(props);
  const { route, selectedBusKey, onStopEstimatesChange } = props;
  useEffect(() => {
    if (route) onStopEstimatesChange?.({ context: stopEstimateContext(route, selectedBusKey, 1), minutes: { "gurukul-road": 3, "ahmedabad-university": 9 }, nextStopIndex: 4, atStopIndex: 3 });
  }, [route, selectedBusKey, onStopEstimatesChange]);
  return <div data-testid="tracking-map">QA map</div>;
} }));
vi.mock("@/components/passenger/AccountTab", () => ({ default: () => <button>QA account control</button> }));
vi.mock("@/components/shared/MessagingPanel", () => ({ default: () => <div>QA chat</div> }));
vi.mock("@/components/shared/FeedbackModal", () => ({ default: () => <div>QA feedback</div> }));

beforeEach(() => {
  setScenario("empty");
  localStorage.clear();
  mocks.mapProps.length = 0;
  vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://qa.example.test");
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
    getCurrentPosition: vi.fn(), watchPosition: () => 1, clearWatch: () => {},
  } });
});
afterEach(() => { cleanup(); resetDemoRideForTests(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear(); });

describe("demo ride in Live routes", () => {
  it("is listed under Practice when no bus is running, without counting as a live route", async () => {
    render(<PassengerWorkspace />);
    expect(await screen.findByRole("button", { name: "Try the demo ride" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Practice" })).toBeTruthy();
    expect(screen.getByText("No buses running")).toBeTruthy();
    expect(screen.getByText("0 routes")).toBeTruthy();
    expect(screen.getByText("Not a real bus")).toBeTruthy();
    // Its road geometry is OpenStreetMap data, credited where the ride is offered.
    expect(screen.getByRole("link", { name: "OpenStreetMap contributors" }).getAttribute("href")).toBe("https://www.openstreetmap.org/copyright");
  });

  it("is listed after the live routes when buses are running", async () => {
    setScenario("forward");
    render(<PassengerWorkspace />);
    await screen.findByRole("button", { name: "Try the demo ride" });
    const cards = [...document.querySelectorAll("[data-passenger-route]")].map(card => card.getAttribute("data-passenger-route"));
    expect(cards).toEqual(["qa-route", "demo-ride"]);
    expect(screen.getByText("1 route")).toBeTruthy();
  });

  it("is hidden when NEXT_PUBLIC_DEMO_RIDE is false", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_RIDE", "false");
    render(<PassengerWorkspace />);
    await screen.findByText("No buses running");
    expect(screen.queryByRole("button", { name: "Try the demo ride" })).toBeNull();
  });
});

describe("riding the demo", () => {
  it("opens with the From → To bar, no chat and no location prompt for walking time", async () => {
    render(<PassengerWorkspace />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Try the demo ride" }));
    expect(await screen.findByRole("combobox", { name: "Boarding stop" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Demo ride" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open live chat" })).toBeNull();
    expect(mocks.mapProps.at(-1)?.offerLocation).toBe(false);
  });

  it("boards without location or the backend, keeps no joined-ride pointer, and ends without feedback", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<PassengerWorkspace />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole("button", { name: "Try the demo ride" }));
    await user.click(await screen.findByRole("combobox", { name: "Boarding stop" }));
    await user.click(screen.getByRole("option", { name: "Doordarshan Kendra" }));
    await user.click(screen.getByRole("option", { name: "Ahmedabad University" }));
    // The demo bus is waiting at Doordarshan Kendra, so there is nothing to tap.
    expect(screen.queryByRole("button", { name: "Board" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("group", { name: "Your trip" }).textContent).toContain("On board"));
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(Object.keys(localStorage).filter(key => key.startsWith("eki:joinedRide"))).toEqual([]);
    // Run the scripted ride to its terminus.
    await act(async () => { await vi.advanceTimersByTimeAsync(DEMO_RIDE_DURATION_MS + 1_000); });
    expect(await screen.findByText("Demo ride complete")).toBeTruthy();
    expect(screen.queryByText("Waiting for the next bus")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
    expect(screen.queryByText("QA feedback")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  }, 30_000);
});
