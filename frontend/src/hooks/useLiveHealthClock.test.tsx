// @vitest-environment jsdom
// Adversarial probes for the deadline clock: loops, leaks, resume, skew.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useMemo } from "react";
import { useLiveHealthClock } from "./useLiveHealthClock";
import { liveBusHealth, type LiveBusHealthInput } from "@/lib/liveBusHealth";
import { LIVE_DELAYED_MS, SIGNAL_LOST_MS, BUS_EXPIRY_MS } from "@/lib/liveBusFreshness";
import { setServerTimeOffset } from "@/lib/serverClock";

afterEach(() => { cleanup(); vi.useRealTimers(); setServerTimeOffset(0); });

let renders = 0;
const seen: string[] = [];
function Probe({ buses }: { buses: LiveBusHealthInput[] }) {
  const list = useMemo(() => buses, [buses]);
  useLiveHealthClock(list);
  renders++;
  const state = list.map(bus => liveBusHealth(bus).state).join(",");
  if (seen.at(-1) !== state) seen.push(state);
  return <div data-testid="state">{state}</div>;
}
const fresh = (extra: Record<string, unknown> = {}) => ({ deviceState: "online", motionState: "moving", timestamp: Date.now(), backendReceivedAt: Date.now(), ...extra });

describe("useLiveHealthClock", () => {
  it("flips exactly at each threshold, without a tight loop, for 10 minutes of silence", async () => {
    vi.useFakeTimers(); renders = 0; seen.length = 0;
    const view = render(<Probe buses={[fresh()]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_DELAYED_MS + 10); });
    expect(view.getByTestId("state").textContent).toBe("delayed");
    await act(async () => { await vi.advanceTimersByTimeAsync(SIGNAL_LOST_MS - LIVE_DELAYED_MS); });
    expect(view.getByTestId("state").textContent).toBe("lost");
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
    // 5 s degraded refresh => ~125 renders in 10.5 min; anything far above is a loop.
    expect(renders).toBeLessThan(200);
    expect(seen).toEqual(["live", "delayed", "lost"]);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a fresh packet resets the deadline (a 1 Hz bus never reaches 'delayed')", async () => {
    vi.useFakeTimers(); seen.length = 0;
    const view = render(<Probe buses={[fresh()]} />);
    for (let i = 0; i < 120; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      view.rerender(<Probe buses={[fresh()]} />);
    }
    expect(seen).toEqual(["live"]);
  });

  it("re-arms after the tab was hidden and the browser dropped/throttled the timer", async () => {
    vi.useFakeTimers();
    const view = render(<Probe buses={[fresh()]} />);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.clearAllTimers(); // simulate the OS suspending the page's timers
    vi.setSystemTime(Date.now() + SIGNAL_LOST_MS + 5_000);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(view.getByTestId("state").textContent).toBe("lost");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("a multi-bus list arms on the earliest deadline (one live, one about to go delayed)", async () => {
    vi.useFakeTimers();
    const old = { ...fresh(), timestamp: Date.now() - (LIVE_DELAYED_MS - 1_000), backendReceivedAt: Date.now() - (LIVE_DELAYED_MS - 1_000) };
    const view = render(<Probe buses={[fresh(), old]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_050); });
    expect(view.getByTestId("state").textContent).toBe("live,delayed");
  });

  it("an offline or timestamp-less bus does not spin", async () => {
    vi.useFakeTimers(); renders = 0;
    render(<Probe buses={[{ deviceState: "offline" }, { deviceState: "online" }, fresh({ timestamp: Date.now() - BUS_EXPIRY_MS - 1, backendReceivedAt: undefined })]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(renders).toBeLessThan(20);
  });

  it("a server-offset correction during silence is reflected within one degraded tick", async () => {
    vi.useFakeTimers();
    // The viewer clock is 40 s slow; receipts are server time; offset not yet known.
    const serverReceipt = Date.now() + 40_000;
    const view = render(<Probe buses={[fresh({ timestamp: serverReceipt, backendReceivedAt: serverReceipt })]} />);
    expect(view.getByTestId("state").textContent).toBe("lost");
    setServerTimeOffset(40_000);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });
    expect(view.getByTestId("state").textContent).toBe("live");
  });
});
