import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiReadCache } from "./apiReadCache";
afterEach(() => vi.useRealTimers());
describe("authenticated API read work cache", () => {
  it("coalesces a burst, then expires successful results without caching failures", async () => {
    const cache = createApiReadCache<number>("test", 1000, 2); const load = vi.fn(async () => 1);
    expect(await Promise.all(Array.from({ length: 32 }, () => cache.read("page", load)))).toEqual(Array(32).fill(1));
    expect(load).toHaveBeenCalledTimes(1);
    await cache.read("page", load); expect(load).toHaveBeenCalledTimes(1);
    cache.invalidate(); await cache.read("page", load); expect(load).toHaveBeenCalledTimes(2);
    await expect(cache.read("fail", async () => { throw Error("dependency"); })).rejects.toThrow("dependency");
    expect(await cache.read("fail", async () => 2)).toBe(2);
    const clock = vi.spyOn(performance, "now").mockReturnValue(performance.now() + 2000);
    await cache.read("page", load); expect(load).toHaveBeenCalledTimes(3); clock.mockRestore();
  });
  it("rejects an in-flight invalidated result and never repopulates a stale catalog", async () => {
    const cache = createApiReadCache<number>("test", 1000);
    let finish!: (value: number) => void;
    const pending = cache.read("page", () => new Promise<number>(resolve => { finish = resolve; }));
    const rejected = expect(pending).rejects.toThrow(); await Promise.resolve();
    cache.invalidate(); finish(1); await rejected;
    expect(cache.snapshot().cached).toBe(0);
    expect(await cache.read("page", async () => 2)).toBe(2);
  });
  it("bounds pages and retained payloads independently and leaves uncached lookups fresh", async () => {
    const cache = createApiReadCache<string>("test", 1000, 2);
    for (const key of ["a", "b", "c"]) await cache.read(key, async () => key);
    expect(cache.snapshot().cached).toBe(2);
    await cache.read("large", async () => "x".repeat(300_000)); expect(cache.snapshot().cached).toBe(2);
    const fresh = createApiReadCache<number>("test", 0); let n = 0;
    expect(await fresh.read("bus", async () => ++n)).toBe(1); expect(await fresh.read("bus", async () => ++n)).toBe(2);
  });
  it("retains a stalled dependency slot after caller timeout and caps distinct fills", async () => {
    vi.useFakeTimers();
    const cache = createApiReadCache<number>("test", 0); const work = () => new Promise<number>(() => {});
    const waiting = Array.from({ length: 8 }, (_, i) => cache.read(String(i), work).catch(error => error));
    await expect(cache.read("overflow", work)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3000); await Promise.all(waiting);
    expect(cache.snapshot()).toMatchObject({ activeFills: 8, waitingCallers: 0, cached: 0 });
    await expect(cache.read("overflow", work)).rejects.toThrow();
  });
});
