import { describe, expect, it } from "vitest";
import { LruCache } from "./lruCache";

describe("LruCache", () => {
  it("evicts the least-recently-set key once maxSize is exceeded", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1).set("b", 2).set("c", 3);

    expect(cache.size).toBe(2);
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });

  it("treats reads and overwrites as uses when evicting", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1).set("b", 2);

    // Reading "a" makes it most-recent, so the next insert evicts "b".
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.has("b")).toBe(false);
    expect(cache.get("a")).toBe(1);

    // Overwriting "a" refreshes its recency, so "c" is evicted next.
    cache.set("a", 10).set("d", 4);
    expect(cache.has("c")).toBe(false);
    expect(cache.get("a")).toBe(10);
  });

  it("reports evicted entries to the onEvict hook with their key and value", () => {
    const evicted: Array<[string, number]> = [];
    const cache = new LruCache<string, number>(1, (key, value) => {
      evicted.push([key, value]);
    });

    cache.set("a", 1);
    cache.set("b", 2);

    expect(evicted).toEqual([["a", 1]]);
    expect(cache.get("b")).toBe(2);
  });

  it("keeps a key resident when it is refreshed within the window", () => {
    const cache = new LruCache<string, number>(3);
    cache.set("a", 1).set("b", 2).set("c", 3);
    cache.set("a", 1).set("d", 4);

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  it("supports delete and clear", () => {
    const cache = new LruCache<string, number>(10);
    cache.set("a", 1).set("b", 2);

    expect(cache.delete("a")).toBe(true);
    expect(cache.delete("missing")).toBe(false);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("iterates values in recency order", () => {
    const cache = new LruCache<string, number>(10);
    cache.set("a", 1).set("b", 2).set("c", 3);
    cache.get("a");

    expect(Array.from(cache.values())).toEqual([2, 3, 1]);
  });

  it("rejects non-positive max sizes", () => {
    expect(() => new LruCache<string, number>(0)).toThrow(RangeError);
    expect(() => new LruCache<string, number>(1.5)).toThrow(RangeError);
    expect(() => new LruCache<string, number>(Number.NaN)).toThrow(RangeError);
  });
});
