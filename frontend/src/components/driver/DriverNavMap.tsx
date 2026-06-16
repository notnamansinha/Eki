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

interface Props {
  driverLocation: { lat: number; lng: number; heading: number } | null;
  selectedRouteId?: string;
}

function Recenter({ location }: { location: { lat: number, lng: number } }) {
  const [useMap, setUseMap] = useState<any>(null);

  useEffect(() => {
    import('react-leaflet').then((mod) => {
      setUseMap(() => mod.useMap);
    });
  }, []);

  if (useMap) {
    const RecenterHook = () => {
      const map = useMap();
      useEffect(() => {
        if (map) {
          map.panTo([location.lat, location.lng]);
        }
      }, [map, location]);
      return null;
    };
    return <RecenterHook />;
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

function DriverNavMapInner({ driverLocation, selectedRouteId }: Props) {
  const { routes } = useRoutes();
  const [assignedPath, setAssignedPath] = useState<{lat: number, lng: number}[]>([]);
  const [routeResult, setRouteResult] = useState<any | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // Fetch assigned path route
  useEffect(() => {
    if (selectedRouteId && routes.length > 0) {
      const route = routes.find((r) => r.id === selectedRouteId);
      if (route && route.waypoints.length >= 2) {
        setAssignedPath(route.waypoints.map(w => ({ lat: w.lat, lng: w.lng })));
      }
    } else {
      setAssignedPath([]);
      setRouteResult(null);
    }
  }, [selectedRouteId, routes]);

  const defaultCenter = driverLocation || { lat: 23.0225, lng: 72.5714 };

  return (
    <div className="relative h-full w-full">
      {typeof window !== "undefined" && (
        <MapContainer
          center={[defaultCenter.lat, defaultCenter.lng]}
          zoom={16}
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/">OSM</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />

          {driverLocation && <Recenter location={driverLocation} />}

          {/* Driver Location */}
          {driverLocation && (
            <Marker 
              position={[driverLocation.lat, driverLocation.lng]}
              icon={L.divIcon({
                className: "custom-bus-icon",
                html: createBusIconHtml(driverLocation.heading, "active", 48),
                iconSize: [48, 48],
                iconAnchor: [24, 24]
              })}
            />
          )}

          {/* Dynamic Route Rendering without Google Directions */}
          {assignedPath.length > 0 && (
            <Polyline 
              positions={assignedPath.map(p => [p.lat, p.lng])}
              pathOptions={{ color: '#2563EB', weight: 6, opacity: 0.8 }}
            />
          )}
        </MapContainer>
      )}

      {/* Real-time Directions Panel */}
      <DirectionsPanel 
        result={routeResult} 
        isOpen={isPanelOpen} 
        onToggle={() => setIsPanelOpen(!isPanelOpen)} 
      />
    </div>
  );
}

export default dynamic(() => Promise.resolve(DriverNavMapInner), { ssr: false });
