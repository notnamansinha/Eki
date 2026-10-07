import type { LatLng } from "./polyline";
import {
  positionAlongPolyline,
  preparePolylineDistanceIndex,
} from "./polylineDistance";
import { getDistanceMeters } from "./mapUtils";
import { ETA_SPEED_FLOOR_KMH } from "./etaConstants";

export interface EtaStopPoint {
  id: string;
  lat: number;
  lng: number;
}

interface StopProjectionEntry {
  path: readonly LatLng[];
  stopsKey: string;
  positions: ReadonlyMap<string, number | null>;
}

function stopProjectionKey(stop: EtaStopPoint): string {
  return JSON.stringify([stop.id, stop.lat, stop.lng]);
}

/** Owned by one map instance; route switches and unmount discard its entries. */
export class StopProjectionCache {
  private readonly entries = new Map<string, StopProjectionEntry>();
  private static readonly MAX_ENTRIES = 16;

  positions(routeKey: string, path: readonly LatLng[], stops: readonly EtaStopPoint[]): ReadonlyMap<string, number | null> {
    // Check coordinates as well as IDs: an edit may reuse a route version until
    // the authoritative version update arrives.
    const stopsKey = JSON.stringify(stops.map((stop) => [stop.id, stop.lat, stop.lng]));
    const existing = this.entries.get(routeKey);
    if (existing?.path === path && existing.stopsKey === stopsKey) return existing.positions;
    const index = preparePolylineDistanceIndex(path);
    const positions = new Map(stops.map((stop) => [stopProjectionKey(stop), positionAlongPolyline(stop, index)]));
    this.entries.delete(routeKey);
    this.entries.set(routeKey, { path, stopsKey, positions });
    if (this.entries.size > StopProjectionCache.MAX_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    return positions;
  }

  clear(): void { this.entries.clear(); }
  get size(): number { return this.entries.size; }
}

/**
 * Compute arrival timestamps for the stops ahead of a single bus, measured
 * along that BUS's own path. Each bus carries its own active path (a dynamic
 * reroute when it has one, else the shared configured path), so a reroute on
 * one bus never leaks into another bus's ETA.
 *
 * Math mirrors the legacy passenger-map loop: 45s dwell per intermediate stop
 * and a configurable speed floor.
 */
export function busStopArrivalTimestamps(params: {
  busPoint: { lat: number; lng: number };
  heading: number;
  speedKmh: number;
  delayMinutes: number;
  path: readonly LatLng[];
  remainingStops: readonly EtaStopPoint[];
  now: number;
  stopPositions?: ReadonlyMap<string, number | null>;
  busPathPosition?: number | null;
}): Record<string, number> {
  const index = preparePolylineDistanceIndex(params.path);
  const busPathPosition = params.busPathPosition !== undefined
    ? params.busPathPosition
    : positionAlongPolyline(params.busPoint, index, { headingDegrees: params.heading });
  const speedKmh = Math.max(
    params.speedKmh || ETA_SPEED_FLOOR_KMH,
    ETA_SPEED_FLOOR_KMH,
  );
  const speedMs = speedKmh / 3.6;
  const delaySec = (params.delayMinutes || 0) * 60;
  const arrivals: Record<string, number> = {};

  for (let i = 0; i < params.remainingStops.length; i += 1) {
    const stop = params.remainingStops[i];
    const projectionKey = stopProjectionKey(stop);
    const stopPathPosition = params.stopPositions?.has(projectionKey)
      ? params.stopPositions.get(projectionKey) ?? null
      : positionAlongPolyline(stop, index);
    const accumDistMeters =
      busPathPosition !== null && stopPathPosition !== null
        ? Math.abs(stopPathPosition - busPathPosition)
        : getDistanceMeters(params.busPoint, stop);
    let totalSeconds = accumDistMeters / speedMs;
    if (i > 0) totalSeconds += i * 45;
    arrivals[stop.id] =
      params.now + totalSeconds * 1000 + delaySec * 1000;
  }

  return arrivals;
}
