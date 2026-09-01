"use client";

import { useEffect, useState } from "react";
import type { ActiveBusEntry } from "@/lib/activeBusEntries";
import {
  activeBusNodeKey,
  cachedActiveRouteGeometry,
  fetchActiveRouteGeometry,
  type ActiveRouteGeometry,
} from "@/lib/activeRouteGeometry";

/**
 * Resolve each dynamic-rerouted bus's active geometry (from the version-keyed
 * sibling node) into a state map keyed by busId. Geometry changes only on a
 * route-version bump, so a version is fetched at most once. Buses without a
 * dynamic reroute are never included.
 */
export function useDynamicRouteGeometries(
  buses: ReadonlyMap<string, ActiveBusEntry>,
): Map<string, ActiveRouteGeometry> {
  const [geometries, setGeometries] = useState<Map<string, ActiveRouteGeometry>>(
    new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    const next = new Map<string, ActiveRouteGeometry>();
    const pending: Promise<void>[] = [];

    for (const bus of buses.values()) {
      if (
        bus.routeSource !== "dynamic-reroute" ||
        typeof bus.routeVersion !== "number" ||
        bus.routeVersion <= 0 ||
        typeof bus.busId !== "string" ||
        typeof bus.routeId !== "string"
      ) {
        continue;
      }
      const nodeKey = activeBusNodeKey(bus.busId, bus.routeId);
      const existing = cachedActiveRouteGeometry(nodeKey, bus.routeVersion);
      if (existing) {
        next.set(bus.busId, existing);
      } else if (existing === undefined) {
        pending.push(
          fetchActiveRouteGeometry(nodeKey, bus.routeVersion).then((geometry) => {
            if (!cancelled && geometry) next.set(bus.busId, geometry);
          }),
        );
      }
    }

    void Promise.all(pending).then(() => {
      if (cancelled) return;
      setGeometries((prev) => {
        if (
          prev.size === next.size &&
          [...prev.entries()].every(([id, geometry]) => next.get(id) === geometry)
        ) {
          return prev;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [buses]);

  return geometries;
}