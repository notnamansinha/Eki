import type { RouteData } from "@/hooks/useRoutes";
import type { LiveBusChange } from "./createLiveBusStore";
import type { LiveBusSnapshot } from "./liveBusSnapshot";
import type { LiveBusDeliverySource } from "./liveBusDelivery";
import { decodePolyline, type LatLng } from "./polyline";
import { getDistanceMeters } from "./mapUtils";
import { serverNow } from "./serverClock";

/*
 * A scripted bus that drives a route's road geometry in this browser. It
 * publishes the same live-bus shape the backend writes to RTDB, so the route
 * list, map, arrival estimates and boarding view treat it like a real ride.
 * The demo ride and the app tour's ride both run on it. Nothing here reads or
 * writes Firebase or calls the backend.
 */

export interface RideScriptOptions {
  routeId: string;
  busId: string;
  /** Cruising speed; arrival estimates use it. */
  speedKmh: number;
  /** Doors open at each intermediate stop. */
  dwellMs: number;
  /** Doors open at the terminus before the ride completes. */
  terminusDwellMs: number;
  /** How long the completed ride is published before the next one starts. */
  completedMs: number;
  /** The stop the bus is driving towards when a ride starts (1 or more). */
  firstNextStop: number;
  /** How far from the previous stop to that one the ride starts, 0 to 1. */
  startFraction: number;
  /** Extra fields on every record (the demo ride marks itself `demo`). */
  extra?: Record<string, unknown>;
}

export type RidePhase =
  | { kind: "drive"; startMs: number; endMs: number; from: number; to: number; nextStopIndex: number }
  | { kind: "dwell"; startMs: number; endMs: number; stopIndex: number }
  | { kind: "completed"; startMs: number; endMs: number };

export interface RideFrame {
  sessionId: string;
  elapsedMs: number;
  seq: number;
  now: number;
}

export interface RideScript {
  routeId: string;
  busId: string;
  /** The stop the bus is driving towards when a ride starts. */
  firstNextStop: number;
  timeline: readonly RidePhase[];
  durationMs: number;
  /** The live-bus record for one moment of the ride. Pure. */
  busAt(frame: RideFrame): Record<string, unknown>;
}

/** The road a route is drawn on, in travel order: its forward polyline, else its stops. */
function roadOf(route: RouteData): LatLng[] {
  const encoded = route.forwardPolyline || route.polyline;
  if (encoded) {
    try {
      const decoded = decodePolyline(encoded);
      if (decoded.length >= 2) return decoded;
    } catch { /* Fall back to the stops. */ }
  }
  return (route.stops ?? []).map(stop => ({ lat: stop.lat, lng: stop.lng }));
}

/** A stop further than this from its road means the geometry cannot carry a ride. */
const MAX_STOP_OFFSET_M = 250;

/** The nearest point to `point` on the segment a→b, as a fraction of the segment and a distance. */
function nearestOnSegment(a: LatLng, b: LatLng, point: LatLng): { fraction: number; distance: number } {
  // Local flat projection: metres east and north of `a`.
  const metresPerLat = 111_320;
  const metresPerLng = 111_320 * Math.cos((a.lat * Math.PI) / 180);
  const bx = (b.lng - a.lng) * metresPerLng, by = (b.lat - a.lat) * metresPerLat;
  const px = (point.lng - a.lng) * metresPerLng, py = (point.lat - a.lat) * metresPerLat;
  const lengthSquared = bx * bx + by * by;
  const fraction = lengthSquared > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / lengthSquared)) : 0;
  return { fraction, distance: Math.hypot(px - bx * fraction, py - by * fraction) };
}

/**
 * Build the script for a route, or null when its geometry cannot carry a ride
 * (fewer than two stops, stops far from the road, or stops out of order).
 */
