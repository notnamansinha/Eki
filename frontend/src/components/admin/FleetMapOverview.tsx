"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Map as GoogleMap, AdvancedMarker, useMap } from "@vis.gl/react-google-maps";
import { useAdminData } from "@/contexts/AdminDataContext";

import { MAP_OPTIONS, MAPS_MAP_ID, DEFAULT_CENTER } from "@/config/maps";

interface BusLocation {
  busId: string;
  driverId?: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  timestamp: number;
  deviceState?: "online" | "offline";
  motionState?: "moving" | "stopped" | "uncertain";
  tripState?: "pre_departure" | "in_service" | "completed" | "maintenance";
  routeId?: string;
}

const MOTION_COLORS: Record<string, string> = {
  moving:    "#34D399", // emerald
  stopped:   "#FBBF24", // amber
  uncertain: "#F87171", // red
};

function RoutePolyline({ path }: { path: { lat: number; lng: number }[] }) {
  const map = useMap();
  const lineRef = useRef<google.maps.Polyline | null>(null);

  useEffect(() => {
    if (!map || path.length === 0) return;
    lineRef.current = new google.maps.Polyline({
      path,
      strokeColor: "#2563EB",
      strokeWeight: 6,
      strokeOpacity: 0.8,
      map,
    });
    return () => { lineRef.current?.setMap(null); };
  }, [map, path]);

  return null;
}

function FleetMapOverviewInner() {
  const { routes, buses: registeredBuses, activeBuses, activeBusesUpdatedAt } = useAdminData();
  const buses = useMemo(() => {
    const liveBuses = new Map<string, BusLocation>();
    activeBuses.forEach((bus) => {
      const isFresh = bus.timestamp ? activeBusesUpdatedAt - bus.timestamp < 300_000 : false;
      if (bus.busId && bus.lat != null && bus.lng != null && isFresh && bus.deviceState === "online") {
        liveBuses.set(bus.busId, bus as BusLocation);
      }
    });
    return liveBuses;
  }, [activeBuses, activeBusesUpdatedAt]);

  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);

  const registeredBusIds = new Set(registeredBuses.map((b) => b.id));
  const visibleBuses = new Map(
    Array.from(buses.entries()).filter(([busId]) => registeredBusIds.has(busId))
  );
  const selectedBus = selectedBusId ? visibleBuses.get(selectedBusId) : null;
  const selectedRoute = selectedBus?.routeId
    ? routes.find((route) => route.id === selectedBus.routeId)
    : null;
  const predefinedRoute = selectedRoute?.waypoints.map((waypoint) => ({ lat: waypoint.lat, lng: waypoint.lng })) || [];

  return (
    <div className="relative w-full h-full">
      <GoogleMap
        mapId={MAPS_MAP_ID}
        defaultCenter={DEFAULT_CENTER}
        defaultZoom={14}
        style={{ height: "100%", width: "100%", position: "absolute", inset: 0 }}
        onClick={() => setSelectedBusId(null)}
        {...MAP_OPTIONS}
      >
        <RoutePolyline path={predefinedRoute} />

        {Array.from(visibleBuses.values()).map((bus) => {
          const registeredBus = registeredBuses.find(b => b.id === bus.busId);
          const labelText = registeredBus?.name || bus.busId;
          
          const motion = bus.motionState || "uncertain";
          const color = MOTION_COLORS[motion] || MOTION_COLORS.uncertain;
          
          const isSelected = selectedBusId === bus.busId;
          const snappedHeading = Math.round(bus.heading / 5) * 5;
          return (
            <AdvancedMarker
              key={bus.busId}
              position={{ lat: bus.lat, lng: bus.lng }}
              onClick={() => {
                setSelectedBusId(bus.busId);
              }}
            >
              <div style={{ width: 44, height: 44, position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", transform: isSelected ? "scale(1.2)" : "scale(1)", transition: "transform 0.3s" }}>
                {/* Persistent label badge above the pointer */}
                <div style={{ position: "absolute", top: -20, background: isSelected ? "var(--accent)" : "var(--surface-2)", color: "white", fontSize: 9, fontWeight: "bold", padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap", border: "1px solid var(--border-default)", boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }}>
                  {labelText}
                </div>
                
                {/* Pointer icon rotated dynamically */}
                <div style={{ transform: `rotate(${snappedHeading}deg)`, transition: "transform 600ms" }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2L20 20L12 16L4 20L12 2Z" fill={color} stroke="white" strokeWidth="1" strokeLinejoin="round" />
                  </svg>
                </div>
                
                {/* Status indicator dot */}
                <div style={{ position: "absolute", bottom: 4, right: 4, width: 8, height: 8, borderRadius: "50%", background: color, border: "1.5px solid #09090b" }} />
              </div>
            </AdvancedMarker>
          );
        })}
      </GoogleMap>
    </div>
  );
}

export default FleetMapOverviewInner;
