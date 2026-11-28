// @vitest-environment jsdom
// The app tour starts by itself after an account's first sign-in. The
// passenger opens Vaishnodevi Circle, the published Vaishnodevi route (a bus
// the tour drives in this browser), picks stops in the Thumb drawer and opens Routes and Profile
// themselves, or lets Next do each step; the tour can be skipped or replayed
// from Profile.
import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PassengerWorkspace from "./PassengerWorkspace";
import { setScenario } from "../../../../e2e/fixtures/state";
import type { PassengerMapProps } from "@/components/maps/PassengerMap";
import type { RouteData } from "@/hooks/useRoutes";
import { stopEstimateContext } from "@/lib/passengerStopEstimates";
import { resetDemoRideForTests } from "@/lib/demoRide";
import { resetTourRideForTests } from "@/lib/tourRide";
import { hasSeenTour, markTourSeen } from "@/lib/firstRunTour";
import { saveJoinedRidePointer } from "@/lib/joinedRidePointer";
configure({ asyncUtilTimeout: 5_000 });

const signedUpNow = () => {
  const now = new Date().toUTCString();
  return { creationTime: now, lastSignInTime: now };
};
const mocks = vi.hoisted(() => {
  const stop = (id: string, name: string, index: number) => ({ id, name, shortName: name, lat: 23.15 - index * 0.02, lng: 72.53 });
  // Configured and published as in Firestore; no bus is running on it.
  const vaishnodevi = {
    id: "route_01", name: "Vaishnodevi Circle", color: "#10B981", duration: "3774s", waypoints: [],
    stops: [
      stop("trident", "Trident Elanzza", 0), stop("godrej", "Godrej Garden City", 1), stop("gota", "Gota Chokdi Flyover", 2),
      stop("thaltej", "Thaltej Char Rasta", 3), stop("sbi", "SBI Branch Bodakdev", 4), stop("au", "Ahmedabad University", 5),
    ],
  };
  // An older copy of the same route that is still a route document but is not
  // published to passengers: the tour must never use it.
  const unpublishedCopy = { ...vaishnodevi, id: "Route-1", name: "Vaishnodevi to Campus" };
  return {
    auth: { currentUser: { uid: "qa-passenger", getIdToken: async () => "test-token", metadata: {} as Record<string, string> } },
    vaishnodevi,
    unpublishedCopy,
    routes: null as RouteData[] | null,
    // Route ids in settings/passengerRoutes; null publishes the QA route and Vaishnodevi Circle.
    published: null as string[] | null,
    // A real ride the passenger is joined to, as the server reports it; null keeps the fixture's.
    joinedRide: null as Record<string, unknown> | null,
    // When set, the joined-ride status waits for this before answering.
    joinedRideGate: null as Promise<void> | null,
  };
});
vi.mock("@/lib/firebaseAuth", () => ({ auth: mocks.auth }));
vi.mock("@/hooks/useAuth", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useLiveRouteCatalog", async () => import("../../../../e2e/fixtures/state"));
// The QA route, the unpublished copy, then Vaishnodevi Circle, unless a test sets its own routes.
vi.mock("@/hooks/useRoutes", async () => {
  const fixture = await import("../../../../e2e/fixtures/state");
  return { ...fixture, useRoutes: () => {
    const base = fixture.useRoutes();
    return { ...base, routes: mocks.routes ?? [...base.routes, mocks.unpublishedCopy, mocks.vaishnodevi] };
  } };
});
vi.mock("@/hooks/usePassengerRouteConfig", () => ({ usePassengerRouteConfig: () => ({
  config: { routes: (mocks.published ?? ["qa-route", "route_01"]).map(routeId => ({ routeId, stopTimes: {} })) },
  loading: false, error: null, saveConfig: async () => {},
}) }));
vi.mock("@/hooks/useSettings", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useRTDBResume", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/lib/liveBusStore", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/lib/joinedRideStatus", async () => {
  const fixture = await import("../../../../e2e/fixtures/state");
  return { getJoinedRideStatus: async (sessionId: string) => {
    if (mocks.joinedRideGate) await mocks.joinedRideGate;
    return mocks.joinedRide ? { sessionId, ...mocks.joinedRide } : fixture.getJoinedRideStatus(sessionId);
  } };
});
vi.mock("@/lib/authState", async () => import("../../../../e2e/fixtures/state"));
vi.mock("next/dynamic", () => ({ default: (loader: () => Promise<{ default: ComponentType<Record<string, unknown>> }>) => {
  const Loaded = lazy(loader);
  return function TestDynamic(props: Record<string, unknown>) { return <Suspense><Loaded {...props} /></Suspense>; };
} }));
// The tour's bus is reported heading for its fourth stop, Thaltej Char Rasta.
vi.mock("@/components/maps/PassengerTrackingMap", () => ({ default: function QaMap(props: PassengerMapProps) {
  const { route, selectedBusKey, onStopEstimatesChange } = props;
  useEffect(() => {
    if (route) onStopEstimatesChange?.({ context: stopEstimateContext(route, selectedBusKey, 1), minutes: { thaltej: 4, sbi: 9, au: 20 }, nextStopIndex: 3 });
  }, [route, selectedBusKey, onStopEstimatesChange]);
  return <div data-testid="tracking-map">QA map of {route?.name}</div>;
} }));
vi.mock("@/components/passenger/AccountTab", () => ({
  default: ({ onReplayTour }: { onReplayTour?: () => void }) => <button type="button" onClick={onReplayTour}>Replay app tour</button>,
}));
// A stand-in Routes tab: two route rows, and the tour hooks the real tab exposes.
vi.mock("@/components/passenger/RoutesTab", () => ({
  default: function QaRoutes({ onRouteOpen, tourRouteId, openTourRoute }: { onRouteOpen?: () => void; tourRouteId?: string; openTourRoute?: number }) {
    const [open, setOpen] = useState<string | null>(null);
    const tourRow = tourRouteId === "route_01" ? "route_01" : "qa-route";
    useEffect(() => { if (openTourRoute) setOpen(tourRow); }, [openTourRoute, tourRow]);
    useEffect(() => { if (open) onRouteOpen?.(); }, [open, onRouteOpen]);
    if (open) return <h2>{open === "route_01" ? "Vaishnodevi Circle" : "QA route"} timetable</h2>;
    return (
      <>
        <button type="button" data-tour={tourRow === "qa-route" ? "route-row" : undefined} onClick={() => setOpen("qa-route")}>View schedule for QA route</button>
        <button type="button" data-tour={tourRow === "route_01" ? "route-row" : undefined} onClick={() => setOpen("route_01")}>View schedule for Vaishnodevi Circle</button>
      </>
    );
  },
}));
vi.mock("@/components/shared/MessagingPanel", () => ({ default: () => <div>QA chat</div> }));
vi.mock("@/components/shared/FeedbackModal", () => ({ default: () => <div>QA feedback</div> }));

