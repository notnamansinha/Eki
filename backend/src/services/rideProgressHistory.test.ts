import { describe, expect, it } from "vitest";
import { missingStopHistory } from "./rideProgressHistory";

const natural = Array.from({ length: 5 }, (_, index) => ({ id: `s${index}`, name: `Stop ${index}` }));

describe("durable stop history", () => {
  it.each([natural, [...natural].reverse()].map(stops => ({ stops })))("keeps every crossed stop in travel order", ({ stops }) => {
    const existing = { 0: { stopName: "Original origin name", timestamp: 10 } };
    const additions = missingStopHistory(stops, "in_service", 4, existing, 20, 1);
    expect(Object.keys(additions)).toEqual(["1", "2", "3"]);
    expect(Object.values(additions).map(stop => stop.stopId)).toEqual(stops.slice(1, 4).map(stop => stop.id));
    expect(existing[0]).toEqual({ stopName: "Original origin name", timestamp: 10 });
    expect(additions[4]).toBeUndefined();
  });

  it("includes the terminal stop at completion and preserves prior timestamps", () => {
    const old = { 0: { timestamp: 10 }, 1: { timestamp: 15 } };
    const additions = missingStopHistory(natural, "completed", 4, old, 30, 2);
    expect(Object.keys(additions)).toEqual(["2", "3", "4"]);
    expect(Object.values(additions).every(stop => stop.timestamp === 30)).toBe(true);
  });

  it("repairs a recovered checkpoint and labels its timing as recovery evidence", () => {
    const additions = missingStopHistory(natural, "in_service", 3, {}, 100);
    expect(Object.keys(additions)).toEqual(["0", "1", "2"]);
    expect(additions[2].evidence).toBe("recovered_checkpoint");
    expect(missingStopHistory(natural, "in_service", 3, additions, 200)).toEqual({});
  });

  it("labels stops skipped during a GNSS gap separately from the stop actually reached", () => {
    const additions = missingStopHistory(natural, "in_service", 4, { 0: { timestamp: 10 } }, 50, 1, [1, 2]);
    expect(Object.values(additions).map(stop => stop.evidence)).toEqual(["skipped_gnss_gap", "skipped_gnss_gap", "gnss_progress"]);
  });

  it.each(["pre_departure", "unknown"])("does not invent arrivals for %s", state => {
    expect(missingStopHistory(natural, state, 0, {}, 100)).toEqual({});
  });

  it.each([-1, Number.NaN, 0.5, 5])("rejects invalid checkpoint %s", index => {
    expect(missingStopHistory(natural, "completed", index, {}, 100)).toEqual({});
  });
});
