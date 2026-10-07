import { describe, expect, it } from "vitest";
import { readRerouteRetry, rerouteBackoffMs, RerouteProviderCircuit } from "./rerouteRetry";

describe("reroute retry policy", () => {
  it("grows exponentially with jitter and caps at five minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 32].map(n => rerouteBackoffMs(n, 1)))
      .toEqual([10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
    expect(rerouteBackoffMs(1, 0)).toBe(5_000);
    expect(rerouteBackoffMs(32, 0)).toBe(150_000);
    expect(rerouteBackoffMs(4, 0.5)).toBe(60_000);
  });
  it("does not inherit another session, direction or route's retry budget", () => {
    const retry = { context: "s1-forward-v1", failures: 3, nextAttemptAt: 40_000 };
    expect(readRerouteRetry(retry, retry.context)).toEqual(retry);
    for (const context of ["s2-forward-v1", "s1-reverse-v1", "s1-forward-v2"]) {
      expect(readRerouteRetry(retry, context)).toBeNull();
    }
    for (const value of [null, {}, { ...retry, failures: Infinity }, { ...retry, nextAttemptAt: NaN }]) {
      expect(readRerouteRetry(value, retry.context)).toBeNull();
    }
  });
});

describe("reroute provider circuit", () => {
  it("opens after five failures, permits only one recovery probe and resets after success", () => {
    let now = 0;
    const circuit = new RerouteProviderCircuit(() => now, () => 1);
    for (let n = 0; n < 5; n++) circuit.acquire()!(false);
    expect(circuit.acquire()).toBeNull();
    expect(circuit.snapshot().retryAfterMs).toBe(60_000);
    now = 60_000;
    const probe = circuit.acquire()!;
    expect(circuit.acquire()).toBeNull();
    probe(true);
    expect(circuit.snapshot()).toMatchObject({ failures: 0, retryAfterMs: 0, probing: false });
    expect(circuit.acquire()).toBeTypeOf("function");
  });
  it("backs off failed probes up to five minutes and does not count cancelled claims", () => {
    let now = 0;
    const circuit = new RerouteProviderCircuit(() => now, () => 1);
    circuit.acquire()!();
    expect(circuit.snapshot().failures).toBe(0);
    for (let n = 0; n < 5; n++) circuit.acquire()!(false);
    for (const delay of [120_000, 240_000, 300_000, 300_000]) {
      now += circuit.snapshot().retryAfterMs;
      circuit.acquire()!(false);
      expect(circuit.snapshot().retryAfterMs).toBe(delay);
    }
    now += 300_000;
    circuit.acquire()!();
    expect(circuit.acquire()).toBeTypeOf("function");
  });
  it("ignores late pre-open results and double settlement", () => {
    const circuit = new RerouteProviderCircuit(() => 0, () => 1);
    const old = circuit.acquire()!;
    for (let n = 0; n < 5; n++) circuit.acquire()!(false);
    old(true); old(false);
    expect(circuit.snapshot().retryAfterMs).toBe(60_000);
    expect(circuit.snapshot().failures).toBe(5);
  });
});
