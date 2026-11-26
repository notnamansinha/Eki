// @vitest-environment jsdom
// A single untrusted packet (GNSS-loss or a backend-held implausible jump,
// both published as motionState "uncertain") makes the bus momentarily
// unselectable. The boarding card and chat must survive the blip (break-it
// review of the 29 Oct 2026 field-ride fixes).
import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PassengerWorkspace from "./PassengerWorkspace";
import { setScenario } from "../../../../e2e/fixtures/state";
import type { PassengerMapProps } from "@/components/maps/PassengerMap";
import { stopEstimateContext } from "@/lib/passengerStopEstimates";
configure({ asyncUtilTimeout: 5_000 });
const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: "qa-passenger", getIdToken: async () => "test-token" } } }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: mocks.auth }));
vi.mock("@/hooks/useAuth", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useLiveRouteCatalog", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/usePassengerRouteConfig", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useRoutes", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useSettings", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useRTDBResume", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useRideChatUnread", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/lib/liveBusStore", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/lib/joinedRideStatus", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/lib/authState", async () => import("../../../../e2e/fixtures/state"));
vi.mock("next/dynamic", () => ({ default: (loader: () => Promise<{ default: ComponentType<Record<string, unknown>> }>) => {
  const Loaded = lazy(loader);
  return function TestDynamic(props: Record<string, unknown>) { return <Suspense><Loaded {...props} /></Suspense>; };
} }));
// The real map computes progress from the bus; here a test says when the bus
// is waiting at Alpha, the passenger's boarding stop.
const map = vi.hoisted(() => ({ atAlpha: false }));
vi.mock("@/components/maps/PassengerTrackingMap", () => ({ default: function QaMap({ targetStop, route, selectedBusKey, onStopEstimatesChange }: PassengerMapProps) {
  useEffect(() => {
    if (route && map.atAlpha) onStopEstimatesChange?.({ context: stopEstimateContext(route, selectedBusKey), minutes: { beta: 3 }, nextStopIndex: 1, atStopIndex: 0 });
  });
  return <div data-testid="tracking-map" data-target={targetStop.id}>QA map</div>;
} }));
vi.mock("@/components/passenger/AccountTab", () => ({ default: () => <button>QA account control</button> }));
const chat = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("@/components/shared/MessagingPanel", async () => {
  const { useEffect } = await import("react");
  return { default: function QaChat() { useEffect(() => { chat.mounts++; }, []); return <div>QA chat</div>; } };
});
vi.mock("@/components/shared/FeedbackModal", () => ({ default: () => <div>QA feedback</div> }));

beforeEach(() => {
  map.atAlpha = false;
  setScenario("forward");
  localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://qa.example.test");
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
    getCurrentPosition: (success: PositionCallback) => success({ coords: { latitude: 23, longitude: 72, accuracy: 10 } } as GeolocationPosition),
    watchPosition: () => 1, clearWatch: () => {},
  } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear(); });

/** From → To through the picker; the bar then docks into the drawer. */
async function chooseStops(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: "Boarding stop" }));
  await user.click(screen.getByRole("option", { name: "Alpha" }));
  await user.click(screen.getByRole("option", { name: "Beta" }));
  return screen.findByRole("group", { name: "Your trip" });
}

async function openBoarding() {
  render(<PassengerWorkspace />); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Track QA route" }));
  await screen.findByRole("combobox", { name: "Boarding stop" });
  return user;
}

describe("one untrusted packet must not reset the passenger's boarding card or chat", () => {
  it("keeps a chosen boarding stop through a one-packet GNSS/held-jump blip", async () => {
    const user = await openBoarding();
    await user.click(screen.getByRole("combobox", { name: "Boarding stop" }));
    await user.click(screen.getByRole("option", { name: "Alpha" }));
    expect(screen.getByRole("combobox", { name: "Boarding stop" }).textContent).toContain("Alpha");
    // One "uncertain" packet, then the next 1 Hz fix is good again.
    act(() => setScenario("gnss-lost"));
    await screen.findByText("GPS signal lost");
    act(() => setScenario("forward"));
    const boarding = await screen.findByRole("combobox", { name: "Boarding stop" });
    expect(boarding.textContent).toContain("Alpha");
  });

  it("keeps 'On board' for a joined passenger after a one-packet blip", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"joined":true}')));
    const user = await openBoarding();
    await chooseStops(user);
    // The bus reaches Alpha, which boards the passenger.
    map.atAlpha = true;
    act(() => setScenario("forward"));
    const onBoard = () => screen.queryByRole("group", { name: "Your trip" })?.textContent ?? "";
    // Precondition: the passenger is on board before the blip.
    await waitFor(() => expect(onBoard()).toContain("On board"));
    act(() => setScenario("gnss-lost"));
    await screen.findByText("GPS signal lost");
    act(() => setScenario("forward"));
    await waitFor(() => expect(onBoard()).toContain("On board"));
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  }, 20_000);

  it("withholds boarding during the blip without discarding the card", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"joined":true}')); vi.stubGlobal("fetch", fetchMock);
    const user = await openBoarding();
    await chooseStops(user);
    // The bus reaches Alpha during the blip: boarding waits for tracking to return.
    map.atAlpha = true;
    act(() => setScenario("gnss-lost"));
    await screen.findByText("GPS signal lost");
    expect(screen.getByText("Boarding resumes when live tracking returns.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => setScenario("forward"));
    await waitFor(() => expect(screen.getByRole("group", { name: "Your trip" }).textContent).toContain("On board"));
    expect(fetchMock).toHaveBeenCalledOnce();
  }, 20_000);

  it("keeps an open live chat through a GNSS blip without remounting it", async () => {
    const user = await openBoarding();
    await user.click(await screen.findByRole("button", { name: "Open live chat" }));
    await screen.findByText("QA chat");
    const mountsBefore = chat.mounts;
    act(() => setScenario("gnss-lost"));
    await screen.findByText("GPS signal lost");
    // Chat needs the connection, not a GPS fix.
    expect(screen.getByText("QA chat")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close live chat" })).toBeTruthy();
    act(() => setScenario("forward"));
    await screen.findByText("QA chat");
    expect(chat.mounts).toBe(mountsBefore);
  }, 20_000);

  it("hides chat when live tracking is lost and the Back button then really goes back", async () => {
    const user = await openBoarding();
    await user.click(await screen.findByRole("button", { name: "Open live chat" }));
    await screen.findByText("QA chat");
    act(() => setScenario("stale"));
    await screen.findByText("Live tracking lost");
    expect(screen.queryByText("QA chat")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close live chat" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back to home" })).toBeTruthy();
  }, 20_000);
});
