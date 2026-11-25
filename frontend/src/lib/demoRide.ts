import type { RouteData } from "@/hooks/useRoutes";
import type { LiveBusChange } from "./createLiveBusStore";
import type { LiveBusSnapshot } from "./liveBusSnapshot";
import type { LiveBusDeliverySource } from "./liveBusDelivery";
import { decodePolyline, type LatLng } from "./polyline";
import { getDistanceMeters } from "./mapUtils";
import { serverNow } from "./serverClock";
import {
  DEMO_RIDE_FORWARD_POLYLINE,
  DEMO_RIDE_LENGTH_M,
  DEMO_RIDE_REVERSE_POLYLINE,
  DEMO_RIDE_STOPS,
} from "./demoRideRoute";

/*
 * The demo ride is a scripted bus on a fixed route that runs entirely in this
 * browser, so anyone can try choosing stops and boarding when no real bus is
 * running. It publishes the same live-bus shape the backend writes to RTDB, so
 * the route list, map, arrival estimates and boarding card treat it like a
 * real ride. Nothing here reads or writes Firebase or calls the backend, and
 * boarding never asks for the passenger's location.
 */

export const DEMO_ROUTE_ID = "demo-ride";
export const DEMO_BUS_ID = "DEMO";
const DEMO_NODE_KEY = `${DEMO_BUS_ID}_${DEMO_ROUTE_ID}`;

/** 45 km/h: an off-peak bus on Drive-in Road. Arrival estimates use this speed. */
export const DEMO_SPEED_KMH = 45;
const SPEED_MS = DEMO_SPEED_KMH / 3.6;
/** Doors open at each intermediate stop, long enough to board in the demo. */
export const DEMO_DWELL_MS = 20_000;
/** Doors open at the terminus before the ride completes. */
export const DEMO_TERMINUS_DWELL_MS = 20_000;
/** How long the completed ride is published before the next demo ride starts. */
export const DEMO_COMPLETED_MS = 4_000;
/** One packet a second, like a healthy tracker. */
export const DEMO_TICK_MS = 1_000;
/** After this long with nobody watching, the next viewer gets a fresh ride. */
const IDLE_RESET_MS = 60_000;
/** Simulated boarding check: long enough to show progress, short enough to feel live. */
export const DEMO_BOARDING_MS = 1_200;
/** Three stops are behind the bus when a ride starts, as in the approved concept. */
export const DEMO_FIRST_NEXT_STOP = 3;

/** `false` hides the demo ride; anything else, or unset, shows it. */
export function isDemoRideEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_RIDE?.trim().toLowerCase() !== "false";
}

export function isDemoRouteId(routeId: unknown): boolean {
  return routeId === DEMO_ROUTE_ID;
}

const path: LatLng[] = decodePolyline(DEMO_RIDE_FORWARD_POLYLINE);
const cumulative = path.reduce<number[]>((distances, point, index) => {
  distances.push(index === 0 ? 0 : distances[index - 1] + getDistanceMeters(path[index - 1], point));
  return distances;
}, []);

/** Distance along the road to the point nearest each stop (stops sit on the line). */
const stopDistances = DEMO_RIDE_STOPS.map(stop => {
  let best = { distance: Infinity, along: 0 };
  for (let index = 0; index < path.length; index += 1) {
    const distance = getDistanceMeters(path[index], stop);
    if (distance < best.distance) best = { distance, along: cumulative[index] };
  }
  return best.along;
});

/** Ride start: 40% of the way from the third stop to the fourth. */
const START_ALONG_M = stopDistances[DEMO_FIRST_NEXT_STOP - 1] +
  (stopDistances[DEMO_FIRST_NEXT_STOP] - stopDistances[DEMO_FIRST_NEXT_STOP - 1]) * 0.4;

type Phase =
  | { kind: "drive"; startMs: number; endMs: number; from: number; to: number; nextStopIndex: number }
  | { kind: "dwell"; startMs: number; endMs: number; stopIndex: number }
  | { kind: "completed"; startMs: number; endMs: number };

