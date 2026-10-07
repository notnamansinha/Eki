"use client";

import { useEffect, useMemo, useState } from "react";
import type { ActiveBusEntry } from "../lib/activeBusEntries";
import { directionsMatch } from "../lib/rideDirection";
import {
  activeBusNodeKey,
  cachedActiveRouteGeometry,
  fetchActiveRouteGeometry,
  type ActiveRouteGeometry,
} from "../lib/activeRouteGeometry";

export interface VersionedRouteGeometry {
  version: number;
  geometry: ActiveRouteGeometry;
}

/**
 * Pure selection: expose a bus's geometry only when it belongs to the bus's
 * CURRENT route version. A bus that bumped v1→v2 therefore never reads v1
 * geometry while the v2 request is unresolved; consumers get nothing until the
 * matching version is available and fall back to the configured route.
 */
export function selectCurrentRouteGeometries(
  buses: ReadonlyMap<string, ActiveBusEntry>,
  versioned: ReadonlyMap<string, VersionedRouteGeometry>,
): Map<string, ActiveRouteGeometry> {
  const selected = new Map<string, ActiveRouteGeometry>();
  for (const bus of buses.values()) {
    if (
      bus.routeSource !== "dynamic-reroute" ||
      !directionsMatch(bus.direction, bus.routeDirection) ||
      typeof bus.routeVersion !== "number" ||
      typeof bus.busId !== "string"
    ) {
      continue;
    }
    const entry = versioned.get(bus.busId);
    if (entry && entry.version === bus.routeVersion) {
      selected.set(bus.busId, entry.geometry);
    }
  }
  return selected;
}

/**
 * Resolve each dynamic-rerouted bus's active geometry (from the version-keyed
 * sibling node) into a state map keyed by busId. Geometry changes only on a
 * route-version bump, so a version is fetched at most once. Stored entries are
 * version-tagged and exposed only while they match the bus's current version,
 * so a pending v2 fetch never surfaces stale v1 geometry.
 */
export function useDynamicRouteGeometries(
  buses: ReadonlyMap<string, ActiveBusEntry>,
): Map<string, ActiveRouteGeometry> {
  const [versioned, setVersioned] = useState<Map<string, VersionedRouteGeometry>>(
    new Map(),
  );
  const selectionKey = JSON.stringify([...buses.values()].map((bus) => [
    bus.busId, bus.routeId, bus.routeSource, bus.routeVersion,
    bus.direction, bus.routeDirection,
  ]));

  useEffect(() => {
    let cancelled = false;
    const next = new Map<string, VersionedRouteGeometry>();
    const pending: Promise<void>[] = [];

    for (const bus of buses.values()) {
      if (
        bus.routeSource !== "dynamic-reroute" ||
        !directionsMatch(bus.direction, bus.routeDirection) ||
        typeof bus.routeVersion !== "number" ||
        bus.routeVersion <= 0 ||
        typeof bus.busId !== "string" ||
        typeof bus.routeId !== "string"
      ) {
        continue;
      }
      const version = bus.routeVersion;
      const nodeKey = activeBusNodeKey(bus.busId, bus.routeId);
      const existing = cachedActiveRouteGeometry(nodeKey, version);
      if (existing) {
        next.set(bus.busId, { version, geometry: existing });
      } else if (existing === undefined) {
        pending.push(
          fetchActiveRouteGeometry(nodeKey, version).then((geometry) => {
            if (!cancelled && geometry) {
              next.set(bus.busId, { version, geometry });
              // Publish each bus immediately; a slow fleet peer cannot hold it back.
              setVersioned((previous) => sameVersioned(previous, next) ? previous : new Map(next));
            }
          }),
        );
      }
    }

    void Promise.resolve().then(() => {
      if (!cancelled) setVersioned((previous) => sameVersioned(previous, next) ? previous : new Map(next));
    });
    void Promise.all(pending).then(() => {
      if (cancelled) return;
      setVersioned((prev) => {
        if (sameVersioned(prev, next)) {
          return prev;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [buses]);

  // Only geometry-relevant bus fields participate; location/speed ticks keep
  // the selected map identity and avoid a second ETA effect pass.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => selectCurrentRouteGeometries(buses, versioned), [selectionKey, versioned]);
}

function sameVersioned(left: ReadonlyMap<string, VersionedRouteGeometry>, right: ReadonlyMap<string, VersionedRouteGeometry>): boolean {
  return left.size === right.size && [...left].every(([id, entry]) => {
    const other = right.get(id);
    return other?.version === entry.version && other.geometry === entry.geometry;
  });
}
