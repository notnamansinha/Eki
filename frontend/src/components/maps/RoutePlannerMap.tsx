"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
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

const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then((mod) => mod.Polyline), { ssr: false });

interface Stop {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lng: number;
}

interface RoutePlannerMapProps {
  stopsOnSegment: Stop[];
  polyline: string;
  routeColor: string;
  startStopId: string;
  endStopId: string;
  viaStopId?: string | null;
  onStopClick?: (stop: Stop) => void;
}

const DEFAULT_CENTER = { lat: 23.033, lng: 72.545 }; // Ahmedabad

// Polyline Decoder
function decodePolyline(str: string, precision: number = 5) {
  let index = 0, lat = 0, lng = 0, coordinates: [number, number][] = [], shift = 0, result = 0, byte = null, latitude_change, longitude_change, factor = Math.pow(10, precision);
  while (index < str.length) {
    byte = null; shift = 0; result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    shift = result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += latitude_change;
    lng += longitude_change;
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

// MapBounds hook
function MapBounds({ decodedPath }: { decodedPath: [number, number][] }) {
  const [useMap, setUseMap] = useState<any>(null);

  useEffect(() => {
    import('react-leaflet').then((mod) => {
      setUseMap(() => mod.useMap);
    });
  }, []);

  if (useMap) {
    const BoundsHook = () => {
      const map = useMap();
      useEffect(() => {
        if (decodedPath.length > 0 && map) {
          map.fitBounds(decodedPath as any, { padding: [40, 40] });
        }
      }, [decodedPath, map]);
      return null;
    };
    return <BoundsHook />;
  }
  return null;
}

function RoutePlannerMapInner({
  stopsOnSegment,
  polyline,
  routeColor,
  startStopId,
  endStopId,
  viaStopId,
  onStopClick,
}: RoutePlannerMapProps) {
  
  const decodedPath = polyline ? decodePolyline(polyline) : [];

  return (
    <div style={{ width: "100%", height: "100%" }}>
      {typeof window !== "undefined" && (
        <MapContainer
          center={[DEFAULT_CENTER.lat, DEFAULT_CENTER.lng]}
          zoom={13}
          style={{ width: "100%", height: "100%" }}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/">OSM</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />

          <MapBounds decodedPath={decodedPath} />

          {decodedPath.length > 0 && (
            <Polyline 
              positions={decodedPath} 
              pathOptions={{ color: routeColor, weight: 7, opacity: 0.9 }} 
            />
          )}

          {stopsOnSegment.map((stop, i) => {
            const isStart = stop.id === startStopId;
            const isEnd   = stop.id === endStopId;
            const isVia   = stop.id === viaStopId;
            const isTerminal = isStart || isEnd;

            const iconHtml = `
              <div class="flex flex-col items-center cursor-pointer group" style="transform: translateY(-50%)">
                <div style="
                    background: ${isStart ? "#22c55e" : isEnd ? "#ef4444" : isVia ? "#f59e0b" : "rgba(26,28,41,0.95)"};
                    border: 2px solid ${isTerminal || isVia ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.15)"};
                    color: #ffffff;
                    padding: 3px 10px;
                    border-radius: 999px;
                    font-size: 10px;
                    font-weight: 800;
                    letter-spacing: 0.1em;
                    white-space: nowrap;
                    margin-bottom: 6px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                    opacity: ${isTerminal || isVia ? 1 : 0};
                    transition: opacity 0.2s;
                    pointer-events: none;
                  ">
                  ${stop.shortName}
                </div>
                ${isTerminal ? `
                  <div style="position: relative">
                    <div style="
                        position: absolute;
                        inset: -8px;
                        border-radius: 50%;
                        background: ${isStart ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"};
                        animation: pulse 2s infinite;
                      "></div>
                    <div style="
                        width: 22px;
                        height: 22px;
                        border-radius: 50%;
                        background: ${isStart ? "#22c55e" : "#ef4444"};
                        border: 4px solid #0f1117;
                        box-shadow: 0 0 0 3px ${isStart ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"};
                        position: relative;
                        z-index: 10;
                      "></div>
                  </div>
                ` : `
                  <div style="
                      width: ${isVia ? "16px" : "12px"};
                      height: ${isVia ? "16px" : "12px"};
                      border-radius: 50%;
                      background: ${isVia ? "#f59e0b" : routeColor};
                      border: 3px solid #0f1117;
                      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
                      transition: transform 0.2s;
                    "></div>
                `}
              </div>
            `;

            return (
              <Marker
                key={`planner-stop-${stop.id}-${i}`}
                position={[stop.lat, stop.lng]}
                icon={L.divIcon({
                  className: 'planner-stop-icon',
                  html: iconHtml,
                  iconSize: [40, 40],
                  iconAnchor: [20, 20]
                })}
                eventHandlers={{
                  click: () => onStopClick?.(stop),
                }}
              />
            );
          })}
        </MapContainer>
      )}
    </div>
  );
}

export default function RoutePlannerMap(props: RoutePlannerMapProps) {
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <RoutePlannerMapInner {...props} />
    </div>
  );
}
