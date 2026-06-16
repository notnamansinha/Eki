"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { useRoutes } from "@/hooks/useRoutes";
import DirectionsPanel from "@/components/shared/DirectionsPanel";
import { Bus, Wifi, WifiOff, Map as MapIcon, Loader2 } from "lucide-react";
let L: any;
if (typeof window !== "undefined") {
  L = require("leaflet");
}
import "leaflet/dist/leaflet.css";

// Fix Leaflet default icon paths issue with Webpack/Next
if (typeof window !== "undefined" && L) {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});
}

// Leaflet needs to be dynamically imported or we get window is not defined
const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then((mod) => mod.Polyline), { ssr: false });

export interface BusLocation {
  busId: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  timestamp: number;
  status: "active" | "idle" | "maintenance";
  routeId?: string;
}

interface LiveMapProps {
  onMapClick?: (lat: number, lng: number) => void;
  selectedPin?: { lat: number; lng: number } | null;
}

// Map events handler
function MapClickHandler({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) {
  const [useMapEvents, setUseMapEvents] = useState<any>(null);

  useEffect(() => {
    import('react-leaflet').then((mod) => {
      setUseMapEvents(() => mod.useMapEvents);
    });
  }, []);

  if (useMapEvents) {
    const MapEventsHook = () => {
      useMapEvents({
        click(e: any) {
          if (onMapClick) onMapClick(e.latlng.lat, e.latlng.lng);
        },
      });
      return null;
    };
    return <MapEventsHook />;
  }
  return null;
}

const STATUS_COLORS: Record<string, string> = {
  active: "#10b981",
  maintenance: "#ef4444",
  idle: "#f59e0b",
};

// Generate SVG icon string for Leaflet divIcon
const createBusIconHtml = (heading: number, status: string, size = 48) => {
  const color = STATUS_COLORS[status] || STATUS_COLORS.idle;
  const snappedHeading = Math.round(heading / 5) * 5;
  
  return `
    <div style="width:${size}px; height:${size}px; position:relative; display:flex; align-items:center; justify-content:center;">
      <div style="transform: rotate(${snappedHeading}deg); transition: transform 600ms;">
        <svg width="${size * 0.7}" height="${size * 0.7}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L20 20L12 16L4 20L12 2Z" fill="${color}" stroke="white" stroke-width="1" stroke-linejoin="round"/>
        </svg>
      </div>
      <div style="position:absolute; bottom:-4px; right:-4px; width:10px; height:10px; border-radius:50%; background-color:${color}; border:1px solid #000;"></div>
    </div>
  `;
};

function LiveMapInner({ onMapClick, selectedPin }: LiveMapProps) {
  const { routes } = useRoutes();
  const [buses, setBuses] = useState<Map<string, BusLocation>>(new Map());
  const socketRef = useRef<any>(null);
  const [connected, setConnected] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const destination = useMemo(() => {
    return selectedPin ? { lat: selectedPin.lat, lng: selectedPin.lng } : null;
  }, [selectedPin]);

  useEffect(() => {
    import("socket.io-client").then(({ io }) => {
      const socket = io(process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000", {
        transports: ["websocket"],
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        setConnected(true);
        socket.emit("passenger:join");
      });
      socket.on("disconnect", () => setConnected(false));
      socket.on("bus:location-update", (data: BusLocation) => {
        setBuses((prev) => new Map(prev).set(data.busId, data));
      });
      socket.on("bus:stop-tracking", ({ busId }: { busId: string }) => {
        setBuses((prev) => {
          const next = new Map(prev);
          next.delete(busId);
          return next;
        });
      });
    });
    return () => { socketRef.current?.disconnect(); };
  }, []);

  const [predefinedRoute, setPredefinedRoute] = useState<{lat: number, lng: number}[]>([]);
  const [activeRoutePolyline, setActiveRoutePolyline] = useState<string>("");
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);

  useEffect(() => {
    const activeBus = Array.from(buses.values()).find(b => b.routeId);
    const newRouteId = activeBus?.routeId || "";
    
    if (newRouteId !== activeRouteId && newRouteId) {
      setActiveRouteId(newRouteId);
      const route = routes.find(r => r.id === newRouteId);
      if (route) {
        const coords = route.waypoints.map(w => ({ lat: w.lat, lng: w.lng }));
        setPredefinedRoute(coords);
        setActiveRoutePolyline(route.polyline || "");
      }
    } else if (!newRouteId && predefinedRoute.length > 0) {
      setPredefinedRoute([]);
      setActiveRoutePolyline("");
      setActiveRouteId(null);
    }
  }, [buses, activeRouteId, routes, predefinedRoute.length]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {typeof window !== "undefined" && (
        <MapContainer
          center={[23.0347, 72.5483]}
          zoom={14}
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/">OSM</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />

          <MapClickHandler onMapClick={onMapClick} />

          {predefinedRoute.length > 0 && (
            <Polyline 
               positions={predefinedRoute.map(wp => [wp.lat, wp.lng])} 
               pathOptions={{ color: '#2563EB', weight: 6, opacity: 0.8 }} 
            />
          )}

          {Array.from(buses.values()).map(bus => (
            <Marker 
              key={bus.busId} 
              position={[bus.lat, bus.lng]}
              icon={L.divIcon({
                className: "custom-bus-icon",
                html: createBusIconHtml(bus.heading, bus.status, 48),
                iconSize: [48, 48],
                iconAnchor: [24, 24]
              })}
            />
          ))}

          {selectedPin && (
            <Marker position={[selectedPin.lat, selectedPin.lng]} />
          )}
        </MapContainer>
      )}

      <DirectionsPanel 
        result={null} 
        isOpen={isPanelOpen} 
        onToggle={() => setIsPanelOpen(!isPanelOpen)} 
      />

      {/* Connection Status Overlay - Refined Block */}
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

      {/* Active Route Identifier */}
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

export default dynamic(() => Promise.resolve(LiveMapInner), { ssr: false });
