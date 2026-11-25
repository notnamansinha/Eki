// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeedbackPanel from "./FeedbackPanel";
const fixtures = vi.hoisted(() => ({
  entry: { id: "qa-feedback", userId: "qa-passenger", userName: "QA Passenger", type: "general", rating: null, busId: null, driverId: null, sessionId: null, comment: "Please improve the route card", timestamp: null, status: "new" },
  user: { uid: "admin", role: "admin" } as { uid: string; role: string } | null,
  loading: false, generation: 0, auth: { currentUser: { uid: "admin", getIdToken: async () => "test-token" } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: fixtures.user, loading: fixtures.loading }) }));
vi.mock("@/hooks/useBuses", () => ({ useBuses: () => ({ buses: [] }) }));
vi.mock("@/hooks/useDrivers", () => ({ useDrivers: () => ({ drivers: [] }) }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: fixtures.auth }));
vi.mock("@/lib/authState", () => ({ getAuthVerificationGeneration: () => fixtures.generation }));
const store = vi.hoisted(() => ({ loadFeedback: vi.fn(), updateFeedbackStatus: vi.fn() }));
vi.mock("@/lib/feedbackStore", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/feedbackStore")>(), ...store,
}));
vi.mock("@/lib/firebaseFirestore", () => ({ db: {} }));
const listResponse = () => [fixtures.entry];
beforeEach(() => {
  fixtures.user = { uid: "admin", role: "admin" }; fixtures.loading = false; fixtures.generation = 0; fixtures.auth.currentUser.uid = "admin";
  vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "");
  store.loadFeedback.mockReset().mockImplementation(async () => listResponse());
  store.updateFeedbackStatus.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {}); vi.stubGlobal("fetch", vi.fn(async () => listResponse()));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function expand() { const user = userEvent.setup(); await user.click(await screen.findByRole("button", { expanded: false })); return user; }
describe("admin feedback Firestore workflow", () => {
  it("titles the standalone console with a real page heading", async () => {
    render(<FeedbackPanel />); await screen.findByText("QA Passenger");
    expect(screen.getByRole("heading", { level: 1, name: "Feedback Console" })).toBeTruthy();
  });
  it.each([false, true])("loads with no backend URL or tunnel (embedded=%s)", async embedded => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Tunnel offline"); }));
    render(<FeedbackPanel embedded={embedded} />); await screen.findByText("QA Passenger");
    expect(store.loadFeedback).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it("updates status only after Firestore acknowledges the write", async () => {
    let resolve!: () => void;
    store.updateFeedbackStatus.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    render(<FeedbackPanel />); const user = await expand();
    expect(screen.queryByRole("button", { name: "new" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "reviewed" }));
    expect(store.updateFeedbackStatus).toHaveBeenCalledWith("admin", "qa-feedback", "reviewed");
    expect((screen.getByRole("button", { name: "resolved" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve());
    expect((screen.getByRole("button", { name: "resolved" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("restarts pending reads when the same account is verified again", async () => {
    let resolve!: (entries: typeof fixtures.entry[]) => void;
    store.loadFeedback.mockImplementationOnce(() => new Promise(done => { resolve = done; }))
      .mockResolvedValueOnce([{ ...fixtures.entry, userName: "Fresh session" }]);
    const view = render(<FeedbackPanel />); await waitFor(() => expect(store.loadFeedback).toHaveBeenCalledOnce());
    fixtures.generation++; view.rerender(<FeedbackPanel />); await screen.findByText("Fresh session");
    await act(async () => resolve(listResponse())); expect(screen.queryByText("QA Passenger")).toBeNull();
  });
  it("ignores an old status failure while a new-session write remains pending", async () => {
    let rejectOld!: (error: Error) => void; let resolveNew!: () => void;
    store.updateFeedbackStatus.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise<void>(resolve => { resolveNew = resolve; }));
    const view = render(<FeedbackPanel />); let user = await expand();
    await user.click(screen.getByRole("button", { name: "reviewed" }));
    fixtures.generation++; view.rerender(<FeedbackPanel />); await screen.findByRole("button", { expanded: false });
    user = await expand(); await user.click(screen.getByRole("button", { name: "resolved" }));
    await act(async () => rejectOld(new Error("Old session failure")));
    expect(screen.queryByText("Old session failure")).toBeNull();
    expect((screen.getByRole("button", { name: "reviewed" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolveNew());
    expect((screen.getByRole("button", { name: "reviewed" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("does not apply a late status success after verification closes before React cleanup", async () => {
    let resolve!: () => void;
    store.updateFeedbackStatus.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    render(<FeedbackPanel />); const user = await expand();
    await user.click(screen.getByRole("button", { name: "reviewed" })); fixtures.generation++;
    await act(async () => resolve());
    if (screen.queryByRole("button", { expanded: false })) await expand();
    expect((screen.getByRole("button", { name: "reviewed" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("surfaces Firestore denial and reloads on retry", async () => {
    store.loadFeedback.mockRejectedValueOnce({ code: "permission-denied" });
    render(<FeedbackPanel />); await screen.findByText(/Feedback access was denied/);
    await userEvent.setup().click(screen.getByRole("button", { name: /retry/i })); await screen.findByText("QA Passenger");
    expect(store.loadFeedback).toHaveBeenCalledTimes(2);
  });
  it("keeps the old status and displays a denied write", async () => {
    store.updateFeedbackStatus.mockRejectedValueOnce({ code: "permission-denied" });
    render(<FeedbackPanel />); const user = await expand(); await user.click(screen.getByRole("button", { name: "resolved" }));
    await screen.findByText(/Feedback access was denied/);
    expect((screen.getByRole("button", { name: "reviewed" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("filters by type, status and search and restores results with Reset", async () => {
    render(<FeedbackPanel />); await screen.findByText("QA Passenger"); const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Feedback type"), "ride"); expect(screen.queryByRole("button", { expanded: false })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Reset" })); expect(screen.getByRole("button", { expanded: false })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Feedback status"), "resolved"); expect(screen.queryByRole("button", { expanded: false })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Reset" })); await user.type(screen.getByLabelText("Search feedback"), "missing passenger");
    expect(screen.queryByRole("button", { expanded: false })).toBeNull(); await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("button", { expanded: false })).toBeTruthy();
  });
  it("does not fetch before role verification", async () => {
    fixtures.loading = true; const view = render(<FeedbackPanel />); await Promise.resolve(); expect(store.loadFeedback).not.toHaveBeenCalled();
    fixtures.loading = false; view.rerender(<FeedbackPanel />); await screen.findByText("QA Passenger");
  });
  it("hides old-account data on sign-out", async () => {
    const view = render(<FeedbackPanel />); await screen.findByText("QA Passenger");
    fixtures.user = null; view.rerender(<FeedbackPanel />); expect(screen.queryByText("QA Passenger")).toBeNull();
  });
  it("ignores late data after sign-out", async () => {
    let resolve!: (entries: typeof fixtures.entry[]) => void;
    store.loadFeedback.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = render(<FeedbackPanel />); await waitFor(() => expect(store.loadFeedback).toHaveBeenCalledOnce());
    fixtures.user = null; view.rerender(<FeedbackPanel />);
    await act(async () => resolve(listResponse())); expect(screen.queryByText("QA Passenger")).toBeNull();
  });
});