beforeEach(() => {
  setScenario("empty");
  mocks.routes = null;
  mocks.published = null;
  localStorage.clear();
  mocks.joinedRide = null;
  mocks.joinedRideGate = null;
  mocks.auth.currentUser.metadata = signedUpNow();
  window.history.replaceState(null, "", "/passenger");
  vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://qa.example.test");
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
    getCurrentPosition: vi.fn(), watchPosition: () => 1, clearWatch: () => {},
  } });
});
afterEach(() => { cleanup(); resetDemoRideForTests(); resetTourRideForTests(); vi.unstubAllEnvs(); localStorage.clear(); });

const tourCard = () => screen.findByRole("dialog", { name: /./ });
const next = (label = "Next") => userEvent.click(screen.getByRole("button", { name: label }));
const section = () => document.querySelector("[data-passenger-workspace]")?.getAttribute("data-passenger-section");
const tourRouteCard = () => screen.findByRole("button", { name: "Track Vaishnodevi Circle" });
/** Nothing on screen says the tour's bus is not real, or shows the unpublished copy. */
const expectNoDemoWording = () => {
  expect(screen.queryByText(/demo|practice|not a real bus/i)).toBeNull();
  expect(screen.queryByRole("button", { name: "Try the demo ride" })).toBeNull();
  expect(screen.queryByText(/Vaishnodevi to Campus/)).toBeNull();
};

