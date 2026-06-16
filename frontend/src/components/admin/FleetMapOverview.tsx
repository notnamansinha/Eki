"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRoutes } from "@/hooks/useRoutes";
import DirectionsPanel from "@/components/shared/DirectionsPanel";
let L: any;
if (typeof window !== "undefined") {
  L = require("leaflet");
}
import "leaflet/dist/leaflet.css";

if (typeof window !== "undefined" && L) {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});
}

const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then((mod) => mod.Polyline), { ssr: false });

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

// Generate SVG icon string for Leaflet divIcon
const createBusIconHtml = (busId: string, heading: number, status: string, isSelected: boolean, size = 48) => {
  const color = STATUS_COLORS[status] || STATUS_COLORS.idle;
  const snappedHeading = Math.round(heading / 5) * 5;
  const s = isSelected ? 48 : 40;
  
  return `
    <div class="transition-transform duration-300 ${isSelected ? 'scale-125' : ''}" style="width:${s}px; height:${s}px; position:relative; display:flex; align-items:center; justify-content:center;">
      <div style="transform: rotate(${snappedHeading}deg); transition: transform 600ms;">
        <svg width="${s * 0.7}" height="${s * 0.7}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L20 20L12 16L4 20L12 2Z" fill="${color}" stroke="white" stroke-width="1" stroke-linejoin="round"/>
        </svg>
      </div>
      <div style="position:absolute; bottom:-4px; right:-4px; width:10px; height:10px; border-radius:50%; background-color:${color}; border:1px solid #000;"></div>
      ${isSelected ? `
        <div class="absolute -top-8 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg whitespace-nowrap">
          Selected: ${busId}
        </div>
      ` : ''}
    </div>
  `;
};

// Map events handler
function MapClickHandler({ onClick }: { onClick?: () => void }) {
  const [useMapEvents, setUseMapEvents] = useState<any>(null);

  useEffect(() => {
    import('react-leaflet').then((mod) => {
      setUseMapEvents(() => mod.useMapEvents);
    });
  }, []);

  if (useMapEvents) {
    const MapEventsHook = () => {
      useMapEvents({
        click() {
          if (onClick) onClick();
        },
      });
      return null;
    };
    return <MapEventsHook />;
  }
  return null;
}

function FleetMapOverviewInner() {
  const { routes } = useRoutes();
  const [buses, setBuses] = useState<Map<string, BusLocation>>(new Map());

  useEffect(() => {
    let socket: any = null;
    import("socket.io-client").then(({ io }) => {
      socket = io(process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000", {
        transports: ["websocket"],
      });

      socket.emit("admin:join");
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

    return () => { socket?.disconnect(); };
  }, []);

  const [predefinedRoute, setPredefinedRoute] = useState<{lat: number, lng: number}[]>([]);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [routeResult, setRouteResult] = useState<any>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  useEffect(() => {
    const targetBus = selectedBusId ? buses.get(selectedBusId) : null;
    const newRouteId = targetBus?.routeId || "";

    if (newRouteId !== activeRouteId && newRouteId) {
      setActiveRouteId(newRouteId);
      const route = routes.find(r => r.id === newRouteId);
      if (route) {
         setPredefinedRoute(route.waypoints.map(w => ({ lat: w.lat, lng: w.lng })));
      }
    } else if (!newRouteId && predefinedRoute.length > 0) {
      setPredefinedRoute([]);
      setActiveRouteId(null);
    }
  }, [buses, selectedBusId, activeRouteId, routes, predefinedRoute.length]);

  return (
    <div className="relative w-full h-full">
      {typeof window !== 'undefined' && (
        <MapContainer
          center={[23.0347, 72.5483]}
          zoom={14}
          style={{ height: '100%', width: '100%', position: 'absolute', inset: 0 }}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/">OSM</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />

          <MapClickHandler onClick={() => setSelectedBusId(null)} />

          {/* Dynamic Route Line */}
          {predefinedRoute.length > 0 && (
            <Polyline 
               positions={predefinedRoute.map(wp => [wp.lat, wp.lng])} 
               pathOptions={{ color: '#2563EB', weight: 6, opacity: 0.8 }} 
            />
          )}

          {Array.from(buses.values()).map((bus) => (
            <Marker 
              key={bus.busId} 
              position={[bus.lat, bus.lng]}
              icon={L.divIcon({
                className: "custom-bus-icon",
                html: createBusIconHtml(bus.busId, bus.heading, bus.status, selectedBusId === bus.busId),
                iconSize: [48, 48],
                iconAnchor: [24, 24]
              })}
              eventHandlers={{
                click: () => {
                  setSelectedBusId(bus.busId);
                  setIsPanelOpen(true);
                }
              }}
            />
          ))}
        </MapContainer>
      )}

      {/* Admin Side Directions View - Mocked since we have no DirectionsResult */}
      {selectedBusId && routeResult && (
        <DirectionsPanel 
          result={routeResult} 
          isOpen={isPanelOpen} 
          onToggle={() => setIsPanelOpen(!isPanelOpen)} 
        />
      )}
    </div>
  );
}

export default dynamic(() => Promise.resolve(FleetMapOverviewInner), { ssr: false });