export function createRideScript(route: RouteData, options: RideScriptOptions): RideScript | null {
  const stops = route.stops ?? [];
  if (stops.length < 2) return null;
  const path = roadOf(route);
  if (path.length < 2) return null;
  const cumulative = path.reduce<number[]>((distances, point, index) => {
    distances.push(index === 0 ? 0 : distances[index - 1] + getDistanceMeters(path[index - 1], point));
    return distances;
  }, []);

  // Distance along the road to the point nearest each stop. Each search starts
  // at the previous stop's segment, so a road that passes a stop twice cannot
  // reorder them.
  const stopDistances: number[] = [];
  let fromSegment = 0;
  for (const stop of stops) {
    let best = { distance: Infinity, segment: fromSegment, along: 0 };
    for (let segment = fromSegment; segment < path.length - 1; segment += 1) {
      const { fraction, distance } = nearestOnSegment(path[segment], path[segment + 1], stop);
      if (distance < best.distance) {
        best = { distance, segment, along: cumulative[segment] + (cumulative[segment + 1] - cumulative[segment]) * fraction };
      }
    }
    if (best.distance > MAX_STOP_OFFSET_M) return null;
    stopDistances.push(best.along);
    fromSegment = best.segment;
  }
  for (let index = 1; index < stopDistances.length; index += 1) {
    if (stopDistances[index] <= stopDistances[index - 1]) return null;
  }

  const speedMs = options.speedKmh / 3.6;
  const lastStop = stops.length - 1;
  const firstNext = Math.min(Math.max(1, options.firstNextStop), lastStop);
  const startFraction = Math.min(Math.max(0, options.startFraction), 0.95);
  const startAlong = stopDistances[firstNext - 1] + (stopDistances[firstNext] - stopDistances[firstNext - 1]) * startFraction;

  const timeline: RidePhase[] = [];
  let at = 0;
  let along = startAlong;
  for (let stopIndex = firstNext; stopIndex <= lastStop; stopIndex += 1) {
    const to = stopDistances[stopIndex];
    const driveMs = Math.round(((to - along) / speedMs) * 1000);
    timeline.push({ kind: "drive", startMs: at, endMs: at + driveMs, from: along, to, nextStopIndex: stopIndex });
    at += driveMs;
    along = to;
    const dwell = stopIndex === lastStop ? options.terminusDwellMs : options.dwellMs;
    timeline.push({ kind: "dwell", startMs: at, endMs: at + dwell, stopIndex });
    at += dwell;
  }
  timeline.push({ kind: "completed", startMs: at, endMs: at + options.completedMs });
  const durationMs = at + options.completedMs;

  const pointAlong = (distanceAlong: number) => {
    const clamped = Math.max(0, Math.min(cumulative[cumulative.length - 1], distanceAlong));
    let index = 1;
    while (index < path.length - 1 && cumulative[index] < clamped) index += 1;
    const from = path[index - 1];
    const to = path[index];
    const length = cumulative[index] - cumulative[index - 1];
    const fraction = length > 0 ? (clamped - cumulative[index - 1]) / length : 0;
    const point = { lat: from.lat + (to.lat - from.lat) * fraction, lng: from.lng + (to.lng - from.lng) * fraction };
    const y = Math.sin(((to.lng - from.lng) * Math.PI) / 180) * Math.cos((to.lat * Math.PI) / 180);
    const x = Math.cos((from.lat * Math.PI) / 180) * Math.sin((to.lat * Math.PI) / 180) -
      Math.sin((from.lat * Math.PI) / 180) * Math.cos((to.lat * Math.PI) / 180) * Math.cos(((to.lng - from.lng) * Math.PI) / 180);
    const heading = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    return { point, heading: heading >= 360 ? 0 : heading, segmentIndex: index - 1, segmentFraction: fraction };
  };

  const busAt = ({ sessionId, elapsedMs, seq, now }: RideFrame): Record<string, unknown> => {
    const time = Math.max(0, Math.min(elapsedMs, durationMs - 1));
    const phase = timeline.find(candidate => time >= candidate.startMs && time < candidate.endMs) ?? timeline[timeline.length - 1];
    let distanceAlong: number;
    let currentStopIndex: number;
    let atStopIndex: number | undefined;
    let moving = false;
    if (phase.kind === "drive") {
      const progress = phase.endMs > phase.startMs ? (time - phase.startMs) / (phase.endMs - phase.startMs) : 1;
      distanceAlong = phase.from + (phase.to - phase.from) * progress;
      currentStopIndex = phase.nextStopIndex;
      moving = true;
    } else if (phase.kind === "dwell") {
      distanceAlong = stopDistances[phase.stopIndex];
      // The backend acknowledges a stop by moving on to the next one; at the
      // terminus there is no next stop, so the index stays on it.
      currentStopIndex = phase.stopIndex === lastStop ? lastStop : phase.stopIndex + 1;
      atStopIndex = phase.stopIndex;
    } else {
      distanceAlong = stopDistances[lastStop];
      currentStopIndex = lastStop;
    }
    const { point: located, segmentIndex, segmentFraction, heading: travelHeading } = pointAlong(distanceAlong);
    // Standing at a stop, keep facing the way the bus arrived.
    const heading = moving ? travelHeading : pointAlong(Math.max(0, distanceAlong - 1)).heading;
    const speed = moving ? options.speedKmh : 0;
    const motionState = moving ? "moving" : "stopped";
    return {
      busId: options.busId,
      routeId: options.routeId,
      sessionId,
      driverId: "",
      ...options.extra,
      lat: located.lat,
      lng: located.lng,
      heading,
      speed,
      timestamp: now,
      backendReceivedAt: now,
      seq,
      deviceState: "online",
      status: "active",
      tripState: phase.kind === "completed" ? "completed" : "in_service",
      direction: "forward",
      directionState: "resolved",
      routeDirection: "forward",
      routeVersion: 1,
      routeGeometryVersion: 1,
      currentStopIndex,
      ...(atStopIndex !== undefined ? { atStopIndex } : {}),
      routeSource: "configured",
      routeState: "ON_ROUTE",
      motionState,
      mapMatchSeq: seq,
      mapMatchSampledAt: now,
      rawLocation: { lat: located.lat, lng: located.lng, speed, heading, motionState, seq, sampledAt: now },
      matchedLocation: {
        lat: located.lat, lng: located.lng, seq, sampledAt: now, routeVersion: 1, matchConfidence: 0.99,
        distanceToRouteM: 0, segmentIndex, segmentFraction, alongRouteDistanceM: distanceAlong,
      },
    };
  };

  return { routeId: options.routeId, busId: options.busId, firstNextStop: firstNext, timeline, durationMs, busAt };
}

