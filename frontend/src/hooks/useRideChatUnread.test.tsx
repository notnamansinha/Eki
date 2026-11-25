// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRideChatUnread } from "./useRideChatUnread";

const mocks = vi.hoisted(() => ({ generation: 0, ready: vi.fn(), listen: vi.fn(), unsubscribe: vi.fn(), watch: vi.fn() }));
vi.mock("@/lib/authState", () => ({ waitForAuth: mocks.ready, getAuthVerificationGeneration: () => mocks.generation }));
vi.mock("@/lib/firebaseFirestore", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path }),
  query: (source: { path: string[] }, ...constraints: unknown[]) => ({ ...source, constraints }),
  orderBy: (field: string, direction: string) => ({ orderBy: [field, direction] }),
  limitToLast: (count: number) => ({ limitToLast: count }),
  onSnapshot: mocks.listen,
}));
vi.mock("@/lib/telemetryTrace", () => ({ recordRealtimeWatch: mocks.watch }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.generation = 0;
  mocks.ready.mockResolvedValue(undefined); mocks.listen.mockReturnValue(mocks.unsubscribe);
});
afterEach(() => { cleanup(); });

const message = (id: string, senderId = "qa-driver") => ({ id, data: () => ({ senderId, text: id }) });
type Props = { sessionId: string; userId: string; open: boolean };
const closed: Props = { sessionId: "qa-session", userId: "qa-passenger", open: false };
async function watch(initialProps = closed) {
  const hook = renderHook((props: Props) => useRideChatUnread(props.sessionId, props.userId, props.open), { initialProps });
  await waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce());
  const deliver = (docs: ReturnType<typeof message>[], fromCache = false, listener = 0) =>
    act(() => mocks.listen.mock.calls[listener][1]({ docs, metadata: { fromCache } }));
  return { hook, deliver };
}

describe("ride chat unread count", () => {
  it("waits for auth, then listens to the chat panel's window of the session", async () => {
    let resolve!: () => void; mocks.ready.mockReturnValue(new Promise<void>(done => { resolve = done; }));
    renderHook(() => useRideChatUnread("qa-session", "qa-passenger", false));
    await act(async () => {});
    expect(mocks.listen).not.toHaveBeenCalled();
    await act(async () => resolve());
    expect(mocks.listen).toHaveBeenCalledOnce();
    expect(mocks.listen.mock.calls[0][0]).toEqual({ path: ["ride_sessions", "qa-session", "messages"],
      constraints: [{ orderBy: ["timestamp", "asc"] }, { limitToLast: 200 }] });
    expect(mocks.watch).toHaveBeenCalledWith("messages", true);
  });
  it("watches nothing without a session or a reader", async () => {
    renderHook(() => useRideChatUnread("", "qa-passenger", false));
    const noReader = renderHook(() => useRideChatUnread("qa-session", "", false));
    await act(async () => {});
    expect(mocks.ready).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(noReader.result.current).toBe(0);
  });
  it("treats history at the first server snapshot as read and counts later messages from others", async () => {
    const { hook, deliver } = await watch();
    const history = [message("d1"), message("d2"), message("p1", "qa-passenger"), message("d3")];
    // A partial cached snapshot must not become the baseline, or the server's
    // older history would then be counted as new.
    deliver(history.slice(2), true);
    deliver(history);
    expect(hook.result.current).toBe(0);
    deliver([...history, message("p2", "qa-passenger")]);
    expect(hook.result.current).toBe(0);
    deliver([...history, message("p2", "qa-passenger"), message("d4"), message("a1", "qa-admin")]);
    expect(hook.result.current).toBe(2);
  });
  it("never counts messages read in the open chat, and opening the chat reads what arrived while closed", async () => {
    const { hook, deliver } = await watch();
    deliver([message("d1")]);
    hook.rerender({ ...closed, open: true });
    deliver([message("d1"), message("p1", "qa-passenger"), message("d2")]);
    expect(hook.result.current).toBe(0);
    hook.rerender(closed);
    expect(hook.result.current).toBe(0);
    deliver([message("d1"), message("p1", "qa-passenger"), message("d2"), message("d3")]);
    expect(hook.result.current).toBe(1);
    hook.rerender({ ...closed, open: true });
    expect(hook.result.current).toBe(0);
    hook.rerender(closed);
    expect(hook.result.current).toBe(0);
  });
  it("reads history that loads while the chat is already open", async () => {
    const { hook, deliver } = await watch({ ...closed, open: true });
    deliver([message("d1")], true);
    deliver([message("d1"), message("d2")]);
    hook.rerender(closed);
    expect(hook.result.current).toBe(0);
  });
  it("counts a new message from others once the chat window is full at 200 messages", async () => {
    const { hook, deliver } = await watch();
    const history = Array.from({ length: 200 }, (_, index) => message(`d${index}`));
    deliver(history);
    deliver([...history.slice(1), message("d200")]);
    expect(hook.result.current).toBe(1);
  });
  it("starts another session at zero and ignores the previous session's listener", async () => {
    const { hook, deliver } = await watch();
    deliver([message("d1")]);
    deliver([message("d1"), message("d2")]);
    expect(hook.result.current).toBe(1);
    hook.rerender({ ...closed, sessionId: "qa-session-2" });
    expect(hook.result.current).toBe(0);
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.watch).toHaveBeenCalledWith("messages", false);
    await waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(2));
    deliver([message("d1"), message("d2"), message("d3")]);
    expect(hook.result.current).toBe(0);
    deliver([message("e1")], false, 1);
    deliver([message("e1"), message("e2")], false, 1);
    expect(hook.result.current).toBe(1);
    hook.rerender({ ...closed, sessionId: "" });
    expect(hook.result.current).toBe(0);
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(2);
  });
  it("ignores snapshots once the auth verification generation changes", async () => {
    const { hook, deliver } = await watch();
    deliver([message("d1")]);
    mocks.generation = 1;
    deliver([message("d1"), message("d2")]);
    expect(hook.result.current).toBe(0);
  });
});
