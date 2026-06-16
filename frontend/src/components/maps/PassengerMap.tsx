"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import RouteTimelineSheet from "@/components/passenger/RouteTimelineSheet";
import { RouteStop, RouteData } from "@/hooks/useRoutes";
import { getDistanceMeters } from "@/lib/mapUtils";
import React from "react";
import { rtdb } from "@/lib/firebase";
import { ref, onValue, off } from "firebase/database";
import { buzzController } from "@/lib/audioUtils";
import { LocateFixed } from "lucide-react";
let L: any;
if (typeof window !== "undefined") {
  L = require("leaflet");
}
import "leaflet/dist/leaflet.css";

// Fix Leaflet default icon paths issue
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

export interface PassengerMapProps {
  targetStop: RouteStop;
  route: RouteData;
}

interface IncomingBusData {
  busId: string;
  routeId: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  timestamp: number;
  status: "active" | "maintenance" | "idle";
  currentStopIndex?: number;
  delayMinutes?: number;
}

const WALKING_KMH = 5;
const WALKING_M_PER_MIN = (WALKING_KMH * 1000) / 60;
const BUS_SPEED_FLOOR_KMH = 15;

const RIPPLE_KEYFRAMES = `
  @keyframes ripple {
    0% { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.5); }
    70% { box-shadow: 0 0 0 30px rgba(249, 115, 22, 0); }
    100% { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0); }
  }
  @keyframes passengerPulse {
    0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); }
    70% { box-shadow: 0 0 0 18px rgba(59, 130, 246, 0); }
    100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
  }
`;

function createBusIconHtml(heading: number, status: string, size = 48) {
  const colors: Record<string, string> = {
    active: "#10b981",
    maintenance: "#ef4444",
    idle: "#f59e0b",
  };
  const color = colors[status] || colors.idle;
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
}

