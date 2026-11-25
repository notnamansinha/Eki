// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PassengerBoardingView, { DEMO_NOTICE, LOCATION_NOTICE, TRIP_DOCK_DELAY_MS } from "./PassengerBoardingView";
import type { RouteData } from "@/hooks/useRoutes";
import { DEMO_BOARDING_MS } from "@/lib/demoRide";
const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: "qa-passenger", getIdToken: vi.fn(async () => "test-token") } } }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: mocks.auth }));
const route: RouteData = { id: "qa-route", name: "QA route", color: "#3B82F6", waypoints: [], stops: [
  { id: "alpha", name: "Alpha", shortName: "A", lat: 23, lng: 72 },
  { id: "beta", name: "Beta", shortName: "B", lat: 23.01, lng: 72.01 },
  { id: "gamma", name: "Gamma", shortName: "C", lat: 23.02, lng: 72.02 },
] };
const DOCKED = { timeout: TRIP_DOCK_DELAY_MS + 1_500 };
let gps: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://qa.ngrok-free.dev");
  gps = vi.fn(success => success({ coords: { latitude: 23, longitude: 72, accuracy: 10 } }));
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: gps } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const disabled = (name: string) => screen.getByRole("option", { name }).getAttribute("aria-disabled") === "true";
const choosable = (listbox: string) => within(screen.getByRole("listbox", { name: listbox })).getAllByRole("option")
  .filter(option => option.getAttribute("aria-disabled") !== "true").map(option => option.getAttribute("aria-label"));
const hidden = (name: string) => (document.querySelector(`input[name="${name}"]`) as HTMLInputElement).value;
/** The bus is on its way to Alpha, then waiting at it. */
const approaching = { context: "s", minutes: { alpha: 2, beta: 6 }, nextStopIndex: 0 };
const atAlpha = { context: "s", minutes: { beta: 3 }, nextStopIndex: 1, atStopIndex: 0 };
/** Choose both stops through the From → To bar and wait for the drawer. */
async function chooseStops(user: ReturnType<typeof userEvent.setup>, from = "Alpha", to = "Beta") {
  await user.click(screen.getByRole("combobox", { name: "Boarding stop" }));
  await user.click(screen.getByRole("option", { name: from }));
  await user.click(screen.getByRole("option", { name: to }));
  return screen.findByRole("group", { name: "Your trip" }, DOCKED);
}
type Props = Parameters<typeof PassengerBoardingView>[0];
/** Alpha → Beta chosen while the bus approaches; `arrive()` brings it to Alpha. */
async function prepare(props: Partial<Props> = {}) {
  const joined = vi.fn();
  const base: Props = { sessionId: "qa-session", route, tripState: "in_service", onJoined: joined, stopEstimates: approaching, ...props };
  const view = render(<PassengerBoardingView {...base} />);
  const user = userEvent.setup();
  await chooseStops(user);
  const arrive = (more: Partial<Props> = {}) => view.rerender(<PassengerBoardingView {...base} stopEstimates={atAlpha} {...more} />);
  return { user, joined, arrive };
}

