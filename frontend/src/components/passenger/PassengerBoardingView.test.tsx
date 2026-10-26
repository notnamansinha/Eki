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
  expect((screen.getByRole("button", { name: "Board" }) as HTMLButtonElement).disabled).toBe(true);
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
  it("keeps boarding and destination stops distinct", async () => {
    const user = userEvent.setup();
    render(<PassengerBoardingView sessionId="qa-session" route={route} tripState="in_service" />);
    await user.click(screen.getByRole("combobox", { name: "Boarding stop" }));
    await user.click(screen.getByRole("option", { name: "Alpha" }));
    await user.click(screen.getByRole("combobox", { name: "Destination station" }));
    expect(screen.queryByRole("option", { name: "Alpha" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "Beta" }));
    await user.click(screen.getByRole("combobox", { name: "Boarding stop" }));
    await user.click(screen.getByRole("option", { name: "Beta" }));
    expect(screen.getByRole("combobox", { name: "Destination station" }).textContent)
      .toContain("Choose destination station");
    expect(screen.getByRole("button", { name: "Board" })).toHaveProperty("disabled", true);
  });
  it("shows verified restored choices without replaying boarding or caching a code", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<PassengerBoardingView sessionId="qa-session" route={route} tripState="in_service" restoredBoarding={{ boardingStopId: "alpha", alightingStopId: "beta" }} />);
    const button = await screen.findByRole("button", { name: "On board" });
    expect(screen.getByRole("combobox", { name: "Boarding stop" }).textContent).toContain("Alpha");
    expect(screen.getByRole("combobox", { name: "Destination station" }).textContent).toContain("Beta");
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
  it("aborts an in-flight join when the boarding view unmounts", async () => {
    const fetchMock = vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    vi.stubGlobal("fetch", fetchMock); const { user, joined } = await prepare();
    await user.click(screen.getByRole("button", { name: "Board" })); await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    cleanup(); expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true); expect(joined).not.toHaveBeenCalled();
  });
});
