// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PassengerBoardingView from "./PassengerBoardingView";
import type { RouteData } from "@/hooks/useRoutes";
import { beginAuthVerification } from "@/lib/authState";

const sdk = vi.hoisted(() => ({ token: vi.fn(), auth: { currentUser: null as null | { uid: string; getIdToken: () => Promise<string> } } }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: sdk.auth }));
vi.mock("@/components/ui/InAppSelect", () => ({ default: ({ ariaLabel, value, onChange, options, disabled }: {
  ariaLabel: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; disabled: boolean;
}) => <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
  {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
</select> }));
const route: RouteData = { id: "qa-route", name: "QA route", color: "#3B82F6", waypoints: [], stops: [
  { id: "alpha", name: "Alpha", shortName: "A", lat: 23, lng: 72 },
  { id: "beta", name: "Beta", shortName: "B", lat: 23.01, lng: 72.01 },
] };
type GPS = { success: PositionCallback; failure: PositionErrorCallback };
let callbacks: GPS[];
let gps: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); callbacks = []; sdk.token.mockReset().mockResolvedValue("test-token");
  sdk.auth.currentUser = { uid: "qa-passenger", getIdToken: sdk.token };
  vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://qa.ngrok-free.dev");
  gps = vi.fn((success: PositionCallback, failure: PositionErrorCallback) => callbacks.push({ success, failure }));
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: gps } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function flush() { await act(async () => { await Promise.resolve(); }); }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function fix(index = 0) {
  callbacks[index].success({ coords: { latitude: 23, longitude: 72, accuracy: 10 } } as GeolocationPosition);
}
function prepare() {
  const joined = vi.fn();
  const view = render(<PassengerBoardingView sessionId="qa-session" route={route} tripState="in_service" onJoined={joined} />);
  fireEvent.change(screen.getByLabelText("Boarding stop"), { target: { value: "alpha" } });
  fireEvent.change(screen.getByLabelText("Destination station"), { target: { value: "beta" } });
  fireEvent.change(screen.getByLabelText("Boarding code"), { target: { value: "ABCDEFGH" } });
  const board = () => fireEvent.click(screen.getByRole("button", { name: "Board" }));
  return { ...view, joined, board };
}
function delayedFetch(ms: number) {
  const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response('{"joined":true}')), ms);
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    if (options.signal?.aborted) abort(); else options.signal?.addEventListener("abort", abort, { once: true });
  }));
  vi.stubGlobal("fetch", fetchMock); return fetchMock;
}