/** The whole scripted ride, in milliseconds from its start. */
export const DEMO_TIMELINE: readonly Phase[] = (() => {
  const phases: Phase[] = [];
  let at = 0;
  let along = START_ALONG_M;
  const lastStop = DEMO_RIDE_STOPS.length - 1;
  for (let stopIndex = DEMO_FIRST_NEXT_STOP; stopIndex <= lastStop; stopIndex += 1) {
    const to = stopDistances[stopIndex];
    const driveMs = Math.round(((to - along) / SPEED_MS) * 1000);
    phases.push({ kind: "drive", startMs: at, endMs: at + driveMs, from: along, to, nextStopIndex: stopIndex });
    at += driveMs;
    along = to;
    const dwellMs = stopIndex === lastStop ? DEMO_TERMINUS_DWELL_MS : DEMO_DWELL_MS;
    phases.push({ kind: "dwell", startMs: at, endMs: at + dwellMs, stopIndex });
    at += dwellMs;
  }
  phases.push({ kind: "completed", startMs: at, endMs: at + DEMO_COMPLETED_MS });
  return phases;
})();

export const DEMO_RIDE_DURATION_MS = DEMO_TIMELINE[DEMO_TIMELINE.length - 1].endMs;

/** The demo route, shaped like a configured route document. */
export const demoRoute: RouteData = {
  id: DEMO_ROUTE_ID,
  name: "Demo ride",
  color: "#801214",
  waypoints: [],
  stops: [...DEMO_RIDE_STOPS],
  polyline: DEMO_RIDE_FORWARD_POLYLINE,
  forwardPolyline: DEMO_RIDE_FORWARD_POLYLINE,
  reversePolyline: DEMO_RIDE_REVERSE_POLYLINE,
  polylineQuality: "HIGH_QUALITY",
  distanceMeters: DEMO_RIDE_LENGTH_M,
  forwardDistanceMeters: DEMO_RIDE_LENGTH_M,
  reverseDistanceMeters: DEMO_RIDE_LENGTH_M,
  // The time a whole run of the line takes at the demo speed and dwell.
  duration: `${Math.round(DEMO_RIDE_LENGTH_M / SPEED_MS + (DEMO_RIDE_STOPS.length - 2) * DEMO_DWELL_MS / 1000)}s`,
  configVersion: 1,
  geometryVersion: 1,
};

function pointAlong(along: number): { point: LatLng; heading: number; segmentIndex: number; segmentFraction: number } {
  const clamped = Math.max(0, Math.min(cumulative[cumulative.length - 1], along));
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
}

export interface DemoRideFrame {
  sessionId: string;
  elapsedMs: number;
  seq: number;
  now: number;
}

/**
 * The live-bus record for one moment of a demo ride, in the RTDB shape the
 * backend publishes. Pure, so tests can step through the whole ride.
 */
export function demoRideBus({ sessionId, elapsedMs, seq, now }: DemoRideFrame): Record<string, unknown> {
  const time = Math.max(0, Math.min(elapsedMs, DEMO_RIDE_DURATION_MS - 1));
  const phase = DEMO_TIMELINE.find(candidate => time >= candidate.startMs && time < candidate.endMs) ??
    DEMO_TIMELINE[DEMO_TIMELINE.length - 1];
  const lastStop = DEMO_RIDE_STOPS.length - 1;
  let along: number;
  let currentStopIndex: number;
  let atStopIndex: number | undefined;
  let moving = false;
  if (phase.kind === "drive") {
    const progress = phase.endMs > phase.startMs ? (time - phase.startMs) / (phase.endMs - phase.startMs) : 1;
    along = phase.from + (phase.to - phase.from) * progress;
    currentStopIndex = phase.nextStopIndex;
    moving = true;
  } else if (phase.kind === "dwell") {
    along = stopDistances[phase.stopIndex];
    // The backend acknowledges a stop by moving on to the next one; at the
    // terminus there is no next stop, so the index stays on it.
    currentStopIndex = phase.stopIndex === lastStop ? lastStop : phase.stopIndex + 1;
    atStopIndex = phase.stopIndex;
  } else {
    along = stopDistances[lastStop];
    currentStopIndex = lastStop;
  }
  const { point: located, segmentIndex, segmentFraction, heading: travelHeading } = pointAlong(along);
  // Standing at a stop, keep facing the way the bus arrived.
  const heading = moving ? travelHeading : pointAlong(Math.max(0, along - 1)).heading;
  const speed = moving ? DEMO_SPEED_KMH : 0;
  const motionState = moving ? "moving" : "stopped";
  return {
    busId: DEMO_BUS_ID,
    routeId: DEMO_ROUTE_ID,
    sessionId,
    driverId: "",
    demo: true,
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
      distanceToRouteM: 0, segmentIndex, segmentFraction, alongRouteDistanceM: along,
    },
  };
}

