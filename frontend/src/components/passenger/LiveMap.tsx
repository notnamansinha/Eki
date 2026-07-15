"use client";

import { useEffect, useRef, useState } from "react";
import { Map as GoogleMap, AdvancedMarker, useMap } from "@vis.gl/react-google-maps";
import { useRoutes } from "@/hooks/useRoutes";

import { Bus, Loader2, Map as MapIcon } from "lucide-react";
import { MAP_OPTIONS, MAPS_MAP_ID, DEFAULT_CENTER } from "@/config/maps";
import { rtdb } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";

export interface BusLocation {
  busId: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  timestamp: number;
  status?: "active" | "idle" | "maintenance" | "offline";
  routeId?: string;
}

interface LiveMapProps {
  onMapClick?: (lat: number, lng: number) => void;
  selectedPin?: { lat: number; lng: number } | null;
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

function LiveMapInner({ onMapClick, selectedPin }: LiveMapProps) {
  const { routes } = useRoutes();
  const [buses, setBuses] = useState<Map<string, BusLocation>>(new Map<string, BusLocation>());
  const connected = true;

  useEffect(() => {
    const busesRef = ref(rtdb, "activeBuses");
    const unsubscribe = onValue(busesRef, (snapshot) => {
      const data = snapshot.val() as Record<string, BusLocation> | null;
      if (!data) {
        setBuses(new Map());
        return;
      }
      
      const newBuses = new Map<string, BusLocation>();
      Object.values(data).forEach((bus) => {
        if (bus.busId && bus.lat && bus.lng && bus.status !== "offline") {
          newBuses.set(bus.busId, bus);
        }
      });
      setBuses(newBuses);
    });

    return () => unsubscribe();
  }, []);

  const activeRouteId = Array.from(buses.values()).find((bus) => bus.routeId)?.routeId || "";
  const predefinedRoute = activeRouteId
    ? routes.find((route) => route.id === activeRouteId)?.waypoints.map((waypoint) => ({ lat: waypoint.lat, lng: waypoint.lng })) || []
    : [];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <GoogleMap
        mapId={MAPS_MAP_ID}
        defaultCenter={DEFAULT_CENTER}
        defaultZoom={14}
        style={{ height: "100%", width: "100%" }}
        onClick={(e) => {
          if (onMapClick && e.detail.latLng) {
            onMapClick(e.detail.latLng.lat, e.detail.latLng.lng);
          }
        }}
        {...MAP_OPTIONS}
      >
        <RoutePolyline path={predefinedRoute} />

        {/* Bus markers */}
        {Array.from(buses.values()).map(bus => {
          const color =
            bus.status && bus.status in STATUS_COLORS
              ? STATUS_COLORS[bus.status as keyof typeof STATUS_COLORS]
              : STATUS_COLORS.idle;
          const snappedHeading = Math.round(bus.heading / 5) * 5;
          return (
            <AdvancedMarker key={bus.busId} position={{ lat: bus.lat, lng: bus.lng }}>
              <div style={{ width: 48, height: 48, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ transform: `rotate(${snappedHeading}deg)`, transition: "transform 600ms" }}>
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2L20 20L12 16L4 20L12 2Z" fill={color} stroke="white" strokeWidth="1" strokeLinejoin="round" />
                  </svg>
                </div>
                <div style={{ position: "absolute", bottom: -4, right: -4, width: 10, height: 10, borderRadius: "50%", background: color, border: "1px solid #000" }} />
              </div>
            </AdvancedMarker>
          );
        })}

        {/* Selected pin */}
        {selectedPin && (
          <AdvancedMarker position={selectedPin}>
            <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#ef4444", border: "3px solid white", boxShadow: "0 2px 8px rgba(0,0,0,0.5)" }} />
          </AdvancedMarker>
        )}
      </GoogleMap>



      {/* Connection Status Overlay */}
      <div className="absolute bottom-6 right-6 z-[1000] flex items-center gap-2.5 bg-brand-dark/80 backdrop-blur-xl border border-white/5 rounded-2xl px-4 py-2.5 shadow-3xl overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full bg-white/5 opacity-20 pointer-events-none" />
        {connected ? (
          <>
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Live Infrastructure</span>
          </>
        ) : (
          <>
            <Loader2 className="w-3 h-3 text-red-500 animate-spin" />
            <span className="text-[10px] font-black uppercase tracking-widest text-red-500">Reconnecting...</span>
          </>
        )}
      </div>

      {buses.size > 0 && (
        <div className="absolute top-24 right-6 z-[1000] bg-brand-surface/90 backdrop-blur-xl border border-white/5 rounded-2xl px-5 py-3 shadow-3xl flex items-center gap-3">
          <Bus className="w-4 h-4 text-white/40" />
          <span className="text-[10px] font-black uppercase tracking-widest text-white/80">
            {buses.size} Active Node{buses.size !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {activeRouteId && (
        <div className="absolute bottom-6 left-6 z-[1000] bg-brand-surface/90 backdrop-blur-xl border border-white/5 rounded-2xl px-5 py-3 shadow-3xl flex items-center gap-3">
          <MapIcon className="w-4 h-4 text-white/20" />
          <span className="text-[10px] font-black uppercase tracking-widest text-white/80">
            Path: <span className="text-white ml-1">{routes.find(r => r.id === activeRouteId)?.name || "External"}</span>
          </span>
        </div>
      )}
    </div>
  );
}

export default LiveMapInner;