describe("boarding preparation and API budgets", () => {
  it("leaves a full network budget after nine seconds of GPS acquisition", async () => {
    const fetchMock = delayedFetch(9_000); const view = prepare(); view.board();
    await advance(9_000); expect(fetchMock).not.toHaveBeenCalled();
    act(() => fix()); await flush(); expect(fetchMock).toHaveBeenCalledOnce();
    await advance(9_000);
    expect(view.joined).toHaveBeenCalledOnce(); expect(screen.queryByRole("alert")).toBeNull();
  });

  it("starts the ten-second API timeout only after token and location preparation", async () => {
    const fetchMock = delayedFetch(20_000); const view = prepare(); view.board();
    await advance(9_000); act(() => fix()); await flush();
    await advance(9_999); expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(false);
    await advance(1); expect(screen.getByRole("alert").textContent).toContain("boarding request timed out");
    expect(view.joined).not.toHaveBeenCalled();
  });

  it.each([[1, "Location access is required"], [2, "Location is unavailable"], [3, "Location acquisition timed out"]])("distinguishes geolocation failure %s before any API call", async (code, expected) => {
    const fetchMock = delayedFetch(1); const view = prepare(); view.board();
    act(() => callbacks[0].failure({ code } as GeolocationPositionError)); await flush();
    expect(screen.getByRole("alert").textContent).toContain(expected);
    expect(fetchMock).not.toHaveBeenCalled(); expect(view.joined).not.toHaveBeenCalled();
  });

  it("does not start a request when GPS completes after unmount", async () => {
    const fetchMock = delayedFetch(1); const view = prepare(); view.board(); view.unmount();
    act(() => fix()); await flush();
    expect(fetchMock).not.toHaveBeenCalled(); expect(view.joined).not.toHaveBeenCalled();
  });

  it("fences a former session's preparation and lets the new session board", async () => {
    const fetchMock = delayedFetch(1); const view = prepare(); view.board();
    view.rerender(<PassengerBoardingView sessionId="qa-next-session" route={route} tripState="in_service" onJoined={view.joined} />);
    act(() => fix()); await flush(); expect(fetchMock).not.toHaveBeenCalled();
    view.board(); act(() => fix(1)); await flush(); await advance(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/qa-next-session/join"); expect(view.joined).toHaveBeenCalledOnce();
  });

  it("ignores an old HTTP acknowledgement after the session changes", async () => {
    let acknowledge: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { acknowledge = resolve; })));
    const view = prepare(); view.board(); act(() => fix()); await flush();
    view.rerender(<PassengerBoardingView sessionId="qa-next-session" route={route} tripState="in_service" onJoined={view.joined} />);
    await act(async () => acknowledge(new Response('{"joined":true}')));
    expect(view.joined).not.toHaveBeenCalled(); expect(screen.queryByText("On board")).toBeNull();
  });

  it("coalesces two clicks in the same render before acquiring location", async () => {
    delayedFetch(1); prepare(); const button = screen.getByRole("button", { name: "Board" });
    act(() => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(gps).toHaveBeenCalledOnce(); expect(sdk.token).toHaveBeenCalledOnce();
  });

  it("bounds token preparation separately and never spends the network budget", async () => {
    sdk.token.mockImplementation(() => new Promise(() => {}));
    const fetchMock = delayedFetch(1); const view = prepare(); view.board(); act(() => fix());
    await advance(10_000); expect(screen.getByRole("alert").textContent).toContain("Sign-in verification timed out");
    expect(fetchMock).not.toHaveBeenCalled(); expect(view.joined).not.toHaveBeenCalled();
  });

  it("leaves the network budget intact when token acquisition takes nine seconds", async () => {
    sdk.token.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve("test-token"), 9_000)));
    const fetchMock = delayedFetch(9_000); const view = prepare(); view.board(); act(() => fix());
    await advance(9_000); expect(fetchMock).toHaveBeenCalledOnce(); await advance(9_000);
    expect(view.joined).toHaveBeenCalledOnce();
  });

  it("bounds a GPS callback that never settles, with no HTTP request", async () => {
    const fetchMock = delayedFetch(1); prepare().board(); await advance(10_000);
    expect(screen.getByRole("alert").textContent).toContain("Location acquisition timed out");
    act(() => fix()); await flush(); expect(fetchMock).not.toHaveBeenCalled();
  });

  it("discards token completion after unmount", async () => {
    let tokenReady: (token: string) => void = () => {};
    sdk.token.mockImplementation(() => new Promise(resolve => { tokenReady = resolve; }));
    const fetchMock = delayedFetch(1); const view = prepare(); view.board(); act(() => fix()); view.unmount();
    act(() => tokenReady("test-token")); await flush(); expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows an existing passenger's stop correction without GPS and requires GPS in a different session", async () => {
    const fetchMock = delayedFetch(1); const view = prepare(); view.board(); act(() => fix()); await flush(); await advance(1);
    fireEvent.change(screen.getByLabelText("Destination station"), { target: { value: "alpha" } }); view.board();
    await flush(); await advance(1); expect(gps).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).not.toHaveProperty("lat");
    view.rerender(<PassengerBoardingView sessionId="qa-next-session" route={route} tripState="in_service" onJoined={view.joined} />);
    view.board(); expect(gps).toHaveBeenCalledTimes(2);
  });

  it.each(["principal", "verification"])("fences preparation when the same UID changes %s", async change => {
    const fetchMock = delayedFetch(1); const view = prepare(); view.board();
    if (change === "principal") sdk.auth.currentUser = { uid: "qa-passenger", getIdToken: sdk.token };
    else beginAuthVerification();
    act(() => fix()); await flush();
    expect(fetchMock).not.toHaveBeenCalled(); expect(view.joined).not.toHaveBeenCalled();
  });

  it.each(["principal", "verification"])("fences an HTTP acknowledgement when the same UID changes %s", async change => {
    let acknowledge: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { acknowledge = resolve; })));
    const view = prepare(); view.board(); act(() => fix()); await flush();
    if (change === "principal") sdk.auth.currentUser = { uid: "qa-passenger", getIdToken: sdk.token };
    else beginAuthVerification();
    await act(async () => acknowledge(new Response('{"joined":true}')));
    expect(view.joined).not.toHaveBeenCalled(); expect(screen.queryByText("On board")).toBeNull();
  });

  it("ignores late preparation failures after a session change", async () => {
    let tokenFailure: (error: Error) => void = () => {};
    sdk.token.mockImplementationOnce(() => new Promise((_resolve, reject) => { tokenFailure = reject; }));
    const fetchMock = delayedFetch(1); const view = prepare(); view.board();
    view.rerender(<PassengerBoardingView sessionId="qa-next-session" route={route} tripState="in_service" onJoined={view.joined} />);
    act(() => { tokenFailure(new Error("old token failed")); callbacks[0].failure({ code: 3 } as GeolocationPositionError); });
    await flush(); expect(screen.queryByRole("alert")).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
    view.board(); act(() => fix(1)); await flush(); await advance(1); expect(view.joined).toHaveBeenCalledOnce();
  });
});