// ── The shared ride, shared by every view in this tab ────────────────────────

type SnapshotListener = (snapshot: LiveBusSnapshot | null, source: LiveBusDeliverySource) => void;
type ChangeListener = (change: LiveBusChange) => void;

const snapshotListeners = new Set<SnapshotListener>();
const changeListeners = new Set<ChangeListener>();
let ride: { sessionId: string; startedAt: number; seq: number } | null = null;
let rideCount = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let idleSince: number | null = null;
let snapshot: LiveBusSnapshot | null = null;

function startRide(now = serverNow()) {
  rideCount += 1;
  ride = { sessionId: `demo-${rideCount}-${Math.floor(now).toString(36)}`, startedAt: now, seq: 0 };
}

function publish() {
  const now = serverNow();
  if (!ride || now - ride.startedAt >= DEMO_RIDE_DURATION_MS) startRide(now);
  const current = ride!;
  current.seq += 1;
  snapshot = {
    [DEMO_NODE_KEY]: demoRideBus({ sessionId: current.sessionId, elapsedMs: now - current.startedAt, seq: current.seq, now }),
  };
  snapshotListeners.forEach(listener => listener(snapshot, "listener"));
  changeListeners.forEach(listener => listener({ type: "reset", snapshot, source: "listener" }));
}

function watch() {
  if (idleSince !== null && serverNow() - idleSince > IDLE_RESET_MS) ride = null;
  idleSince = null;
  if (timer === null) {
    publish();
    timer = setInterval(publish, DEMO_TICK_MS);
  }
}

function unwatch() {
  if (snapshotListeners.size > 0 || changeListeners.size > 0) return;
  if (timer !== null) clearInterval(timer);
  timer = null;
  idleSince = serverNow();
}

/** Same contract as `subscribeLiveBusesByRoute` for the demo route. */
export function subscribeDemoRide(next: SnapshotListener): () => void {
  snapshotListeners.add(next);
  if (timer === null) watch();
  else if (snapshot) next(snapshot, "listener");
  return () => {
    snapshotListeners.delete(next);
    unwatch();
  };
}

/** Same contract as `subscribeLiveBusChangesByRoute` for the demo route. */
export function subscribeDemoRideChanges(next: ChangeListener): () => void {
  changeListeners.add(next);
  if (timer === null) watch();
  else if (snapshot) next({ type: "reset", snapshot, source: "listener" });
  return () => {
    changeListeners.delete(next);
    unwatch();
  };
}

/** Start a fresh demo ride now, so a passenger opening it finds the bus approaching. */
export function restartDemoRide(): void {
  startRide();
  if (timer !== null) publish();
}

/** Boarding in the demo: a short pause instead of a location check and join request. */
export function boardDemoRide(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = setTimeout(resolve, DEMO_BOARDING_MS);
    signal?.addEventListener("abort", () => {
      clearTimeout(done);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

/** Test seam: forget the shared ride and stop its timer. */
export function resetDemoRideForTests(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  ride = null;
  rideCount = 0;
  idleSince = null;
  snapshot = null;
  snapshotListeners.clear();
  changeListeners.clear();
}
