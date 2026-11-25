// @vitest-environment jsdom
// The app tour starts by itself after an account's first sign-in. The
// passenger opens the demo ride, picks stops in the Thumb drawer and opens
// Routes and Profile themselves, or lets Next do each step; the tour can be
// skipped or replayed from Profile.
import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PassengerWorkspace from "./PassengerWorkspace";
import { setScenario } from "../../../../e2e/fixtures/state";
import type { PassengerMapProps } from "@/components/maps/PassengerMap";
import { stopEstimateContext } from "@/lib/passengerStopEstimates";
import { resetDemoRideForTests } from "@/lib/demoRide";
import { hasSeenTour, markTourSeen } from "@/lib/firstRunTour";
configure({ asyncUtilTimeout: 5_000 });

const signedUpNow = () => {
  const now = new Date().toUTCString();
  return { creationTime: now, lastSignInTime: now };
};
const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: "qa-passenger", getIdToken: async () => "test-token", metadata: {} as Record<string, string> } },
}));
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
// The demo bus is reported heading for its fifth stop, Gurukul Road.
vi.mock("@/components/maps/PassengerTrackingMap", () => ({ default: function QaMap(props: PassengerMapProps) {
  const { route, selectedBusKey, onStopEstimatesChange } = props;
  useEffect(() => {
    if (route) onStopEstimatesChange?.({ context: stopEstimateContext(route, selectedBusKey, 1), minutes: { "gurukul-road": 2, "ahmedabad-university": 9 }, nextStopIndex: 4 });
  }, [route, selectedBusKey, onStopEstimatesChange]);
  return <div data-testid="tracking-map">QA map</div>;
} }));
vi.mock("@/components/passenger/AccountTab", () => ({
  default: ({ onReplayTour }: { onReplayTour?: () => void }) => <button type="button" onClick={onReplayTour}>Replay app tour</button>,
}));
// A stand-in Routes tab: one route row, and the tour hooks the real tab exposes.
vi.mock("@/components/passenger/RoutesTab", () => ({
  default: function QaRoutes({ onRouteOpen, openFirstRoute }: { onRouteOpen?: () => void; openFirstRoute?: number }) {
    const [open, setOpen] = useState(false);
    useEffect(() => { if (openFirstRoute) setOpen(true); }, [openFirstRoute]);
    useEffect(() => { if (open) onRouteOpen?.(); }, [open, onRouteOpen]);
    return open ? <h2>QA route timetable</h2>
      : <button type="button" data-tour="route-row" onClick={() => setOpen(true)}>View schedule for QA route</button>;
  },
}));
vi.mock("@/components/shared/MessagingPanel", () => ({ default: () => <div>QA chat</div> }));
vi.mock("@/components/shared/FeedbackModal", () => ({ default: () => <div>QA feedback</div> }));

beforeEach(() => {
  setScenario("empty");
  localStorage.clear();
  mocks.auth.currentUser.metadata = signedUpNow();
  window.history.replaceState(null, "", "/passenger");
  vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://qa.example.test");
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
    getCurrentPosition: vi.fn(), watchPosition: () => 1, clearWatch: () => {},
  } });
});
afterEach(() => { cleanup(); resetDemoRideForTests(); vi.unstubAllEnvs(); localStorage.clear(); });

const tourCard = () => screen.findByRole("dialog", { name: /./ });
const next = (label = "Next") => userEvent.click(screen.getByRole("button", { name: label }));
const section = () => document.querySelector("[data-passenger-workspace]")?.getAttribute("data-passenger-section");

