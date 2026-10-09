// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RideHistoryPanel from "./RideHistoryPanel";
const state = vi.hoisted(() => ({ sessions: [{ id: "qa-session", busId: "qa-bus", driverId: "qa-driver", routeId: "qa-route", status: "completed", armedAt: 1_750_000_000_000, startTime: 1_750_000_001_000, endTime: 1_750_000_600_000, passengers: [] as {userId: string; userName: string; boardingStopId: string; alightingStopId: string | null; joinedAt: number}[], stopsReached: [] }], error: null as string | null, retry: vi.fn() }));
vi.mock("@/hooks/useCollection", () => ({ useCollection: () => ({ data: state.sessions, loading: false, error: state.error, retry: state.retry }) }));
vi.mock("@/hooks/useBuses", () => ({ useBuses: () => ({ buses: [{ id: "qa-bus", name: "QA Bus" }], loading: false }) }));
vi.mock("@/hooks/useDrivers", () => ({ useDrivers: () => ({ drivers: [{ id: "qa-driver", name: "QA Driver" }], loading: false }) }));
vi.mock("@/hooks/useRoutes", () => ({ useRoutes: () => ({ routes: [{ id: "qa-route", name: "QA route", stops: [{ id: "origin", name: "Origin" }, { id: "destination", name: "Destination" }] }], loading: false }) }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: { currentUser: { getIdToken: async () => "test-token" } } }));
beforeEach(() => { state.sessions[0].status = "completed"; state.sessions[0].passengers = []; state.error = null; state.retry.mockClear(); vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://qa.ngrok-free.dev"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function openConfirmation() {
  const user = userEvent.setup(); render(<RideHistoryPanel />);
  await user.click(screen.getByRole("button", { expanded: false }));
  await user.click(screen.getByRole("button", { name: "Delete ride history" }));
  return user;
}
describe("ride-history controls", () => {
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
  it("exposes a read failure and retries both bounded history queries", async () => {
    state.error = "History unavailable"; render(<RideHistoryPanel />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(state.retry).toHaveBeenCalledTimes(2);
  });
});
