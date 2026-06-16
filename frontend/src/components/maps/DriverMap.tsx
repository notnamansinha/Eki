"use client";

import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { LocateFixed as GPS, ArrowLeft, ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";
let L: any;
if (typeof window !== "undefined") {
  L = require("leaflet");
}
import "leaflet/dist/leaflet.css";

import { RouteData } from "@/hooks/useRoutes";
import { getDistanceMeters } from "@/lib/mapUtils";
import RoutePreviewCards from "@/components/maps/RoutePreviewCards";
import RouteTimelineSheet from "@/components/passenger/RouteTimelineSheet";
import { rtdb } from "@/lib/firebase";
import { ref, update } from "firebase/database";

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

export interface DriverMapProps {
  route: RouteData;
  socketRef: React.RefObject<any>;
  busId: string;
  driverLocation: { lat: number; lng: number; heading: number } | null;
  onEndShift?: () => void;
  isTracking?: boolean;
  selectedRouteIds?: string[];
  onStopIndexChange?: (index: number) => void;
}

const RIPPLE_KEYFRAMES = `
  @keyframes ripple {
    0% { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.5); }
    70% { box-shadow: 0 0 0 30px rgba(249, 115, 22, 0); }
    100% { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0); }
  }
`;

const SELECTED_ROUTE_COLOR = "#4285F4";
type NavPhase = "preview" | "navigating";

// Polyline Decoder
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

function MapControls({ driverLocation, isCentered, navPhase }: { driverLocation: any, isCentered: boolean, navPhase: string }) {
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
        if (isCentered && driverLocation && map && navPhase === "navigating") {
          map.panTo([driverLocation.lat, driverLocation.lng]);
          map.setZoom(18);
        }
      }, [isCentered, driverLocation, map, navPhase]);
      return null;
    };
    return <MapHook />;
  }
  return null;
}