function decodePolyline(str: string, precision: number = 5) {
  let index = 0, lat = 0, lng = 0, coordinates: [number, number][] = [], shift = 0, result = 0, byte = null, latitude_change, longitude_change, factor = Math.pow(10, precision);
  while (index < str.length) {
    byte = null; shift = 0; result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    shift = result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += latitude_change; lng += longitude_change;
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

// Map events handler
function MapControls({ passengerLocation, isCentered }: { passengerLocation: any, isCentered: boolean }) {
  const [useMap, setUseMap] = useState<any>(null);

  useEffect(() => {
    import('react-leaflet').then((mod) => {
      setUseMap(() => mod.useMap);
    });
  }, []);

  if (useMap) {
    const MapHook = () => {
      const map = useMap();
      useEffect(() => {
        if (isCentered && passengerLocation && map) {
          map.panTo([passengerLocation.lat, passengerLocation.lng]);
          map.setZoom(16);
        }
      }, [isCentered, passengerLocation, map]);
      return null;
    };
    return <MapHook />;
  }
  return null;
}

function PassengerMapInner({ targetStop, route }: PassengerMapProps) {
  const [buses, setBuses] = useState<Map<string, IncomingBusData>>(new Map());
  const [stopETAs, setStopETAs] = useState<Record<string, number>>({});
  const lastBuzzedStopIdRef = useRef<string | null>(null);

  const [passengerLocation, setPassengerLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isCentered, setIsCentered] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setPassengerLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const walkMinutesToTarget = useMemo(() => {
    if (!passengerLocation) return undefined;
    const dist = getDistanceMeters(passengerLocation, targetStop);
    return Math.ceil(dist / WALKING_M_PER_MIN);
  }, [passengerLocation, targetStop]);

  const decodedPath = useMemo(() => {
    if (route.polyline) return decodePolyline(route.polyline);
    return route.stops?.map(s => [s.lat, s.lng] as [number, number]) || [];
  }, [route.polyline, route.stops]);

  useEffect(() => {
    const busesRef = ref(rtdb, "activeBuses");
    const unsubscribe = onValue(busesRef, (snapshot) => {
      const data = snapshot.val() as Record<string, IncomingBusData>;
      if (!data) {
        setBuses(new Map());
        return;
      }

      const activeBuses = new Map<string, IncomingBusData>();
      Object.values(data).forEach((bus) => {
        const isFresh = Date.now() - bus.timestamp < 300000;
        if (bus.routeId === route.id && bus.status === "active" && isFresh) {
          activeBuses.set(bus.busId, bus);

          if (route.stops && route.stops.length > 0) {
            let closestStopIndex = bus.currentStopIndex !== undefined ? bus.currentStopIndex : 0;
            if (bus.currentStopIndex === undefined) {
              let minD = Infinity;
              route.stops.forEach((stop, idx) => {
                const d = getDistanceMeters({ lat: bus.lat, lng: bus.lng }, stop);
                if (d < minD) { minD = d; closestStopIndex = idx; }
              });
            }

            const busSpeedKmh = bus.speed > 0 ? bus.speed : BUS_SPEED_FLOOR_KMH;
            const mPerMin = (busSpeedKmh * 1000) / 60;
            const distToNextStop = getDistanceMeters({ lat: bus.lat, lng: bus.lng }, route.stops[closestStopIndex]) * 1.3;
            const busDelay = bus.delayMinutes || 0;
            const newStopETAs: Record<string, number> = {};

            let accumDistM = distToNextStop;
            newStopETAs[route.stops[closestStopIndex].id] = Math.ceil(accumDistM / mPerMin) + busDelay;

            for (let i = closestStopIndex + 1; i < route.stops.length; i++) {
              const segDist = getDistanceMeters(route.stops[i - 1], route.stops[i]) * 1.3;
              accumDistM += segDist + 125;
              newStopETAs[route.stops[i].id] = Math.ceil(accumDistM / mPerMin) + busDelay;
            }

            setStopETAs(prev => ({ ...prev, ...newStopETAs }));

            const busDist = getDistanceMeters({ lat: bus.lat, lng: bus.lng }, targetStop);
            if (busDist < 200 && lastBuzzedStopIdRef.current !== targetStop.id) {
              buzzController.playBuzz([300, 150, 300, 150, 500]);
              lastBuzzedStopIdRef.current = targetStop.id;
            }
          }
        }
      });
      setBuses(activeBuses);
    });
    return () => off(busesRef, "value", unsubscribe);
  }, [route.id, targetStop, route.stops]);

  const activePath = useMemo(() => {
    // simplified active polyline: just the full path for now since Leaflet rendering is simple
    return decodedPath;
  }, [decodedPath]);

  return (
    <>
      <style>{RIPPLE_KEYFRAMES}</style>
      <div className="absolute inset-0 z-0" onPointerDown={() => setIsCentered(false)}>
        {typeof window !== "undefined" && (
          <MapContainer
            center={[targetStop.lat, targetStop.lng]}
            zoom={15}
            style={{ width: "100%", height: "100%" }}
            zoomControl={false}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/">OSM</a>'
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            />
            
            <MapControls passengerLocation={passengerLocation} isCentered={isCentered} />

            {decodedPath.length > 0 && (
              <Polyline positions={decodedPath} pathOptions={{ color: '#9aa0a6', weight: 7, opacity: 0.8 }} />
            )}
            
            {activePath.length > 0 && Array.from(buses.values()).length > 0 && (
              <Polyline positions={activePath} pathOptions={{ color: '#3b82f6', weight: 7, opacity: 1.0 }} />
            )}

            {passengerLocation && (
              <Marker 
                position={[passengerLocation.lat, passengerLocation.lng]}
                icon={L.divIcon({
                  className: "passenger-icon",
                  html: `<div style="width:20px;height:20px;position:relative"><div style="position:absolute;inset:0;width:20px;height:20px;border-radius:50%;background:#3b82f6;border:3px solid white;z-index:10;animation:passengerPulse 2s infinite;box-shadow:0 0 0 0 rgba(59,130,246,0.7)"></div></div>`,
                  iconSize: [20, 20],
                  iconAnchor: [10, 10]
                })}
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

            {route.stops?.map((stop, i) => {
              const isTarget = stop.id === targetStop.id;
              const html = isTarget ? `
                <div class="relative flex flex-col items-center">
                  <div style="position:absolute; width:32px; height:32px; background:#f97316; border-radius:50%; animation: ripple 2s infinite"></div>
                  <div style="width:32px; height:32px; background:#f97316; border:4px solid #fb923c; border-radius:50%; z-index:10; display:flex; align-items:center; justify-content:center; box-shadow:0 0 15px rgba(0,0,0,0.3)">
                    <span style="color:white; font-weight:900; font-size:12px">${String.fromCharCode(65 + i)}</span>
                  </div>
                  <span style="margin-top:8px; padding:6px 16px; background:#1e293b; border:1px solid rgba(255,255,255,0.1); color:white; border-radius:12px; font-size:10px; white-space:nowrap; z-index:50; font-weight:900; text-transform:uppercase; letter-spacing:0.2em">
                    ${stop.shortName}
                  </span>
                </div>
              ` : `
                <div class="relative flex flex-col items-center" style="opacity:0.7; transform:scale(0.9)">
                  <div style="display:flex; align-items:center; justify-content:center; width:24px; height:24px; background:#f97316; border:2px solid #fb923c; border-radius:50%; box-shadow:0 4px 6px rgba(0,0,0,0.1)">
                    <span style="color:white; font-weight:900; font-size:10px">${String.fromCharCode(65 + i)}</span>
                  </div>
                  <span style="margin-top:4px; padding:2px 8px; background:rgba(30,41,59,0.8); color:white; border-radius:4px; font-size:8px; white-space:nowrap; opacity:0.6; font-weight:900; text-transform:uppercase; letter-spacing:0.1em">
                    ${stop.shortName}
                  </span>
                </div>
              `;

              return (
                <Marker 
                  key={`stop-${stop.id || i}`} 
                  position={[stop.lat, stop.lng]}
                  icon={L.divIcon({
                    className: "route-stop-icon",
                    html,
                    iconSize: [100, 100],
                    iconAnchor: [50, 20]
                  })}
                />
              );
            })}
          </MapContainer>
        )}
      </div>

      {passengerLocation && (
        <div className="absolute bottom-[80px] right-4 z-40">
          <button
            onClick={() => setIsCentered(true)}
            className={`flex items-center gap-2 px-4 py-3 rounded-2xl shadow-2xl transition-all duration-300 border active:scale-95 ${
              isCentered
                ? "bg-blue-500 text-white border-blue-400 opacity-70 scale-95"
                : "bg-brand-surface text-white border-white/10"
            }`}
          >
            <LocateFixed className="w-5 h-5" />
          </button>
        </div>
      )}

      <RouteTimelineSheet
        route={route}
        targetStopId={targetStop.id}
        activeBusId={null}
        stopETAs={stopETAs}
        walkMinutesToTarget={walkMinutesToTarget}
      />
    </>
  );
}

export default function PassengerMap(props: PassengerMapProps) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <PassengerMapInner {...props} />
    </div>
  );
}