describe("app tour", () => {
  it("starts after the first sign-in and lets the passenger try each part", async () => {
    render(<PassengerWorkspace />);
    expect((await tourCard()).getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Welcome to Eki" })).toBeTruthy();
    expect(screen.getByText("1 of 6")).toBeTruthy();
    expect(screen.getByText(/Your turn/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip tour" })).toBeTruthy();
    // Focus starts on the card's content, not on a button with a ring.
    await waitFor(() => expect(document.activeElement?.classList.contains("pp-tour-content")).toBe(true));

    // The passenger opens the demo ride themselves.
    await userEvent.click(screen.getByRole("button", { name: "Try the demo ride" }));
    expect(await screen.findByRole("heading", { name: "Choose your stops" })).toBeTruthy();
    expect(section()).toBe("tracking");

    // They pick their own stops on the route timeline.
    await userEvent.click(await screen.findByRole("combobox", { name: "Boarding stop" }));
    await userEvent.click(await screen.findByRole("option", { name: "Gurukul Road" }));
    await userEvent.click(await screen.findByRole("option", { name: "Ahmedabad University" }));
    expect(await screen.findByRole("heading", { name: "Your trip" })).toBeTruthy();
    expect((await screen.findByRole("group", { name: "Your trip", hidden: true })).textContent).toContain("Gurukul Road");

    // Steps with nothing to try move on with Next. The demo ride has no
    // driver, so the tour shows where chat sits on a real bus.
    await next();
    expect(await screen.findByRole("heading", { name: "Text the driver" })).toBeTruthy();
    expect(document.querySelector('[data-tour="chat"]')).toBeTruthy();
    await next();
    expect(await screen.findByRole("heading", { name: "Timetables" })).toBeTruthy();
    expect(document.querySelector('[data-tour="chat"]')).toBeNull();
    expect(section()).toBe("tracking");

    // Routes waits for a route to be opened, not just the tab.
    await userEvent.click(screen.getByRole("button", { name: "Routes" }));
    expect(section()).toBe("routes");
    expect(screen.getByRole("heading", { name: "Timetables" })).toBeTruthy();
    await userEvent.click(await screen.findByRole("button", { name: "View schedule for QA route" }));
    expect(await screen.findByRole("heading", { name: "Your profile" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "QA route timetable" })).toBeTruthy();

    // Opening Profile finishes the tour there, beside Replay app tour.
    await userEvent.click(screen.getByRole("button", { name: "Profile" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(section()).toBe("profile");
    expect(window.location.hash).toBe("#profile");
    expect(hasSeenTour("qa-passenger")).toBe(true);
  });

  it("does each step for the passenger with Next", async () => {
    render(<PassengerWorkspace />);
    await tourCard();
    await next();
    expect(await screen.findByRole("heading", { name: "Choose your stops" })).toBeTruthy();
    expect(await screen.findByTestId("tracking-map")).toBeTruthy();

    // Next chooses the stop the bus is heading to and the terminus; the bar
    // then slides into the drawer.
    await next();
    expect(await screen.findByRole("heading", { name: "Your trip" })).toBeTruthy();
    expect((await screen.findByRole("group", { name: "Your trip", hidden: true })).textContent).toContain("Gurukul Road");

    await next();
    expect(await screen.findByRole("heading", { name: "Text the driver" })).toBeTruthy();
    await next();
    expect(await screen.findByRole("heading", { name: "Timetables" })).toBeTruthy();
    // Next opens Routes and a route's timetable.
    await next();
    expect(await screen.findByRole("heading", { name: "Your profile" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "QA route timetable" })).toBeTruthy();
    expect(section()).toBe("routes");
    expect(window.location.hash).toBe("#routes");
    expect(screen.queryByRole("button", { name: "Skip tour" })).toBeNull();
    await next("Done");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(section()).toBe("profile");
    expect(hasSeenTour("qa-passenger")).toBe(true);
  });

  it("can be skipped from the top of the card, and does not return", async () => {
    const { unmount } = render(<PassengerWorkspace />);
    await tourCard();
    await userEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(hasSeenTour("qa-passenger")).toBe(true);
    unmount();

    render(<PassengerWorkspace />);
    await screen.findByRole("button", { name: "Try the demo ride" });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes with Escape", async () => {
    render(<PassengerWorkspace />);
    await tourCard();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(hasSeenTour("qa-passenger")).toBe(true);
  });

  it("closes when Back changes the section under it", async () => {
    render(<PassengerWorkspace />);
    await tourCard();
    window.history.pushState(null, "", "/passenger#routes");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.querySelector("[data-passenger-workspace]")?.getAttribute("data-passenger-section")).toBe("routes");
    expect(hasSeenTour("qa-passenger")).toBe(true);
  });

  it("does not start for an account that has signed in before", async () => {
    mocks.auth.currentUser.metadata = { creationTime: "Mon, 02 Nov 2026 08:00:00 GMT", lastSignInTime: new Date().toUTCString() };
    render(<PassengerWorkspace />);
    await screen.findByRole("button", { name: "Try the demo ride" });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("replays from Profile", async () => {
    markTourSeen("qa-passenger");
    render(<PassengerWorkspace />);
    await screen.findByRole("button", { name: "Try the demo ride" });
    await userEvent.click(screen.getByRole("button", { name: "Profile" }));
    await userEvent.click(await screen.findByRole("button", { name: "Replay app tour" }));
    expect(await screen.findByRole("heading", { name: "Welcome to Eki" })).toBeTruthy();
    expect(document.querySelector("[data-passenger-workspace]")?.getAttribute("data-passenger-section")).toBe("home");
  });

  it("introduces Live routes, Routes and Profile when the demo ride is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_RIDE", "false");
    render(<PassengerWorkspace />);
    await tourCard();
    expect(screen.getByText("1 of 3")).toBeTruthy();
    await next();
    expect(await screen.findByRole("heading", { name: "Timetables" })).toBeTruthy();
    expect(section()).toBe("home");
  });
});
