import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_BOARDING_MS,
  DEMO_FIRST_NEXT_STOP,
  DEMO_RIDE_DURATION_MS,
  DEMO_ROUTE_ID,
  DEMO_SPEED_KMH,
  DEMO_TICK_MS,
  DEMO_TIMELINE,
  boardDemoRide,
  demoRideBus,
  demoRoute,
  isDemoRideEnabled,
  isDemoRouteId,
  resetDemoRideForTests,
  restartDemoRide,
  subscribeDemoRide,
  subscribeDemoRideChanges,
} from "./demoRide";
import { normalizePassengerLiveBus, passengerTripStates } from "./passengerLiveBus";
import { routeInRideDirection } from "./rideDirection";
import { decodePolyline } from "./polyline";
import { busStopArrivalTimestamps } from "./busEta";
import { stopProgress } from "./stopProgress";

afterEach(() => {
  resetDemoRideForTests();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const NOW = Date.UTC(2026, 10, 25, 9, 0, 0);
const frame = (elapsedMs: number, seq = 1) => demoRideBus({ sessionId: "demo-1", elapsedMs, seq, now: NOW });
const phase = (kind: string, index: number) => DEMO_TIMELINE.filter(entry => entry.kind === kind)[index];

describe("demo ride route", () => {
  it("is a forward route with trusted geometry, so the map never asks the backend for it", () => {
    const directed = routeInRideDirection(demoRoute, "forward");
    expect(directed.polylineQuality).toBe("HIGH_QUALITY");
    expect(decodePolyline(directed.polyline!).length).toBeGreaterThan(100);
    expect(demoRoute.stops.map(stop => stop.name)).toEqual([
      "SBI Branch, Thaltej Road", "Thaltej Gam", "Thaltej Char Rasta", "Doordarshan Kendra",
      "Gurukul Road", "Helmet Circle", "Gulbai Tekra", "Ahmedabad University",
    ]);
    expect(isDemoRouteId(DEMO_ROUTE_ID)).toBe(true);
    expect(isDemoRouteId("route-1")).toBe(false);
  });

  it("is hidden unless NEXT_PUBLIC_DEMO_RIDE is true", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_RIDE", undefined);
    expect(isDemoRideEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_DEMO_RIDE", "false");
    expect(isDemoRideEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_DEMO_RIDE", "1");
    expect(isDemoRideEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_DEMO_RIDE", " TRUE ");
    expect(isDemoRideEnabled()).toBe(true);
  });
});

describe("scripted ride", () => {
  it("starts in service with three stops passed, moving towards the fourth", () => {
    const bus = normalizePassengerLiveBus("DEMO_demo-ride", frame(0), NOW);
    expect(bus).toMatchObject({ tripState: "in_service", motionState: "moving", speed: DEMO_SPEED_KMH, currentStopIndex: DEMO_FIRST_NEXT_STOP });
    expect(bus).not.toHaveProperty("atStopIndex");
    const progress = stopProgress(demoRoute.stops.length, { currentStopIndex: DEMO_FIRST_NEXT_STOP });
    expect(progress?.states.slice(0, 4)).toEqual(["passed", "passed", "passed", "next"]);
  });

  it("stops at each stop with the stop acknowledged, then moves on", () => {
    const dwell = phase("dwell", 0);
    expect(dwell).toMatchObject({ stopIndex: DEMO_FIRST_NEXT_STOP });
    const atStop = frame(dwell.startMs + 1);
    expect(atStop).toMatchObject({ motionState: "stopped", speed: 0, atStopIndex: 3, currentStopIndex: 4 });
    const stop = demoRoute.stops[3];
    expect(Math.abs((atStop.lat as number) - stop.lat)).toBeLessThan(0.0002);
    expect(Math.abs((atStop.lng as number) - stop.lng)).toBeLessThan(0.0002);
    expect(frame(dwell.endMs + 1)).toMatchObject({ motionState: "moving", currentStopIndex: 4 });
    expect(frame(dwell.endMs + 1)).not.toHaveProperty("atStopIndex");
  });

  it("travels forward along the road for the whole ride", () => {
    let previous = -1;
    for (let elapsed = 0; elapsed < DEMO_RIDE_DURATION_MS; elapsed += 2_000) {
      const along = (frame(elapsed).matchedLocation as { alongRouteDistanceM: number }).alongRouteDistanceM;
      expect(along).toBeGreaterThanOrEqual(previous);
      previous = along;
    }
  });

  it("waits at the terminus, then completes so a joined passenger sees the ride end", () => {
    const last = demoRoute.stops.length - 1;
    const terminus = DEMO_TIMELINE.find(entry => entry.kind === "dwell" && entry.stopIndex === last)!;
    expect(frame(terminus.startMs + 1)).toMatchObject({ atStopIndex: last, currentStopIndex: last, tripState: "in_service" });
    const completed = frame(DEMO_RIDE_DURATION_MS - 1);
    expect(completed.tripState).toBe("completed");
    expect(normalizePassengerLiveBus("DEMO_demo-ride", completed, NOW)).toBeNull();
    expect(passengerTripStates({ bus: completed }).get("demo-1")).toBe("completed");
  });

  it("gives honest arrival estimates: the next stop is due when the bus reaches it", () => {
    const bus = frame(0);
    const drive = phase("drive", 0);
    const path = decodePolyline(demoRoute.forwardPolyline!);
    const arrivals = busStopArrivalTimestamps({
      busPoint: { lat: bus.lat as number, lng: bus.lng as number }, heading: bus.heading as number,
      speedKmh: bus.speed as number, delayMinutes: 0, path, remainingStops: demoRoute.stops.slice(DEMO_FIRST_NEXT_STOP), now: NOW,
    });
    const nextStop = demoRoute.stops[DEMO_FIRST_NEXT_STOP];
    expect(Math.abs(arrivals[nextStop.id] - NOW - (drive.endMs - drive.startMs))).toBeLessThan(5_000);
  });
});

describe("shared demo ride", () => {
  it("publishes once a second to every viewer and stops when nobody watches", () => {
    vi.useFakeTimers({ now: NOW });
    const snapshots = vi.fn();
    const changes = vi.fn();
    const stopSnapshots = subscribeDemoRide(snapshots);
    const stopChanges = subscribeDemoRideChanges(changes);
    expect(snapshots).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledWith(expect.objectContaining({ type: "reset", source: "listener" }));
    vi.advanceTimersByTime(DEMO_TICK_MS * 3);
    expect(snapshots).toHaveBeenCalledTimes(4);
    const busIn = (call: unknown[]) => Object.values(call[0] as Record<string, Record<string, unknown>>)[0];
    const firstBus = busIn(snapshots.mock.calls[0]);
    const latestBus = busIn(snapshots.mock.calls[3]);
    expect(latestBus.sessionId).toBe(firstBus.sessionId);
    expect(latestBus.seq).toBe((firstBus.seq as number) + 3);
    stopSnapshots();
    stopChanges();
    vi.advanceTimersByTime(DEMO_TICK_MS * 3);
    expect(snapshots).toHaveBeenCalledTimes(4);
  });

  it("starts a fresh ride on request, and the next one after a ride completes", () => {
    vi.useFakeTimers({ now: NOW });
    const snapshots = vi.fn();
    subscribeDemoRide(snapshots);
    const session = () => Object.values(snapshots.mock.lastCall![0] as Record<string, Record<string, unknown>>)[0].sessionId;
    const first = session();
    vi.advanceTimersByTime(10_000);
    restartDemoRide();
    const second = session();
    expect(second).not.toBe(first);
    vi.advanceTimersByTime(DEMO_RIDE_DURATION_MS + DEMO_TICK_MS);
    expect(session()).not.toBe(second);
  });

  it("boards after a short pause without a location check, and can be cancelled", async () => {
    vi.useFakeTimers({ now: NOW });
    const boarded = vi.fn();
    void boardDemoRide().then(boarded);
    await vi.advanceTimersByTimeAsync(DEMO_BOARDING_MS - 1);
    expect(boarded).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(boarded).toHaveBeenCalledOnce();
    const controller = new AbortController();
    const cancelled = boardDemoRide(controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toBeDefined();
  });
});

