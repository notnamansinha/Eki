// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessagingPanel from "./MessagingPanel";

const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: "qa-passenger", getIdToken: vi.fn(async () => "test-token") } },
  listen: vi.fn(), trace: vi.fn(),
}));
vi.mock("@/lib/firebaseAuth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/firebaseFirestore", () => ({ db: {} }));
vi.mock("@/lib/authState", () => ({ waitForAuth: async () => {} }));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(), query: vi.fn(), orderBy: vi.fn(), limitToLast: vi.fn(),
  onSnapshot: mocks.listen, Timestamp: class {},
}));
vi.mock("@/lib/telemetryTrace", () => ({
  beginMessageWriteTrace: () => 42, recordMessageWriteTrace: mocks.trace,
  recordMessageListenerTrace: vi.fn(), recordRealtimePayload: vi.fn(),
  recordRealtimeWatch: vi.fn(), telemetryTraceEnabled: () => false,
}));
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://qa.ngrok-free.dev");
  mocks.listen.mockReset().mockReturnValue(vi.fn());
  mocks.trace.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function panel(extra = {}) {
  return render(<MessagingPanel sessionId="qa-session" currentUserRole="passenger" currentUserId="qa-passenger" {...extra} />);
}
async function send(user = userEvent.setup()) {
  await user.type(screen.getByRole("textbox", { name: "Chat message" }), "Please wait at Alpha.");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  return user;
}
describe("ride chat user workflows", () => {
  it("distinguishes an administrator from an operator in received messages", async () => {
    panel();
    await waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce());
    act(() => mocks.listen.mock.calls[0][2]({
      docs: [
        { id: "admin-message", data: () => ({ from: "admin", senderId: "admin", senderName: "Campus Team", text: "Service update" }) },
        { id: "driver-message", data: () => ({ from: "driver", senderId: "driver", senderName: "Campus Driver", text: "At origin" }) },
      ], metadata: { fromCache: false },
    }));
    expect(screen.getByText("Administrator").parentElement?.textContent).toContain("Campus Team");
    expect(screen.getByText("Operator").parentElement?.textContent).toContain("Campus Driver");
  });
  it.each(["<html>proxy warning</html>", "null", "{}"])("preserves the draft on an invalid success acknowledgement: %s", async body => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    panel(); await send();
    expect(await screen.findByText("Message could not be sent. Please try again.")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Please wait at Alpha.");
  });
  it("retries an uncertain send with the same ID and records the server message ID and duplicate HTTP status", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("lost response"))
      .mockResolvedValueOnce(new Response('{"id":"qa-message","moderated":true}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    panel(); const user = await send();
    await screen.findByText("Message could not be sent. Please try again.");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("Unsafe language was filtered before sending.");
    const requests = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(requests[0].requestId).toBe(requests[1].requestId);
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get("ngrok-skip-browser-warning")).toBe("1");
    expect(mocks.trace).toHaveBeenCalledWith("qa-session", "qa-message", 42, 200);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });
  it("blocks double sends while a request is in flight", async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock); panel(); const user = await send();
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => finish(new Response('{"id":"qa-message"}', { status: 201 })));
  });
  it("disables sending while a ride is unavailable", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    panel({ unavailableMessage: "Ride is closed." });
    expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("reconnects a failed read when Retry is clicked and unsubscribes the previous listener", async () => {
    const stop = vi.fn(); mocks.listen.mockReturnValue(stop); panel();
    await waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce());
    act(() => mocks.listen.mock.calls[0][3](new Error("permission denied")));
    expect(screen.getByText("Couldn't load messages")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(2));
    expect(stop).toHaveBeenCalledOnce();
  });
});