function DriverMapInner({ route, driverLocation, socketRef, busId, onEndShift, isTracking, selectedRouteIds, onStopIndexChange }: DriverMapProps) {
  const stops = route.stops || [];
  const [currentStopIndex, setCurrentStopIndex] = useState(0);
  const nextStop = stops[currentStopIndex] ?? stops[stops.length - 1];

  const [delayMinutes, setDelayMinutes] = useState(0);
  const lastDelayPushRef = useRef(0);

  const pushDelay = useCallback((addMin: number) => {
    setDelayMinutes(prev => {
      const next = Math.max(0, prev + addMin);
      const now = Date.now();
      if (now - lastDelayPushRef.current > 500) {
        lastDelayPushRef.current = now;
        const routesToUpdate = selectedRouteIds?.length ? selectedRouteIds : [route.id];
        routesToUpdate.forEach(routeId => {
          const busRef = ref(rtdb, `activeBuses/${busId}_${routeId}`);
          update(busRef, { delayMinutes: next }).catch(console.error);
        });
      }
      return next;
    });
  }, [busId, selectedRouteIds, route.id]);

  const handleManualNextStop = useCallback(() => {
    setCurrentStopIndex(i => {
      const nextIdx = Math.min(i + 1, stops.length - 1);
      if (onStopIndexChange) onStopIndexChange(nextIdx);
      return nextIdx;
    });
  }, [stops.length, onStopIndexChange]);

  useEffect(() => {
    if (!driverLocation || !nextStop || currentStopIndex >= stops.length - 1) return;
    const dist = getDistanceMeters(
      { lat: driverLocation.lat, lng: driverLocation.lng },
      { lat: nextStop.lat, lng: nextStop.lng }
    );
    if (dist < 80) {
      setCurrentStopIndex(i => {
        const nextIdx = Math.min(i + 1, stops.length - 1);
        if (onStopIndexChange) onStopIndexChange(nextIdx);
        return nextIdx;
      });
    }
  }, [driverLocation?.lat, driverLocation?.lng, nextStop?.lat, nextStop?.lng, currentStopIndex, stops.length, onStopIndexChange]);

  const [navPhase, setNavPhase] = useState<NavPhase>("preview");
  const [isCentered, setIsCentered] = useState(true);
  const [displayDist, setDisplayDist] = useState(0);
  const [displayDur, setDisplayDur] = useState(0);

  useEffect(() => {
    if (navPhase !== "navigating" || !driverLocation || !nextStop) return;

    const distM = getDistanceMeters(
      { lat: driverLocation.lat, lng: driverLocation.lng },
      { lat: nextStop.lat, lng: nextStop.lng }
    );

    const speedKmh = (driverLocation as any).speed > 0 ? (driverLocation as any).speed : 25;
    const speedMs = speedKmh / 3.6;
    const durationSec = speedMs > 0 ? distM / speedMs : 0;

    const roundedDist = Math.round(distM / 10) * 10;
    const roundedDur  = Math.round(durationSec / 10) * 10;

    setDisplayDist(prev => prev === roundedDist ? prev : roundedDist);
    setDisplayDur(prev  => prev === roundedDur  ? prev : roundedDur);
  }, [navPhase, driverLocation?.lat, driverLocation?.lng, nextStop?.lat, nextStop?.lng]);

  const defaultCenter = driverLocation || (stops.length ? { lat: stops[0].lat, lng: stops[0].lng } : { lat: 23.03, lng: 72.55 });
  
  const handleRecenter = useCallback(() => setIsCentered(true), []);
  const handlePointerDown = useCallback(() => setIsCentered(false), []);
  const handleStartNavigation = useCallback(async () => {
    setNavPhase("navigating");
    setIsCentered(true);
    setDelayMinutes(0);
  }, []);
  const handleBackToPreview = useCallback(() => setNavPhase("preview"), []);

  const upcomingETAs = useMemo(() => {
    const etaMap: Record<string, number> = {};
    let accumTime = displayDur;
    if (nextStop?.id) {
      etaMap[nextStop.id] = Math.round((accumTime / 60) + delayMinutes);
      for (let i = currentStopIndex + 1; i < stops.length; i++) {
        const dist = (getDistanceMeters(stops[i - 1], stops[i]) * 1.3) + 125;
        accumTime += (dist / 250) * 60;
        etaMap[stops[i].id] = Math.round((accumTime / 60) + delayMinutes);
      }
    }
    return etaMap;
  }, [displayDur, delayMinutes, nextStop?.id, currentStopIndex, stops]);

  const decodedPath = useMemo(() => {
    if (route.polyline) return decodePolyline(route.polyline);
    return stops.map(s => [s.lat, s.lng] as [number, number]);
  }, [route.polyline, stops]);

  const previewRouteMock = [{
    duration: 2700,
    durationText: "45 mins",
    distanceMeters: 12000,
    distanceText: "12 km",
    summary: "Standard Route",
    overview_polyline: "",
  }];

  return (
    <>
      <style>{RIPPLE_KEYFRAMES}</style>
      <div className="absolute inset-0 z-0" onPointerDown={handlePointerDown} onTouchStart={handlePointerDown}>
        {typeof window !== 'undefined' && (
          <MapContainer center={[defaultCenter.lat, defaultCenter.lng]} zoom={14} style={{ width: "100%", height: "100%" }} zoomControl={false}>
            <TileLayer attribution='&copy; OSM' url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
            <MapControls driverLocation={driverLocation} isCentered={isCentered} navPhase={navPhase} />
            
            {decodedPath.length > 0 && (
              <Polyline positions={decodedPath} pathOptions={{ color: '#9aa0a6', weight: 6, opacity: 0.9 }} />
            )}

            {navPhase === "navigating" && decodedPath.length > 0 && (
              <Polyline positions={decodedPath} pathOptions={{ color: '#3b82f6', weight: 6, opacity: 1 }} />
            )}

            {stops.map((stop, i) => (
              <Marker key={`stop-${stop.id || i}`} position={[stop.lat, stop.lng]} icon={L.divIcon({
                className: "driver-stop-icon",
                html: i === currentStopIndex ? `
                  <div class="relative flex flex-col items-center">
                    <div style="position:absolute; width:32px; height:32px; background:#f97316; border-radius:50%; animation: ripple 2s infinite"></div>
                    <div style="width:32px; height:32px; background:#f97316; border:4px solid #fb923c; border-radius:50%; z-index:10; display:flex; align-items:center; justify-content:center; box-shadow:0 0 15px rgba(0,0,0,0.3)">
                      <span style="color:white; font-weight:900; font-size:12px">${String.fromCharCode(65 + i)}</span>
                    </div>
                    <span style="margin-top:8px; padding:4px 12px; background:#1e293b; border:1px solid rgba(255,255,255,0.1); color:white; border-radius:12px; font-size:10px; white-space:nowrap; z-index:50; font-weight:900; text-transform:uppercase; letter-spacing:0.2em">
                      ${stop.shortName}
                    </span>
                  </div>
                ` : i < currentStopIndex ? `
                  <div style="display:flex; align-items:center; justify-content:center; width:24px; height:24px; background:rgba(249,115,22,0.6); border:2px solid rgba(251,146,60,0.5); border-radius:50%; box-shadow:0 4px 6px rgba(0,0,0,0.1)">
                    <span style="color:white; font-weight:900; font-size:10px">${String.fromCharCode(65 + i)}</span>
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
                `,
                iconSize: [100, 100],
                iconAnchor: [50, 20]
              })} />
            ))}

            {driverLocation && (
              <Marker position={[driverLocation.lat, driverLocation.lng]} icon={L.divIcon({
                className: "driver-bus-icon",
                html: `
                  <div style="width:48px;height:48px;position:relative;display:flex;align-items:center;justify-content:center;">
                    <div style="position:absolute;inset:0;border-radius:50%;background:rgba(66,133,244,0.2);animation:ping 1s infinite;opacity:0.6"></div>
                    <div style="transform:rotate(${Math.round(driverLocation.heading / 5) * 5}deg);transition:transform 600ms;z-index:10;">
                      <svg width="34" height="34" viewBox="0 0 24 24" fill="none"><path d="M12 2L20 20L12 16L4 20L12 2Z" fill="${SELECTED_ROUTE_COLOR}" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>
                    </div>
                    <div style="position:absolute;bottom:-4px;right:-4px;width:10px;height:10px;border-radius:50%;background:${SELECTED_ROUTE_COLOR};border:2px solid #1a1a2e"></div>
                  </div>
                `,
                iconSize: [48, 48],
                iconAnchor: [24, 24]
              })} />
            )}
          </MapContainer>
        )}
      </div>

      {navPhase === "navigating" && (
        <div className="absolute left-4 top-10 z-40">
          <button onClick={handleBackToPreview} className="p-4 rounded-full shadow-2xl bg-brand-surface border border-white/10 text-white active:scale-95 transition-all">
            <ArrowLeft className="w-5 h-5" />
          </button>
        </div>
      )}

      <div className="absolute right-4 top-10 z-40">
        <button onClick={handleRecenter} className={`p-4 rounded-full shadow-2xl transition-all duration-300 border active:scale-95 ${isCentered ? "bg-blue-500 text-white border-blue-400 opacity-60" : "bg-brand-surface text-white border-white/10 hover:bg-white/10"}`}>
          <GPS className="w-5 h-5" />
        </button>
      </div>

      <div className="absolute bottom-[70px] left-0 right-0 z-50">
        {navPhase === "preview" ? (
          <RoutePreviewCards
            routes={previewRouteMock}
            selectedIndex={0}
            onSelect={() => {}}
            onStart={handleStartNavigation}
            isLoading={false}
          />
        ) : (
          <RouteTimelineSheet
            route={route}
            targetStopId={stops[stops.length - 1]?.id || ""}
            activeBusId={busId}
            stopETAs={upcomingETAs}
            headerContent={
              <div className="flex items-center w-full justify-between mt-2 pl-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
                  <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest leading-none">Transmitting</span>
                  {delayMinutes > 0 && <span className="ml-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[9px] font-black uppercase tracking-widest">+{delayMinutes} MIN</span>}
                </div>
                {onEndShift && isTracking && <button onClick={(e) => { e.stopPropagation(); onEndShift(); }} className="h-8 px-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-[9px] font-black uppercase tracking-[0.2em] hover:bg-red-500 hover:text-white transition-all pointer-events-auto">End Shift</button>}
              </div>
            }
            bottomControls={
              <div className="flex items-center gap-2 justify-between w-full">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-black text-white/30 uppercase tracking-widest mr-1">Delay</span>
                  <button onClick={() => pushDelay(-2)} className="h-9 w-12 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-black hover:bg-blue-500/30 active:scale-90 transition-all flex items-center justify-center">-2</button>
                  <button onClick={() => pushDelay(-1)} className="h-9 w-12 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-black hover:bg-blue-500/30 active:scale-90 transition-all flex items-center justify-center">-1</button>
                  <div className="px-2 min-w-[36px] text-center">
                    <span className={`text-sm font-black ${delayMinutes > 0 ? 'text-amber-400' : 'text-white/20'}`}>{delayMinutes > 0 ? `+${delayMinutes}` : '0'}</span>
                    <div className="text-[7px] text-white/20 uppercase tracking-widest">min</div>
                  </div>
                  <button onClick={() => pushDelay(1)} className="h-9 w-12 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-black hover:bg-amber-500/30 active:scale-90 transition-all flex items-center justify-center">+1</button>
                  <button onClick={() => pushDelay(2)} className="h-9 w-12 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-black hover:bg-amber-500/30 active:scale-90 transition-all flex items-center justify-center">+2</button>
                </div>
                {currentStopIndex < stops.length - 1 && (
                  <button onClick={handleManualNextStop} className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-white/5 border border-white/10 text-white/60 text-[9px] font-black uppercase tracking-widest hover:bg-white/10 active:scale-90 transition-all">
                    Next Stop
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            }
          />
        )}
      </div>
    </>
  );
}

export default function DriverMap(props: DriverMapProps) {
  return <div style={{ position: "relative", width: "100%", height: "100%" }}><DriverMapInner {...props} /></div>;
}
