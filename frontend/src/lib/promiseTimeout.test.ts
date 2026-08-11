import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "./promiseTimeout";

describe("withTimeout", () => {
  afterEach(() => vi.useRealTimers());

  it("returns a result and clears its deadline", async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve("verified"), 10_000, "timeout"))
      .resolves.toBe("verified");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a verification that never settles", async () => {
    vi.useFakeTimers();
    const verification = withTimeout(new Promise<never>(() => {}), 10_000, "verification timed out");
    const rejection = expect(verification).rejects.toThrow("verification timed out");
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });
});
