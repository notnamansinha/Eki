// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RideHistoryPanel from "./RideHistoryPanel";
const state = vi.hoisted(() => ({ sessions: [{ id: "qa-session", busId: "qa-bus", driverId: "qa-driver", routeId: "qa-route", status: "completed", interruptionReason: undefined as string | undefined, armedAt: 1_750_000_000_000, startTime: 1_750_000_001_000, endTime: 1_750_000_600_000, passengers: [] as {userId: string; userName: string; boardingStopId: string; alightingStopId: string | null; joinedAt: number}[], stopsReached: [] }], error: null as string | null, pendingLimit: null as number | null, retry: vi.fn() }));
vi.mock("@/hooks/useCollection", () => ({ useCollection: (path: string, options: { maxResults: number }) => ({ data: path.endsWith("/archivedMessages") ? [{ id: "archived", senderName: "QA Passenger", text: "Chat retained after live clear", timestamp: 1_750_000_009_000 }] : path.endsWith("/messages") ? [{ id: "kept-message", senderName: "QA Passenger", text: "Stored ride chat", timestamp: 1_750_000_010_000 }] : options.maxResults === state.pendingLimit ? [] : state.sessions.slice(0, options.maxResults), loading: !path.includes("/") && options.maxResults === state.pendingLimit, error: state.error, retry: state.retry }) }));
vi.mock("@/hooks/useBuses", () => ({ useBuses: () => ({ buses: [{ id: "qa-bus", name: "QA Bus" }], loading: false }) }));
vi.mock("@/hooks/useDrivers", () => ({ useDrivers: () => ({ drivers: [{ id: "qa-driver", name: "QA Driver" }], loading: false }) }));
vi.mock("@/hooks/useRoutes", () => ({ useRoutes: () => ({ routes: [{ id: "qa-route", name: "QA route", stops: [{ id: "origin", name: "Origin" }, { id: "destination", name: "Destination" }] }], loading: false }) }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: { currentUser: { getIdToken: async () => "test-token" } } }));
beforeEach(() => { state.pendingLimit = null; state.sessions[0].status = "completed"; state.sessions[0].interruptionReason = undefined; state.sessions[0].passengers = []; state.error = null; state.retry.mockClear(); vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://qa.ngrok-free.dev"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function openConfirmation() {
  const user = userEvent.setup(); render(<RideHistoryPanel />);
  await user.click(screen.getByRole("button", { expanded: false }));
  await user.click(screen.getByRole("button", { name: "Delete ride history" }));
  return user;
}
describe("ride-history controls", () => {
  it.each([
    ["manual_end_early", "Manually ended before the final stop."],
    ["abandoned_session_timeout", "Closed after the ride's inactivity limit was reached."],
    [undefined, "The interruption reason was not recorded."],
    ["unrecognized_future_reason", "The interruption reason is unavailable."],
  ])("shows recorded interruption provenance without inferring a hardware cause: %s", (reason, message) => {
    state.sessions[0].status = "interrupted";
    state.sessions[0].interruptionReason = reason;
    render(<RideHistoryPanel />);
    expect(screen.getByText(message!)).toBeTruthy();
    expect(screen.queryByText(/GPS timeout|phone death|GNSS_TIMEOUT_15M/)).toBeNull();
  });
  it("loads older rides beyond the initial hundred without deleting retained history", async () => {
    const original = state.sessions;
    try {
      state.sessions = Array.from({ length: 101 }, (_, i) => ({ ...original[0], id: `ride-${i}` }));
      const { container } = render(<RideHistoryPanel />);
      // This case measures pagination, not pointer/focus behavior. Avoid three
      // accessibility scans of a hundred rows under the parallel suite's load.
      expect(container.querySelectorAll('button[aria-expanded="false"]')).toHaveLength(100);
      fireEvent.click(screen.getByText("Load older rides"));
      expect(container.querySelectorAll('button[aria-expanded="false"]')).toHaveLength(101);
      expect(screen.queryByText("Load older rides")).toBeNull();
    } finally { state.sessions = original; }
  });
  it("keeps loaded rides on screen while an older page loads", async () => {
    const original = state.sessions;
    try {
      state.sessions = Array.from({ length: 101 }, (_, i) => ({ ...original[0], id: `ride-${i}` }));
      state.pendingLimit = 200;
      const view = render(<RideHistoryPanel />);
      fireEvent.click(screen.getByText("Load older rides"));
      expect(view.container.querySelectorAll('button[aria-expanded="false"]')).toHaveLength(100);
      expect(screen.getByRole("status").textContent).toBe("Loading older rides…");
      state.pendingLimit = null; view.rerender(<RideHistoryPanel />);
      expect(view.container.querySelectorAll('button[aria-expanded="false"]')).toHaveLength(101);
      expect(screen.queryByText("Loading older rides…")).toBeNull();
    } finally { state.sessions = original; }
  });
  it("does not resurface the pre-page snapshot when the larger page later reloads", async () => {
    const original = state.sessions;
    try {
      state.sessions = Array.from({ length: 101 }, (_, i) => ({ ...original[0], id: `ride-${i}` }));
      state.pendingLimit = 200;
      const view = render(<RideHistoryPanel />);
      fireEvent.click(screen.getByText("Load older rides"));
      state.pendingLimit = null; view.rerender(<RideHistoryPanel />);
      state.pendingLimit = 200; view.rerender(<RideHistoryPanel />);
      expect(screen.queryByText("Loading older rides…")).toBeNull();
      expect(view.container.querySelectorAll('button[aria-expanded="false"]')).toHaveLength(0);
    } finally { state.sessions = original; }
  });
  it("shows both persisted stop choices without inventing arrival time", async () => {
    state.sessions[0].passengers = [{ userId: "qa-user", userName: "QA Passenger", boardingStopId: "origin", alightingStopId: "destination", joinedAt: 1_750_000_010_000 }];
    render(<RideHistoryPanel />); await userEvent.setup().click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Boarding stop:").parentElement?.textContent).toBe("Boarding stop: Origin");
    expect(screen.getByText("Arrival stop:").parentElement?.textContent).toBe("Arrival stop: Destination");
    expect(screen.getByText("Destination time not recorded")).toBeTruthy();
  });
  it("expands and collapses stored history without an API write", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); render(<RideHistoryPanel />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Passenger Manifest")).toBeTruthy();
    expect(screen.getByText("Stored ride chat")).toBeTruthy();
    expect(screen.getByText("Chat retained after live clear")).toBeTruthy();
    expect(screen.getByText(/Service armed:/)).toBeTruthy();
    await user.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByText("Passenger Manifest")).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("focuses Cancel, traps focus and restores the initiating button after Escape without deleting", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); const user = await openConfirmation();
    const dialog = screen.getByRole("dialog"); const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Permanently delete" }));
    await user.keyboard("{Escape}"); expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete ride history" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("blocks duplicate delete clicks and keeps confirmation locked until the request resolves", async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal("fetch", fetchMock);
    const user = await openConfirmation(); await user.click(screen.getByRole("button", { name: "Permanently delete" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard("{Escape}"); expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => resolve(new Response('{"deleted":true}', { status: 200 })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Ride history deleted.");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Ride History" }));
  });
  it("keeps the record and error available after a failed delete", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"active ride cannot be deleted"}', { status: 409 })));
    const user = await openConfirmation(); await user.click(screen.getByRole("button", { name: "Permanently delete" }));
    expect(await screen.findByText(/active ride cannot be deleted/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete ride history" })).toBeTruthy();
  });
  it.each([{}, { deleted: false }, null])("keeps history after an unconfirmed successful HTTP response: %j", async body => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    const user = await openConfirmation();
    await user.click(screen.getByRole("button", { name: "Permanently delete" }));
    expect(await screen.findByText(/did not confirm/)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete ride history" })).toBeTruthy();
  });
  it("never offers deletion for a ride in progress", async () => {
    state.sessions[0].status = "active"; render(<RideHistoryPanel />);
    await userEvent.setup().click(screen.getByRole("button", { expanded: false }));
    expect(screen.queryByRole("button", { name: "Delete ride history" })).toBeNull();
  });
  it("labels stops skipped during a GNSS gap and repaired checkpoints instead of showing them as observed arrivals", async () => {
    const original = state.sessions;
    try {
      const t0 = 1_750_000_000_000;
      state.sessions = [{ ...original[0], passengers: [
        { userId: "skipped-rider", userName: "Skipped Rider", boardingStopId: "origin", alightingStopId: "middle", joinedAt: t0 + 30_000 },
        { userId: "repaired-rider", userName: "Repaired Rider", boardingStopId: "origin", alightingStopId: "destination", joinedAt: t0 + 30_000 },
      ], stopsReached: {
        0: { stopIndex: 0, stopId: "origin", stopName: "Origin", timestamp: t0 + 60_000, evidence: "gnss_progress" },
        1: { stopIndex: 1, stopId: "middle", stopName: "Middle", timestamp: t0 + 1_800_000, evidence: "skipped_gnss_gap" },
        2: { stopIndex: 2, stopId: "destination", stopName: "Destination", timestamp: t0 + 1_900_000, evidence: "recovered_checkpoint" },
      } }] as unknown as typeof original;
      render(<RideHistoryPanel />);
      fireEvent.click(screen.getByRole("button", { expanded: false }));
      expect(screen.queryByText("Destination reached")).toBeNull();
      expect(screen.getAllByText("Destination time not recorded")).toHaveLength(2);
      expect(screen.getByText("Skipped (GNSS gap)")).toBeTruthy();
      expect(screen.getByText(/^Recovered \d/)).toBeTruthy();
    } finally { state.sessions = original; }
  });
  it("skips malformed stop and passenger records instead of crashing the history list", () => {
    const original = state.sessions;
    try {
      state.sessions = [{ ...original[0],
        passengers: [null, { userId: "rider", userName: "Rider", boardingStopId: "origin", alightingStopId: "destination", joinedAt: 1_750_000_010_000 }],
        stopsReached: [null, 7, { stopIndex: 1, stopId: "destination", stopName: "Destination", timestamp: 1_750_000_020_000 }],
      }] as unknown as typeof original;
      render(<RideHistoryPanel />);
      fireEvent.click(screen.getByRole("button", { expanded: false }));
      expect(screen.getByText("Rider")).toBeTruthy();
      expect(screen.getByText("Stop 2")).toBeTruthy();
    } finally { state.sessions = original; }
  });
  it("shows non-numeric recorded coordinates as not recorded instead of crashing on expand", () => {
    const original = state.sessions;
    try {
      state.sessions = [{ ...original[0],
        firstKnownLocation: { lat: "23.0", lng: "72.5", sampledAt: 1_750_000_001_000 },
        lastKnownLocation: { lat: null, lng: 72.5, sampledAt: 1_750_000_002_000 },
        connectionEvents: { bad: null, odd: { type: "signal_lost", observedAt: 1_750_000_003_000, location: { lat: {}, lng: 1 } } },
      }] as unknown as typeof original;
      render(<RideHistoryPanel />);
      fireEvent.click(screen.getByRole("button", { expanded: false }));
      expect(screen.getByText(/^First received GNSS: Not recorded/)).toBeTruthy();
      expect(screen.getByText(/^Last received GNSS: Not recorded/)).toBeTruthy();
      expect(screen.getByText(/^Signal lost: .* · Not recorded$/)).toBeTruthy();
    } finally { state.sessions = original; }
  });
  it("exposes a read failure and retries both bounded history queries", async () => {
    state.error = "History unavailable"; render(<RideHistoryPanel />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(state.retry).toHaveBeenCalledTimes(2);
  });
});