describe("From → To bar and stop picker", () => {
  it("opens the route timeline as the picker, then asks for the destination among later stops", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<PassengerBoardingView sessionId="qa-session" route={route} tripState="in_service" onBoardingStopChange={changed} />);
    const from = screen.getByRole("combobox", { name: "Boarding stop" });
    await user.click(from);
    expect(from.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Where are you boarding?")).toBeTruthy();
    expect(screen.getByRole("listbox", { name: "Boarding stop" })).toBeTruthy();
    // A trip needs a later stop, so the terminus is never a boarding stop.
    expect(disabled("Gamma")).toBe(true);
    await user.click(screen.getByRole("option", { name: "Alpha" }));
    expect(changed).toHaveBeenLastCalledWith("alpha");
    expect(screen.getByText("Where are you going?")).toBeTruthy();
    expect(screen.getByText("Stops after Alpha")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Destination station" }).getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Destination station" })));
    expect(choosable("Destination station")).toEqual(["Beta", "Gamma"]);
    // The boarding stop stays in the list as context, not as a choice.
    expect(disabled("Alpha")).toBe(true);
    await user.click(screen.getByRole("option", { name: "Gamma" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect([hidden("boarding-stop"), hidden("destination-station")]).toEqual(["alpha", "gamma"]);
  });

  it("shows live ETA beside every stop, folds passed stops away and replaces ETAs when telemetry is delayed", async () => {
    const estimates = { context: "session", minutes: { beta: 3, gamma: 7 }, nextStopIndex: 1 };
    const props = { sessionId: "qa-session", route, tripState: "in_service" as const };
    const view = render(<PassengerBoardingView {...props} stopEstimates={estimates} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Boarding stop" }));
    expect(screen.getByRole("option", { name: "Beta" }).textContent).toContain("3 min");
    expect(screen.getByRole("option", { name: "Beta" }).textContent).toContain("Next stop");
    expect(screen.queryByRole("option", { name: "Alpha" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "1 passed stop" }));
    expect(screen.getByRole("option", { name: "Alpha" }).textContent).toContain("Passed");
    view.rerender(<PassengerBoardingView {...props} stopEstimates={{ ...estimates, unavailable: "Signal delayed" }} />);
    expect(screen.getByRole("option", { name: "Beta" }).textContent).toContain("Signal delayed");
    expect(screen.queryByText("3")).toBeNull();
  });

  it("is fully operable from the keyboard", async () => {
    const user = userEvent.setup();
    render(<PassengerBoardingView sessionId="qa-session" route={route} tripState="in_service" />);
    screen.getByRole("combobox", { name: "Boarding stop" }).focus();
    await user.keyboard("{ArrowDown}");
    const from = screen.getByRole("combobox", { name: "Boarding stop" });
    expect(from.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(from.getAttribute("aria-activedescendant")!)?.getAttribute("aria-label")).toBe("Alpha");
    await user.keyboard("{ArrowDown}");
    expect(document.getElementById(from.getAttribute("aria-activedescendant")!)?.getAttribute("aria-label")).toBe("Beta");
    await user.keyboard("{ArrowUp}{Enter}");
    const to = screen.getByRole("combobox", { name: "Destination station" });
    await waitFor(() => expect(document.activeElement).toBe(to));
    await user.keyboard("{End}{Enter}");
    expect([hidden("boarding-stop"), hidden("destination-station")]).toEqual(["alpha", "gamma"]);
    // Docking moves focus into the drawer, never onto a removed control.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show trip" })), DOCKED);
  });
});