// ── One ride at a time, shared by every view in this tab ─────────────────────

type SnapshotListener = (snapshot: LiveBusSnapshot | null, source: LiveBusDeliverySource) => void;
type ChangeListener = (change: LiveBusChange) => void;

/** One packet a second, like a healthy tracker. */
export const RIDE_TICK_MS = 1_000;
/** After this long with nobody watching, the next viewer gets a fresh ride. */
const IDLE_RESET_MS = 60_000;

export interface SimulatedRide {
  /** Same contract as `subscribeLiveBusesByRoute` for the ride's route. */
  subscribe(next: SnapshotListener): () => void;
  /** Same contract as `subscribeLiveBusChangesByRoute` for the ride's route. */
  subscribeChanges(next: ChangeListener): () => void;
  /** Start a fresh ride now. */
  restart(): void;
  /** Ride another script (another route), starting a fresh ride. */
  setScript(script: RideScript): void;
  /** Test seam: forget the ride and stop the timer. */
  reset(): void;
}

export function createSimulatedRide(initial: RideScript, sessionIdFor: (count: number, now: number) => string): SimulatedRide {
  let script = initial;
  const snapshotListeners = new Set<SnapshotListener>();
  const changeListeners = new Set<ChangeListener>();
  let ride: { sessionId: string; startedAt: number; seq: number } | null = null;
  let rideCount = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let idleSince: number | null = null;
  let snapshot: LiveBusSnapshot | null = null;

  const startRide = (now = serverNow()) => {
    rideCount += 1;
    ride = { sessionId: sessionIdFor(rideCount, now), startedAt: now, seq: 0 };
  };

  const publish = () => {
    const now = serverNow();
    if (!ride || now - ride.startedAt >= script.durationMs) startRide(now);
    const current = ride!;
    current.seq += 1;
    snapshot = {
      [`${script.busId}_${script.routeId}`]: script.busAt({ sessionId: current.sessionId, elapsedMs: now - current.startedAt, seq: current.seq, now }),
    };
    snapshotListeners.forEach(listener => listener(snapshot, "listener"));
    changeListeners.forEach(listener => listener({ type: "reset", snapshot, source: "listener" }));
  };

  const watch = () => {
    if (idleSince !== null && serverNow() - idleSince > IDLE_RESET_MS) ride = null;
    idleSince = null;
    if (timer === null) {
      publish();
      timer = setInterval(publish, RIDE_TICK_MS);
    }
  };

  const unwatch = () => {
    if (snapshotListeners.size > 0 || changeListeners.size > 0) return;
    if (timer !== null) clearInterval(timer);
    timer = null;
    idleSince = serverNow();
  };

  return {
    subscribe(next) {
      snapshotListeners.add(next);
      if (timer === null) watch();
      else if (snapshot) next(snapshot, "listener");
      return () => { snapshotListeners.delete(next); unwatch(); };
    },
    subscribeChanges(next) {
      changeListeners.add(next);
      if (timer === null) watch();
      else if (snapshot) next({ type: "reset", snapshot, source: "listener" });
      return () => { changeListeners.delete(next); unwatch(); };
    },
    restart() {
      startRide();
      if (timer !== null) publish();
    },
    setScript(next) {
      script = next;
      startRide();
      if (timer !== null) publish();
    },
    reset() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      ride = null;
      rideCount = 0;
      idleSince = null;
      snapshot = null;
      snapshotListeners.clear();
      changeListeners.clear();
    },
  };
}
