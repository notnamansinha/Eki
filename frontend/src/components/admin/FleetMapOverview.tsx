"use client";

import { useEffect, useRef, useState } from "react";
import { Map as GoogleMap, AdvancedMarker, useMap } from "@vis.gl/react-google-maps";
import { useRoutes } from "@/hooks/useRoutes";
import { useBuses } from "@/hooks/useBuses";

import { MAP_OPTIONS, MAPS_MAP_ID, DEFAULT_CENTER } from "@/config/maps";
import { rtdb } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";

interface BusLocation {
  busId: string;
  driverId: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  timestamp: number;
  status: "active" | "idle" | "maintenance";
  routeId?: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: "#10b981",
  maintenance: "#ef4444",
  idle: "#f59e0b",
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
  const { routes } = useRoutes();
  const { buses: registeredBuses } = useBuses();
  const [buses, setBuses] = useState<Map<string, BusLocation>>(new Map<string, BusLocation>());

  useEffect(() => {
    const busesRef = ref(rtdb, "activeBuses");
    const unsubscribe = onValue(busesRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setBuses(new Map());
        return;
      }
      
      const newBuses = new Map<string, BusLocation>();
      Object.values(data).forEach((bus: any) => {
        if (bus.busId && bus.lat && bus.lng && bus.status !== "offline") {
          newBuses.set(bus.busId, bus);
        }
      });
      setBuses(newBuses);
    });

    return () => unsubscribe();
  }, []);

  const [predefinedRoute, setPredefinedRoute] = useState<{ lat: number; lng: number }[]>([]);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);

  useEffect(() => {
    const targetBus = selectedBusId ? buses.get(selectedBusId) : null;
    const newRouteId = targetBus?.routeId || "";
    if (newRouteId !== activeRouteId && newRouteId) {
      setActiveRouteId(newRouteId);
      const route = routes.find(r => r.id === newRouteId);
      if (route) setPredefinedRoute(route.waypoints.map(w => ({ lat: w.lat, lng: w.lng })));
    } else if (!newRouteId && predefinedRoute.length > 0) {
      setPredefinedRoute([]);
      setActiveRouteId(null);
    }
  }, [buses, selectedBusId, activeRouteId, routes, predefinedRoute.length]);

  // Clear selection if selected bus is deleted from Firestore
  const registeredBusIds = new Set(registeredBuses.map((b) => b.id));
  useEffect(() => {
    if (selectedBusId && !registeredBusIds.has(selectedBusId)) {
      setSelectedBusId(null);
    }
  }, [selectedBusId, registeredBuses]);

  // Only show buses registered in Firestore
  const visibleBuses = new Map(
    Array.from(buses.entries()).filter(([busId]) => registeredBusIds.has(busId))
  );

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
          const color = STATUS_COLORS[bus.status] || STATUS_COLORS.idle;
          const isSelected = selectedBusId === bus.busId;
          const s = isSelected ? 48 : 40;
          const snappedHeading = Math.round(bus.heading / 5) * 5;
          return (
            <AdvancedMarker
              key={bus.busId}
              position={{ lat: bus.lat, lng: bus.lng }}
              onClick={(e) => {
                setSelectedBusId(bus.busId);
              }}
            >
              <div style={{ width: s, height: s, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", transform: isSelected ? "scale(1.25)" : "scale(1)", transition: "transform 0.3s" }}>
                {isSelected && (
                  <div style={{ position: "absolute", top: -32, left: "50%", transform: "translateX(-50%)", background: "#2563eb", color: "white", fontSize: 10, fontWeight: "bold", padding: "2px 8px", borderRadius: 4, whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>
                    Selected: {bus.busId}
                  </div>
                )}
                <div style={{ transform: `rotate(${snappedHeading}deg)`, transition: "transform 600ms" }}>
                  <svg width={s * 0.7} height={s * 0.7} viewBox="0 0 24 24" fill="none">
                    <path d="M12 2L20 20L12 16L4 20L12 2Z" fill={color} stroke="white" strokeWidth="1" strokeLinejoin="round" />
                  </svg>
                </div>
                <div style={{ position: "absolute", bottom: -4, right: -4, width: 10, height: 10, borderRadius: "50%", background: color, border: "1px solid #000" }} />
              </div>
            </AdvancedMarker>
          );
        })}
      </GoogleMap>


    </div>
  );
}

export default FleetMapOverviewInner;