describe("drawer", () => {
  it("slides the trip into a drawer that keeps the boarding stop and the bus ETA, with no Board button", async () => {
    render(<PassengerBoardingView sessionId="qa-session" route={route} tripState="in_service" stopEstimates={approaching} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Boarding stop" }));
    await user.click(screen.getByRole("option", { name: "Alpha" }));
    await user.click(screen.getByRole("option", { name: "Beta" }));
    // The whole trip shows first, then docks.
    expect(screen.getByRole("combobox", { name: "Boarding stop" }).textContent).toContain("From · bus in 2 min");
    expect(screen.getByRole("combobox", { name: "Destination station" }).textContent).toContain("To · 6 min");
    const drawer = await screen.findByRole("group", { name: "Your trip" }, DOCKED);
    expect(drawer.textContent).toContain("Alpha");
    expect(drawer.textContent).toContain("Bus in 2 min");
    expect(screen.getByText(LOCATION_NOTICE)).toBeTruthy();
    expect(within(drawer).getAllByRole("button").map(button => button.getAttribute("aria-label") ?? button.textContent)).toEqual(["Show trip"]);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("pulls the full bar back out with ‹ and tucks it away on Escape or a tap outside", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    const { user } = await prepare();
    await user.click(screen.getByRole("button", { name: "Show trip" }));
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Boarding stop" }));
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("group", { name: "Your trip" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show trip" }));
    await user.click(screen.getByRole("button", { name: "Show trip" }));
    await user.click(outside);
    expect(await screen.findByRole("group", { name: "Your trip" })).toBeTruthy();
    outside.remove();
  });

  it("waits to board while live tracking is paused and says why", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"joined":true}')); vi.stubGlobal("fetch", fetchMock);
    const reason = "Boarding resumes when live tracking returns.";
    const { joined, arrive } = await prepare({ boardingBlockedReason: reason });
    arrive({ boardingBlockedReason: reason });
    expect(screen.getByText(reason)).toBeTruthy();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(gps).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    // Tracking returns while the bus is still at the stop: boarding goes ahead.
    arrive({ boardingBlockedReason: undefined });
    await waitFor(() => expect(joined).toHaveBeenCalledOnce());
  });
});

describe("passenger boarding workflow", () => {
  it("starts as a From → To bar with no Board button and nothing chosen", () => {
    render(<PassengerBoardingView sessionId="qa-session" route={route} tripState="in_service" />);
    expect(screen.getByRole("combobox", { name: "Boarding stop" }).textContent).toContain("Your stop");
    expect(screen.getByRole("combobox", { name: "Destination station" }).textContent).toContain("Where to?");
    expect(screen.queryByRole("button", { name: "Board" })).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  // A destination that no longer follows the boarding stop is cleared.
  it("keeps boarding and destination stops distinct", async () => {
    const user = userEvent.setup();
    const destination = vi.fn();
    render(<PassengerBoardingView sessionId="qa-session" route={route} tripState="in_service" onDestinationStopChange={destination} />);
    await chooseStops(user, "Alpha", "Beta");
    await user.click(screen.getByRole("button", { name: "Show trip" }));
    await user.click(screen.getByRole("combobox", { name: "Destination station" }));
    expect(choosable("Destination station")).toEqual(["Beta", "Gamma"]);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Boarding stop" }));
    expect(disabled("Gamma")).toBe(true);
    // Beta is no longer a destination after boarding at Beta: it clears and the list moves on.
    await user.click(screen.getByRole("option", { name: "Beta" }));
    expect(destination).toHaveBeenLastCalledWith("");
    expect(screen.getByText("Stops after Beta")).toBeTruthy();
    expect(choosable("Destination station")).toEqual(["Gamma"]);
    await user.click(screen.getByRole("option", { name: "Gamma" }));
    expect(destination).toHaveBeenLastCalledWith("gamma");
    expect([hidden("boarding-stop"), hidden("destination-station")]).toEqual(["beta", "gamma"]);
  });

  // The app tour's Next chooses a trip for the passenger through this prop.
  it("applies a preset trip once, as a passenger's choice, and sends nothing before the bus arrives", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const boardingChange = vi.fn();
    const destinationChange = vi.fn();
    const props = { sessionId: "qa-session", route, tripState: "in_service" as const, stopEstimates: approaching,
      onBoardingStopChange: boardingChange, onDestinationStopChange: destinationChange };
    const view = render(<PassengerBoardingView {...props} presetTrip={{ boardingStopId: "alpha", alightingStopId: "gamma" }} />);
    const drawer = await screen.findByRole("group", { name: "Your trip" }, DOCKED);
    expect(drawer.textContent).toContain("Alpha");
    expect(boardingChange).toHaveBeenLastCalledWith("alpha");
    expect(destinationChange).toHaveBeenLastCalledWith("gamma");
    expect([hidden("boarding-stop"), hidden("destination-station")]).toEqual(["alpha", "gamma"]);
    // A trip that does not run forward is ignored, leaving the chosen one.
    view.rerender(<PassengerBoardingView {...props} destinationStopId="gamma" presetTrip={{ boardingStopId: "gamma", alightingStopId: "alpha" }} />);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect([hidden("boarding-stop"), hidden("destination-station")]).toEqual(["alpha", "gamma"]);
    expect(boardingChange).toHaveBeenCalledTimes(1);
    // The bus is still approaching, so no join was sent.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows stop selection and boarding without displaying or submitting a code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"joined":true}')); vi.stubGlobal("fetch", fetchMock);
    const { joined, arrive } = await prepare();
    expect(screen.queryByRole("textbox", { name: "Boarding code" })).toBeNull();
    expect(screen.queryByText(/8-character|8-CHAR|session code/)).toBeNull();
    arrive();
    await waitFor(() => expect(joined).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("boardingCode");
  });

  it("shows verified restored choices without replaying boarding or caching a code", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<PassengerBoardingView sessionId="qa-session" route={route} tripState="in_service" restoredBoarding={{ boardingStopId: "alpha", alightingStopId: "beta" }} />);
    const drawer = await screen.findByRole("group", { name: "Your trip" });
    expect(drawer.textContent).toContain("On board");
    expect(drawer.textContent).toContain("Beta");
    expect(screen.queryByRole("button", { name: "Board" })).toBeNull();
    expect(screen.queryByLabelText("Boarding code")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Show trip" }));
    expect(screen.getByRole("combobox", { name: "Boarding stop" }).textContent).toContain("From · on board");
    expect(screen.getByRole("combobox", { name: "Boarding stop" }).textContent).toContain("Alpha");
    expect(screen.getByRole("combobox", { name: "Destination station" }).textContent).toContain("Beta");
    expect(gps).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    rerender(<PassengerBoardingView sessionId="other-session" route={route} tripState="in_service" />);
    expect(await screen.findByRole("group", { name: "Your trip" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Your trip" }).textContent).not.toContain("On board");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits chosen stops and GPS once and only announces a confirmed join", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"joined":true}')); vi.stubGlobal("fetch", fetchMock);
    const { joined, arrive } = await prepare();
    // Nothing is sent, and location is not asked for, until the bus reaches the stop.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(gps).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    arrive();
    await waitFor(() => expect(joined).toHaveBeenCalledOnce());
    arrive(); arrive();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ boardingStopId: "alpha", alightingStopId: "beta", lat: 23, lng: 72, accuracy: 10 });
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("ngrok-skip-browser-warning")).toBe("1");
    expect(gps).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    // On board: focus stays in the drawer and the change is announced.
    expect(screen.getByRole("group", { name: "Your trip" }).textContent).toContain("On board");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show trip" }));
    expect(screen.getAllByRole("status").some(region => region.textContent?.includes("On board"))).toBe(true);
  });

  it("does not call the API or confirm boarding when location permission is denied", async () => {
    gps.mockImplementation((_success, error) => error({ code: 1 }));
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"joined":true}')); vi.stubGlobal("fetch", fetchMock);
    const { user, joined, arrive } = await prepare(); arrive();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Location access is required to board this bus.");
    expect(fetchMock).not.toHaveBeenCalled(); expect(joined).not.toHaveBeenCalled();
    // It is not retried by itself; Try again checks once more.
    arrive();
    expect(gps).toHaveBeenCalledOnce();
    gps.mockImplementation(success => success({ coords: { latitude: 23, longitude: 72, accuracy: 10 } }));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(joined).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("tries while the bus is under a minute away, quietly waits if it is still too far, and boards when it is at the stop", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"You must be near the bus to board."}', { status: 403 }))
      .mockResolvedValue(new Response('{"joined":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const { joined, arrive } = await prepare();
    // An origin is not always marked "at" before departure, so "Bus arriving" counts.
    arrive({ stopEstimates: { context: "s", minutes: { alpha: 0, beta: 4 }, nextStopIndex: 0 } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(joined).not.toHaveBeenCalled();
    arrive();
    await waitFor(() => expect(joined).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not try the demo ride before its bus is at the stop", async () => {
    const joined = vi.fn();
    render(<PassengerBoardingView sessionId="demo-1" route={route} tripState="in_service" demo onJoined={joined}
      stopEstimates={{ context: "demo", minutes: { alpha: 0, beta: 4 }, nextStopIndex: 0 }} />);
    await chooseStops(userEvent.setup());
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByRole("alert")).toBeNull(); expect(joined).not.toHaveBeenCalled();
  });

  it("boards a passenger who names a stop the bus has already left, as they may be on it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"joined":true}')); vi.stubGlobal("fetch", fetchMock);
    const joined = vi.fn();
    render(<PassengerBoardingView sessionId="qa-session" route={route} tripState="in_service" onJoined={joined}
      stopEstimates={{ context: "s", minutes: { gamma: 2 }, nextStopIndex: 2 }} />);
    await chooseStops(userEvent.setup(), "Beta", "Gamma");
    await waitFor(() => expect(joined).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ boardingStopId: "beta", alightingStopId: "gamma", lat: 23 });
  });

  it.each(["{}", "null", "{\"joined\":false}", "<html>warning</html>"])("does not announce a joined ride for %s", async body => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const { joined, arrive } = await prepare(); arrive();
    expect(await screen.findByRole("alert")).toBeTruthy(); expect(joined).not.toHaveBeenCalled();
  });

  it("says whether the location is live, not just that the ride is in service (field ride, 29 Oct 2026)", () => {
    const props = { sessionId: "qa-session", route, tripState: "in_service" as const };
    const view = render(<PassengerBoardingView {...props} liveHealth={{ state: "live", ageMs: 1_000 }} />);
    expect(screen.getByRole("status").textContent).toContain("Ride in service · Live");
    view.rerender(<PassengerBoardingView {...props} liveHealth={{ state: "delayed", ageMs: 14_000 }} />);
    expect(screen.getByRole("status").textContent).toContain("Updates delayed · 14 s ago");
  });

  it("colours the ride status by live health, never green while tracking is degraded", () => {
    const props = { sessionId: "qa-session", route };
    const colour = () => (screen.getByRole("status").firstElementChild as HTMLElement).getAttribute("data-tone");
    const view = render(<PassengerBoardingView {...props} tripState="in_service" liveHealth={{ state: "live", ageMs: 1_000 }} />);
    expect(colour()).toBe("live");
    for (const [state, expected] of [["delayed", "warning"], ["gnss_lost", "warning"], ["lost", "danger"], ["offline", "danger"]] as const) {
      view.rerender(<PassengerBoardingView {...props} tripState="in_service" liveHealth={{ state, ageMs: 40_000 }} />);
      expect([state, colour()]).toEqual([state, expected]);
    }
    view.rerender(<PassengerBoardingView {...props} tripState="pre_departure" liveHealth={{ state: "live", ageMs: 1_000 }} />);
    expect(colour()).toBe("warning");
    view.rerender(<PassengerBoardingView {...props} tripState="pre_departure" liveHealth={{ state: "lost", ageMs: 40_000 }} />);
    expect(colour()).toBe("danger");
    // Without a health reading it neither claims Live nor shows green.
    view.rerender(<PassengerBoardingView {...props} tripState="in_service" />);
    expect(screen.getByRole("status").firstElementChild!.textContent).toBe("Ride in service");
    expect(colour()).toBe("warning");
  });

  it("shows where the bus is without opening the timeline, including at the origin", () => {
    const props = { sessionId: "qa-session", route, tripState: "in_service" as const };
    const view = render(<PassengerBoardingView {...props} stopEstimates={{ context: "s", minutes: {}, nextStopIndex: 0, atStopIndex: 0 }} />);
    expect(screen.getByRole("status").textContent).toContain("At Alpha · Next: Beta");
    view.rerender(<PassengerBoardingView {...props} stopEstimates={{ context: "s", minutes: {}, nextStopIndex: 1 }} />);
    expect(screen.getByRole("status").textContent).toContain("Next: Beta");
    expect(screen.getByRole("status").textContent).not.toContain("At ");
  });

  it("aborts an in-flight join when the boarding view unmounts", async () => {
    const fetchMock = vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    vi.stubGlobal("fetch", fetchMock); const { joined, arrive } = await prepare();
    arrive(); await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    cleanup(); expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true); expect(joined).not.toHaveBeenCalled();
  });
});

describe("demo ride boarding", () => {
  const approachingBeta = { context: "demo", minutes: { beta: 3, gamma: 6 }, nextStopIndex: 1 };
  const atBeta = { context: "demo", minutes: { gamma: 3 }, nextStopIndex: 2, atStopIndex: 1 };

  it("marks a demo passenger on board when the demo bus reaches their stop, without location or the backend", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const joined = vi.fn();
    const props = { sessionId: "demo-1", route, tripState: "in_service" as const, demo: true, onJoined: joined };
    const view = render(<PassengerBoardingView {...props} stopEstimates={approachingBeta} />);
    const drawer = await chooseStops(userEvent.setup(), "Beta", "Gamma");
    expect(screen.getByText(DEMO_NOTICE)).toBeTruthy();
    expect(drawer.textContent).toContain("Bus in 3 min");
    expect(screen.queryByRole("alert")).toBeNull();
    view.rerender(<PassengerBoardingView {...props} stopEstimates={atBeta} />);
    expect(await screen.findByText("The demo bus has reached your stop. Marking you on board…")).toBeTruthy();
    await waitFor(() => expect(joined).toHaveBeenCalledOnce(), { timeout: DEMO_BOARDING_MS + 1_000 });
    expect(gps).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Your trip" }).textContent).toContain("On board");
  });

  it("tells a passenger whose stop the demo bus has left to choose one ahead", async () => {
    render(<PassengerBoardingView sessionId="demo-1" route={route} tripState="in_service" demo
      stopEstimates={{ context: "demo", minutes: { gamma: 2 }, nextStopIndex: 2 }} />);
    // Every boarding choice is behind the bus, so the passed stops are already open.
    await chooseStops(userEvent.setup(), "Beta", "Gamma");
    expect((await screen.findByRole("alert")).textContent).toBe("The demo bus has already left Beta. Choose a stop ahead of it.");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