describe("app tour", () => {
  it("starts after the first sign-in and lets the passenger try each part on Vaishnodevi Circle", async () => {
    render(<PassengerWorkspace />);
    expect((await tourCard()).getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Welcome to Eki" })).toBeTruthy();
    expect(screen.getByText("Tap a route to track its bus.")).toBeTruthy();
    expect(screen.getByText("1 of 6")).toBeTruthy();
    expect(screen.getByText(/Your turn/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip tour" })).toBeTruthy();
    // Focus starts on the card's content, not on a button with a ring.
    await waitFor(() => expect(document.activeElement?.classList.contains("pp-tour-content")).toBe(true));

    // Live routes lists the route as a live route, in place of the demo ride.
    const card = await tourRouteCard();
    expect(card.dataset.passengerRoute).toBe("tour-ride");
    expect(card.textContent).toContain("Trident Elanzza");
    expect(card.textContent).toContain("Ahmedabad University");
    expect(screen.getByText("1 route")).toBeTruthy();
    expectNoDemoWording();

    // The passenger opens it themselves.
    await userEvent.click(card);
    expect(await screen.findByRole("heading", { name: "Choose your stops" })).toBeTruthy();
    expect(section()).toBe("tracking");
    expect((await screen.findByTestId("tracking-map")).textContent).toContain("Vaishnodevi Circle");

    // They pick their own stops on the route timeline.
    await userEvent.click(await screen.findByRole("combobox", { name: "Boarding stop" }));
    await userEvent.click(await screen.findByRole("option", { name: "Thaltej Char Rasta" }));
    await userEvent.click(await screen.findByRole("option", { name: "Ahmedabad University" }));
    expect(await screen.findByRole("heading", { name: "Your trip" })).toBeTruthy();
    expect((await screen.findByRole("group", { name: "Your trip", hidden: true })).textContent).toContain("Thaltej Char Rasta");
    // The boarding note reads as it does on a live ride.
    expect(await screen.findByText("When the bus reaches your stop, Eki checks your location once to mark you on board.")).toBeTruthy();
    expectNoDemoWording();

    // Steps with nothing to try move on with Next. Chat sits where it does on a live ride.
    await next();
    expect(await screen.findByRole("heading", { name: "Text the driver" })).toBeTruthy();
    expect(screen.getByText("Chat with your driver from here.")).toBeTruthy();
    // It is shown, not offered: a screen reader hears that chat opens on a real bus.
    const chat = screen.getByRole("button", { name: "Live chat, opens on a real bus" });
    expect(chat.getAttribute("data-tour")).toBe("chat");
    expect(chat.getAttribute("aria-disabled")).toBe("true");
    await next();
    expect(await screen.findByRole("heading", { name: "Timetables" })).toBeTruthy();
    expect(section()).toBe("tracking");

    // Tab taps during the tour replace the history entry, as Next does, so the tour adds nothing to Back.
    const historyLength = window.history.length;
    // Routes asks for the tab, then for Vaishnodevi Circle, and moves on once it opens.
    expect(screen.getByText("Tap Routes.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Routes" }));
    expect(section()).toBe("routes");
    expect(await screen.findByText("Tap a route to see its stops and times.")).toBeTruthy();
    const row = await screen.findByRole("button", { name: "View schedule for Vaishnodevi Circle" });
    expect(row.dataset.tour).toBe("route-row");
    await userEvent.click(row);
    expect(await screen.findByRole("heading", { name: "Your profile" })).toBeTruthy();
    expect(screen.getByText("Tap Profile.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Vaishnodevi Circle timetable" })).toBeTruthy();

    expect(window.history.length).toBe(historyLength);
    // Tapping Profile shows the closing card beside Replay app tour; Done ends it there.
    await userEvent.click(screen.getByRole("button", { name: "Profile" }));
    expect(await screen.findByRole("heading", { name: "You're all set" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Skip tour" })).toBeNull();
    expect(section()).toBe("profile");
    await next("Done");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(section()).toBe("profile");
    expect(window.location.hash).toBe("#profile");
    expect(hasSeenTour("qa-passenger")).toBe(true);

    // The tour's bus leaves with the tour; Live routes is back to the real
    // list, and no demo ride takes its place.
    await userEvent.click(screen.getByRole("button", { name: "Live" }));
    expect(await screen.findByText("No buses running")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Track Vaishnodevi Circle" })).toBeNull();
    expect(screen.getByText("0 routes")).toBeTruthy();
    expectNoDemoWording();
  });

  it("does each step for the passenger with Next", async () => {
    render(<PassengerWorkspace />);
    await tourCard();
    await next();
    expect(await screen.findByRole("heading", { name: "Choose your stops" })).toBeTruthy();
    expect((await screen.findByTestId("tracking-map")).textContent).toContain("Vaishnodevi Circle");

    // Next chooses the stop the bus is heading to and the terminus; the bar
    // then slides into the drawer.
    await next();
    expect(await screen.findByRole("heading", { name: "Your trip" })).toBeTruthy();
    expect((await screen.findByRole("group", { name: "Your trip", hidden: true })).textContent).toContain("Thaltej Char Rasta");

    await next();
    expect(await screen.findByRole("heading", { name: "Text the driver" })).toBeTruthy();
    await next();
    expect(await screen.findByRole("heading", { name: "Timetables" })).toBeTruthy();
    // Next opens Routes and Vaishnodevi Circle's timetable.
    await next();
    expect(await screen.findByRole("heading", { name: "Your profile" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Vaishnodevi Circle timetable" })).toBeTruthy();
    expect(section()).toBe("routes");
    expect(window.location.hash).toBe("#routes");
    // Next opens Profile and shows the closing card.
    await next();
    expect(await screen.findByRole("heading", { name: "You're all set" })).toBeTruthy();
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
    expect(screen.queryByRole("button", { name: "Track Vaishnodevi Circle" })).toBeNull();
    unmount();

    render(<PassengerWorkspace />);
    await screen.findByText("No buses running");
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
    expectNoDemoWording();
  });

  it("closes with Escape", async () => {
    render(<PassengerWorkspace />);
    await tourCard();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(hasSeenTour("qa-passenger")).toBe(true);
  });

  it("closes when Back changes the section under it, and leaves the tour's bus", async () => {
    render(<PassengerWorkspace />);
    await tourCard();
    await userEvent.click(await tourRouteCard());
    expect(await screen.findByRole("heading", { name: "Choose your stops" })).toBeTruthy();
    window.history.pushState(null, "", "/passenger#routes");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(section()).toBe("routes");
    expect(hasSeenTour("qa-passenger")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Live" }));
    expect(await screen.findByText("No buses running")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Track Vaishnodevi Circle" })).toBeNull();
    expectNoDemoWording();
  });

  it("does not start for an account that has signed in before", async () => {
    mocks.auth.currentUser.metadata = { creationTime: "Mon, 02 Nov 2026 08:00:00 GMT", lastSignInTime: new Date().toUTCString() };
    render(<PassengerWorkspace />);
    await screen.findByText("No buses running");
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("replays from Profile", async () => {
    markTourSeen("qa-passenger");
    render(<PassengerWorkspace />);
    await screen.findByText("No buses running");
    await userEvent.click(screen.getByRole("button", { name: "Profile" }));
    await userEvent.click(await screen.findByRole("button", { name: "Replay app tour" }));
    expect(await screen.findByRole("heading", { name: "Welcome to Eki" })).toBeTruthy();
    expect(section()).toBe("home");
    expect(await tourRouteCard()).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try the demo ride" })).toBeNull();
  });

  it("gives a passenger on a real ride the short tour, so boarding the tour's bus cannot replace their ride", async () => {
    setScenario("forward");
    markTourSeen("qa-passenger");
    saveJoinedRidePointer("qa-passenger", "qa-session");
    mocks.joinedRide = { busId: "qa-bus", routeId: "qa-route", status: "in_service", boarding: { boardingStopId: "alpha", alightingStopId: null } };
    render(<PassengerWorkspace />);
    // The joined ride is restored and tracked.
    await waitFor(() => expect(section()).toBe("tracking"));
    await userEvent.click(screen.getByRole("button", { name: "Profile" }));
    await userEvent.click(await screen.findByRole("button", { name: "Replay app tour" }));
    expect(await screen.findByText("1 of 3")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Track Vaishnodevi Circle" })).toBeNull();
    await next();
    expect(await screen.findByRole("heading", { name: "Timetables" })).toBeTruthy();
  });

  it("starts the short tour after a first sign-in with a saved real ride", async () => {
    setScenario("forward");
    saveJoinedRidePointer("qa-passenger", "qa-session");
    mocks.joinedRide = { busId: "qa-bus", routeId: "qa-route", status: "in_service", boarding: { boardingStopId: "alpha", alightingStopId: null } };
    let finishRestore = () => {};
    mocks.joinedRideGate = new Promise<void>(resolve => { finishRestore = resolve; });
    render(<PassengerWorkspace />);
    expect(await screen.findByText("1 of 3")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Track Vaishnodevi Circle" })).toBeNull();
    finishRestore();
    await waitFor(() => expect(section()).toBe("tracking"));
    expect(screen.getByText("1 of 3")).toBeTruthy();
  });

  it("gives the short tour while a saved real ride is still being restored", async () => {
    setScenario("forward");
    markTourSeen("qa-passenger");
    saveJoinedRidePointer("qa-passenger", "qa-session");
    mocks.joinedRide = { busId: "qa-bus", routeId: "qa-route", status: "in_service", boarding: { boardingStopId: "alpha", alightingStopId: null } };
    let finishRestore = () => {};
    mocks.joinedRideGate = new Promise<void>(resolve => { finishRestore = resolve; });
    render(<PassengerWorkspace />);
    await screen.findByRole("button", { name: "Track QA route" });
    // Replay before the restore answers: the ride is not tracked yet.
    await userEvent.click(screen.getByRole("button", { name: "Profile" }));
    await userEvent.click(await screen.findByRole("button", { name: "Replay app tour" }));
    expect(await screen.findByText("1 of 3")).toBeTruthy();
    // The restore finishes mid-tour; the tour keeps its short steps.
    finishRestore();
    await waitFor(() => expect(section()).toBe("tracking"));
    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Track Vaishnodevi Circle" })).toBeNull();
    await next();
    expect(await screen.findByRole("heading", { name: "Timetables" })).toBeTruthy();
  });

  it("lists the tour's bus beside the routes that are live", async () => {
    setScenario("forward");
    render(<PassengerWorkspace />);
    await tourCard();
    const cards = [...document.querySelectorAll<HTMLElement>("[data-passenger-route]")].map(card => card.dataset.passengerRoute);
    expect(cards).toEqual(["tour-ride", "qa-route"]);
    expect(screen.getByText("2 routes")).toBeTruthy();
  });

  it("keeps a turned-on demo ride out of the tour, and lists it only after", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_RIDE", "true");
    render(<PassengerWorkspace />);
    await tourCard();
    expect(screen.getByText("1 of 6")).toBeTruthy();
    expect(await tourRouteCard()).toBeTruthy();
    expectNoDemoWording();
    await userEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(await screen.findByRole("button", { name: "Try the demo ride" })).toBeTruthy();
  });

  it("rides the first published route whose road can carry a bus when no Vaishnodevi route is published", async () => {
    mocks.published = ["short", "loop"];
    mocks.routes = [
      { id: "short", name: "One stop", color: "#801214", waypoints: [], stops: [{ id: "only", name: "Only stop", shortName: "Only", lat: 23, lng: 72 }] },
      { id: "loop", name: "Campus Loop", color: "#801214", waypoints: [], stops: [
        { id: "gate", name: "Main Gate", shortName: "Gate", lat: 23, lng: 72 },
        { id: "library", name: "Central Library", shortName: "Library", lat: 23.01, lng: 72.01 },
      ] },
    ];
    render(<PassengerWorkspace />);
    await tourCard();
    expect(await screen.findByRole("button", { name: "Track Campus Loop" })).toBeTruthy();
  });

  it("never rides an unpublished route, even a Vaishnodevi one", async () => {
    // Only the QA route is published; both Vaishnodevi documents are not.
    mocks.published = ["qa-route"];
    render(<PassengerWorkspace />);
    await tourCard();
    const card = await screen.findByRole("button", { name: "Track QA route" });
    expect(card.dataset.passengerRoute).toBe("tour-ride");
    expect(screen.queryByText(/Vaishnodevi/)).toBeNull();
  });

  it("introduces Live routes, Routes and Profile without live data", async () => {
    setScenario("catalog-denied");
    render(<PassengerWorkspace />);
    await tourCard();
    expect(screen.getByText("1 of 3")).toBeTruthy();
    await next();
    expect(await screen.findByRole("heading", { name: "Timetables" })).toBeTruthy();
    expect(section()).toBe("home");
    // Routes still points at Vaishnodevi Circle.
    await next();
    expect(await screen.findByRole("heading", { name: "Vaishnodevi Circle timetable" })).toBeTruthy();
  });
});
