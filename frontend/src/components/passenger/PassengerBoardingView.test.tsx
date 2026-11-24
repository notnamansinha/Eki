// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PassengerBoardingView from "./PassengerBoardingView";
import type { RouteData } from "@/hooks/useRoutes";
const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: "qa-passenger", getIdToken: vi.fn(async () => "test-token") } } }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: mocks.auth }));
const route: RouteData = { id: "qa-route", name: "QA route", color: "#3B82F6", waypoints: [], stops: [
  { id: "alpha", name: "Alpha", shortName: "A", lat: 23, lng: 72 },
  { id: "beta", name: "Beta", shortName: "B", lat: 23.01, lng: 72.01 },
] };
const threeStops: RouteData = { ...route, stops: [...route.stops, { id: "gamma", name: "Gamma", shortName: "C", lat: 23.02, lng: 72.02 }] };
let gps: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://qa.ngrok-free.dev");
  gps = vi.fn(success => success({ coords: { latitude: 23, longitude: 72, accuracy: 10 } }));
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: gps } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function prepare() {
  const joined = vi.fn(); render(<PassengerBoardingView sessionId="qa-session" route={route} tripState="in_service" onJoined={joined} />);
  const user = userEvent.setup();
  // No dead Board button: it appears in the rail once both stops are set.
  expect(screen.queryByRole("button", { name: "Board" })).toBeNull();
  await user.click(screen.getByRole("combobox", { name: "Boarding stop" }));
  await user.click(screen.getByRole("option", { name: "Alpha" }));
  await user.click(screen.getByRole("combobox", { name: "Destination station" }));
  await user.click(screen.getByRole("option", { name: "Beta" }));
  return { user, joined };
}
describe("passenger boarding workflow", () => {
  it("shows live ETA beside every stop and replaces it when telemetry is delayed", async () => {
    const estimates = { context: "session", minutes: { alpha: 1, beta: 3 }, nextStopIndex: 1 };
    const props = { sessionId: "qa-session", route, tripState: "in_service" as const };
    const view = render(<PassengerBoardingView {...props} stopEstimates={estimates} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Destination station" }));
    expect(screen.getByRole("option", { name: "Beta" }).textContent).toContain("3 min");
    expect(screen.getByRole("option", { name: "Alpha" }).textContent).toContain("Passed");
    view.rerender(<PassengerBoardingView {...props} stopEstimates={{ ...estimates, unavailable: "Signal delayed" }} />);
    expect(screen.getByRole("option", { name: "Beta" }).textContent).toContain("Signal delayed");
    expect(screen.queryByText("3 min")).toBeNull();
  });
  it("allows stop selection and boarding without displaying or submitting a code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"joined":true}')); vi.stubGlobal("fetch", fetchMock);
    const { user, joined } = await prepare();
    expect(screen.queryByRole("textbox", { name: "Boarding code" })).toBeNull();
    expect(screen.queryByText(/8-character|8-CHAR|session code/)).toBeNull();
    expect(screen.getByRole("button", { name: "Board" })).toHaveProperty("disabled", false);
    await user.click(screen.getByRole("button", { name: "Board" }));
    await waitFor(() => expect(joined).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("boardingCode");
  });
  it("keeps boarding and destination stops distinct and in ride order", async () => {
    const user = userEvent.setup();
    render(<PassengerBoardingView sessionId="qa-session" route={route} tripState="in_service" />);
    await user.click(screen.getByRole("combobox", { name: "Boarding stop" }));
    await user.click(screen.getByRole("option", { name: "Alpha" }));
    await user.click(screen.getByRole("combobox", { name: "Destination station" }));
    expect(screen.queryByRole("option", { name: "Alpha" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "Beta" }));
    // Both set: the card docks into the rail, which reopens it.
    await user.click(screen.getByRole("button", { name: "Change stops" }));
    await user.click(screen.getByRole("combobox", { name: "Boarding stop" }));
    await user.click(screen.getByRole("option", { name: "Beta" }));
    // No stop follows Beta, so the destination clears and Board leaves.
    expect(screen.getByRole("combobox", { name: "Destination station" }).textContent).toContain("Destination");
    expect(screen.queryByRole("button", { name: "Board" })).toBeNull();
  });
  it("offers only stops after the boarding stop as destinations", async () => {
    const user = userEvent.setup();
    render(<PassengerBoardingView sessionId="qa-session" route={threeStops} tripState="in_service" />);
    await user.click(screen.getByRole("combobox", { name: "Destination station" }));
    expect(screen.getAllByRole("option").map(option => option.getAttribute("aria-label"))).toEqual(["Alpha", "Beta", "Gamma"]);
    await user.click(screen.getByRole("option", { name: "Alpha" }));
    await user.click(screen.getByRole("combobox", { name: "Boarding stop" }));
    await user.click(screen.getByRole("option", { name: "Beta" }));
    // Alpha comes before Beta, so it no longer makes a trip.
    expect(screen.getByRole("combobox", { name: "Destination station" }).textContent).toContain("Destination");
    await user.click(screen.getByRole("combobox", { name: "Destination station" }));
    expect(screen.getAllByRole("option").map(option => option.getAttribute("aria-label"))).toEqual(["Gamma"]);
  });
  it("docks into a rail with both stop letters and ETAs, and reopens and tucks away again", async () => {
    const user = userEvent.setup();
    const estimates = { context: "s", minutes: { beta: 4, gamma: 19 }, nextStopIndex: 1 };
    render(<PassengerBoardingView sessionId="qa-session" route={threeStops} tripState="in_service" stopEstimates={estimates} />);
    await user.click(screen.getByRole("combobox", { name: "Boarding stop" }));
    await user.click(screen.getByRole("option", { name: "Beta" }));
    await user.click(screen.getByRole("combobox", { name: "Destination station" }));
    await user.click(screen.getByRole("option", { name: "Gamma" }));
    // The rows leave the accessibility tree; focus moves onto the rail.
    expect(screen.queryByRole("combobox", { name: "Boarding stop" })).toBeNull();
    const rail = screen.getByRole("button", { name: "Change stops" });
    expect(document.activeElement).toBe(rail);
    expect(rail.textContent).toBe("B4 minC19 min");
    expect(document.getElementById(rail.getAttribute("aria-describedby")!)?.textContent).toBe("From Beta, 4 min, to Gamma, 19 min");
    // The ride status keeps announcing while docked.
    expect(screen.getByRole("status").textContent).toContain("Ride in service");
    await user.click(rail);
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Boarding stop" }));
    expect(screen.queryByRole("button", { name: "Change stops" })).toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Change stops" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Change stops" }));
    // A tap outside the card, on the map, tucks it away too.
    await user.click(document.body);
    expect(screen.getByRole("button", { name: "Change stops" })).toBeTruthy();
  });
  it("shows verified restored choices without replaying boarding or caching a code", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<PassengerBoardingView sessionId="qa-session" route={route} tripState="in_service" restoredBoarding={{ boardingStopId: "alpha", alightingStopId: "beta" }} />);
    const button = await screen.findByRole("button", { name: "On board" });
    // A restored ride rests in the rail; its description names both stops.
    const rail = screen.getByRole("button", { name: "Change stops" });
    expect(document.getElementById(rail.getAttribute("aria-describedby")!)?.textContent).toMatch(/Alpha.*Beta/);
    expect(screen.queryByLabelText("Boarding code")).toBeNull();
    expect(button).toHaveProperty("disabled", true); expect(gps).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    rerender(<PassengerBoardingView sessionId="other-session" route={route} tripState="in_service" />);
    expect(await screen.findByRole("button", { name: "Board" })).toBeTruthy();
  });
  it("submits chosen stops and GPS once and only announces a confirmed join", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"joined":true}')); vi.stubGlobal("fetch", fetchMock);
    const { user, joined } = await prepare(); await user.click(screen.getByRole("button", { name: "Board" }));
    await waitFor(() => expect(joined).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ boardingStopId: "alpha", alightingStopId: "beta", lat: 23, lng: 72, accuracy: 10 });
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("ngrok-skip-browser-warning")).toBe("1");
    expect(gps).toHaveBeenCalledOnce();
  });
  it("does not call the API or confirm boarding when location permission is denied", async () => {
    gps.mockImplementation((_success, error) => error({ code: 1 }));
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { user, joined } = await prepare(); await user.click(screen.getByRole("button", { name: "Board" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Location access is required to board this bus.");
    expect(fetchMock).not.toHaveBeenCalled(); expect(joined).not.toHaveBeenCalled();
  });
  it.each(["{}", "null", "{\"joined\":false}", "<html>warning</html>"])("does not announce a joined ride for %s", async body => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const { user, joined } = await prepare(); await user.click(screen.getByRole("button", { name: "Board" }));
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
  it("leaves no dead Board button, and gives Board its location notice once both stops are set", async () => {
    render(<PassengerBoardingView sessionId="qa-session" route={route} tripState="in_service" />);
    expect(screen.getByRole("combobox", { name: "Boarding stop" }).textContent).toContain("Boarding stop");
    expect(screen.queryByRole("button", { name: "Board" })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Boarding stop" }));
    await user.click(screen.getByRole("option", { name: "Alpha" }));
    await user.click(screen.getByRole("combobox", { name: "Destination station" }));
    await user.click(screen.getByRole("option", { name: "Beta" }));
    const board = screen.getByRole("button", { name: "Board" });
    expect(board).toHaveProperty("disabled", false);
    // Shown beside Board, so it precedes the browser's location prompt.
    expect(document.getElementById(board.getAttribute("aria-describedby")!)?.textContent)
      .toBe("Boarding shares your location once to check that you are at the stop.");
  });
  it("explains in the rail why Board waits while live tracking is paused", async () => {
    const user = userEvent.setup();
    const props = { sessionId: "qa-session", route, tripState: "in_service" as const };
    const view = render(<PassengerBoardingView {...props} />);
    await user.click(screen.getByRole("combobox", { name: "Boarding stop" }));
    await user.click(screen.getByRole("option", { name: "Alpha" }));
    await user.click(screen.getByRole("combobox", { name: "Destination station" }));
    await user.click(screen.getByRole("option", { name: "Beta" }));
    view.rerender(<PassengerBoardingView {...props} boardingBlockedReason="Boarding resumes when live tracking returns." />);
    const board = screen.getByRole("button", { name: "Board" });
    expect(board).toHaveProperty("disabled", true);
    // The header already explains the pause; the rail gives Board the reason as its description.
    expect(board.getAttribute("aria-describedby")!.split(" ").map(id => document.getElementById(id)?.textContent))
      .toEqual(["Boarding resumes when live tracking returns."]);
  });
  it("aborts an in-flight join when the boarding view unmounts", async () => {
    const fetchMock = vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    vi.stubGlobal("fetch", fetchMock); const { user, joined } = await prepare();
    await user.click(screen.getByRole("button", { name: "Board" })); await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    cleanup(); expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true); expect(joined).not.toHaveBeenCalled();
  });
});
