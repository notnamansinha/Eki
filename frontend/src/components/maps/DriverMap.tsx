"use client";

import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Map as GoogleMap, AdvancedMarker, useMap } from "@vis.gl/react-google-maps";
import { LocateFixed as GPS, ArrowLeft, ChevronRight, Navigation } from "lucide-react";
import { RouteData } from "@/hooks/useRoutes";
import { getDistanceMeters } from "@/lib/mapUtils";
import RouteTimelineSheet from "@/components/passenger/RouteTimelineSheet";
import { rtdb } from "@/lib/firebase";
import { ref, update } from "firebase/database";
import { MAP_OPTIONS, MAPS_MAP_ID } from "@/config/maps";

export interface DriverMapProps {
  route: RouteData;
  busId: string;
  driverLocation: { lat: number; lng: number; heading: number } | null;
  onEndShift?: () => void;
  isTracking?: boolean;
  selectedRouteIds?: string[];
  onStopIndexChange?: (index: number) => void;
  onStartTracking?: () => void;
  canStartTracking?: boolean;
}

const SELECTED_ROUTE_COLOR = "#4285F4";
type NavPhase = "preview" | "navigating";

function decodePolyline(str: string, precision: number = 5) {
  let index = 0, lat = 0, lng = 0, coordinates: { lat: number; lng: number }[] = [], shift = 0, result = 0, byte: number | null = null, latitude_change: number, longitude_change: number, factor = Math.pow(10, precision);
  while (index < str.length) {
    byte = null; shift = 0; result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    shift = result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += latitude_change; lng += longitude_change;
    coordinates.push({ lat: lat / factor, lng: lng / factor });
  }
  return coordinates;
}

function RoutePolylines({ decodedPath, isNavigating }: { decodedPath: { lat: number; lng: number }[], isNavigating: boolean }) {
  const map = useMap();
  const greyLineRef = useRef<google.maps.Polyline | null>(null);
  const blueLineRef  = useRef<google.maps.Polyline | null>(null);

  useEffect(() => {
    if (!map || decodedPath.length === 0) return;

    greyLineRef.current = new google.maps.Polyline({
      path: decodedPath,
      strokeColor: "#9aa0a6",
      strokeWeight: 6,
      strokeOpacity: 0.9,
      map,
    });

    if (isNavigating) {
      blueLineRef.current = new google.maps.Polyline({
        path: decodedPath,
        strokeColor: "#3b82f6",
        strokeWeight: 6,
        strokeOpacity: 1,
        map,
      });
    }

    return () => {
      greyLineRef.current?.setMap(null);
      blueLineRef.current?.setMap(null);
    };
  }, [map, decodedPath, isNavigating]);

  return null;
}

function MapCenterer({ target, isCentered, navPhase }: { target: { lat: number; lng: number; heading: number } | null, isCentered: boolean, navPhase: string }) {
  const map = useMap();
  useEffect(() => {
    if (isCentered && target && map && navPhase === "navigating") {
      map.panTo({ lat: target.lat, lng: target.lng });
      map.setZoom(18);
    }
  }, [isCentered, target, map, navPhase]);
  return null;
}

function DriverMapInner({ route, driverLocation, busId, onEndShift, isTracking, selectedRouteIds, onStopIndexChange, onStartTracking, canStartTracking }: DriverMapProps) {
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

  const defaultCenter = driverLocation
    ? { lat: driverLocation.lat, lng: driverLocation.lng }
    : (stops.length ? { lat: stops[0].lat, lng: stops[0].lng } : { lat: 23.03, lng: 72.55 });

  const handleRecenter = useCallback(() => setIsCentered(true), []);
  const handlePointerDown = useCallback(() => setIsCentered(false), []);
  const handleStartNavigation = useCallback(async () => {
    if (!canStartTracking) {
      alert("Please select a Vehicle and Operator in the Transmitter Controls first.");
      return;
    }
    if (onStartTracking) {
      onStartTracking();
    }
    setNavPhase("navigating");
    setIsCentered(true);
    setDelayMinutes(0);
  }, [canStartTracking, onStartTracking]);
  const handleBackToPreview = useCallback(() => setNavPhase("preview"), []);

  useEffect(() => {
    if (isTracking) {
      setNavPhase("navigating");
      setIsCentered(true);
      setDelayMinutes(0);
    } else {
      setNavPhase("preview");
    }
  }, [isTracking]);

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
    return stops.map(s => ({ lat: s.lat, lng: s.lng }));
  }, [route.polyline, stops]);

  const snappedHeading = driverLocation ? Math.round(driverLocation.heading / 5) * 5 : 0;

  return (
    <>
      <div className="absolute inset-0 z-0" onPointerDown={handlePointerDown} onTouchStart={handlePointerDown}>
        <GoogleMap
          mapId={MAPS_MAP_ID}
          defaultCenter={defaultCenter}
          defaultZoom={14}
          style={{ width: "100%", height: "100%" }}
          {...MAP_OPTIONS}
        >
          <MapCenterer target={driverLocation} isCentered={isCentered} navPhase={navPhase} />
          <RoutePolylines decodedPath={decodedPath} isNavigating={navPhase === "navigating"} />

          {/* Stop markers */}
          {stops.map((stop, i) => (
            <AdvancedMarker key={`stop-${stop.id || i}`} position={{ lat: stop.lat, lng: stop.lng }}>
              {i === currentStopIndex ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ position: "absolute", width: 28, height: 28, background: "var(--accent)", borderRadius: "50%", animation: "ripple 2s infinite" }} />
                  <div style={{ width: 28, height: 28, background: "var(--accent)", border: "3px solid #fb923c", borderRadius: "50%", zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 12px rgba(250,93,41,0.3)" }}>
                    <span style={{ color: "white", fontWeight: 800, fontSize: 11 }}>{String.fromCharCode(65 + i)}</span>
                  </div>
                  <span style={{ marginTop: 6, padding: "3px 10px", background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "var(--text-primary)", borderRadius: 8, fontSize: 9, whiteSpace: "nowrap", zIndex: 50, fontWeight: 700 }}>
                    {stop.shortName}
                  </span>
                </div>
              ) : i < currentStopIndex ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, background: "rgba(250,93,41,0.5)", border: "2px solid rgba(251,146,60,0.4)", borderRadius: "50%" }}>
                  <span style={{ color: "white", fontWeight: 800, fontSize: 9 }}>{String.fromCharCode(65 + i)}</span>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", opacity: 0.7 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, background: "var(--accent)", border: "2px solid #fb923c", borderRadius: "50%" }}>
                    <span style={{ color: "white", fontWeight: 800, fontSize: 9 }}>{String.fromCharCode(65 + i)}</span>
                  </div>
                  <span style={{ marginTop: 3, padding: "1px 6px", background: "var(--surface-2)", color: "var(--text-tertiary)", borderRadius: 4, fontSize: 8, whiteSpace: "nowrap", fontWeight: 600 }}>
                    {stop.shortName}
                  </span>
                </div>
              )}
            </AdvancedMarker>
          ))}

          {/* Driver bus marker */}
          {driverLocation && (
            <AdvancedMarker position={{ lat: driverLocation.lat, lng: driverLocation.lng }}>
              <div style={{ width: 44, height: 44, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(66,133,244,0.15)", animation: "ping 1s infinite", opacity: 0.6 }} />
                <div style={{ transform: `rotate(${snappedHeading}deg)`, transition: "transform 600ms", zIndex: 10 }}>
                  <Navigation size={30} fill={SELECTED_ROUTE_COLOR} color="white" strokeWidth={1} />
                </div>
                <div style={{ position: "absolute", bottom: -3, right: -3, width: 8, height: 8, borderRadius: "50%", background: SELECTED_ROUTE_COLOR, border: "1.5px solid var(--surface-0)" }} />
              </div>
            </AdvancedMarker>
          )}
        </GoogleMap>
      </div>

      <style>{`
        @keyframes ripple {
          0% { box-shadow: 0 0 0 0 rgba(250, 93, 41, 0.4); }
          70% { box-shadow: 0 0 0 20px rgba(250, 93, 41, 0); }
          100% { box-shadow: 0 0 0 0 rgba(250, 93, 41, 0); }
        }
        @keyframes ping {
          0% { transform: scale(1); opacity: 0.6; }
          75%, 100% { transform: scale(2); opacity: 0; }
        }
      `}</style>

      {navPhase === "navigating" && (
        <div className="absolute left-4 top-10 z-40">
          <button onClick={handleBackToPreview} className="p-3 rounded-xl transition-all active:scale-95"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>
            <ArrowLeft className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />
          </button>
        </div>
      )}

      <div className="absolute right-4 top-10 z-40">
        <button onClick={handleRecenter} className="p-3 rounded-xl transition-all duration-300 active:scale-95"
          style={{
            background: isCentered ? "rgba(59,130,246,0.15)" : "var(--surface-2)",
            border: `1px solid ${isCentered ? "rgba(59,130,246,0.3)" : "var(--border-default)"}`,
            color: isCentered ? "#60A5FA" : "var(--text-secondary)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          }}>
          <GPS className="w-4 h-4" />
        </button>
      </div>

      <div className="absolute bottom-[70px] left-0 right-0 z-50">
        {navPhase === "preview" ? (
          <div className="flex justify-center p-4 pb-8">
            <button 
              onClick={handleStartNavigation} 
              className="btn-primary px-10 py-3.5 text-[13px] font-medium flex items-center gap-2.5 active:scale-95 transition-all"
            >
              Start Shift
            </button>
          </div>
        ) : (
          <RouteTimelineSheet
            route={route}
            targetStopId={stops[stops.length - 1]?.id || ""}
            activeBusId={busId}
            stopETAs={upcomingETAs}
            headerContent={
              <div className="flex items-center w-full justify-between mt-2 pl-2">
                <div className="flex items-center gap-2">
                  <div className="status-live" style={{ fontSize: "9px", padding: "2px 8px" }}>
                    Transmitting
                  </div>
                  {delayMinutes > 0 && (
                    <span className="px-2 py-0.5 rounded text-[9px] font-semibold"
                      style={{ background: "var(--status-warning-bg)", color: "var(--status-warning)" }}>
                      +{delayMinutes} min
                    </span>
                  )}
                </div>
                {onEndShift && isTracking && (
                  <button onClick={(e) => { e.stopPropagation(); onEndShift(); }} 
                    className="h-7 px-3 rounded-lg text-[9px] font-semibold transition-all"
                    style={{ background: "var(--status-danger-bg)", border: "1px solid rgba(248,113,113,0.15)", color: "var(--status-danger)" }}>
                    End Shift
                  </button>
                )}
              </div>
            }
            bottomControls={
              <div className="flex items-center gap-2 justify-between w-full">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-semibold mr-1" style={{ color: "var(--text-ghost)" }}>Delay</span>
                  <button onClick={() => pushDelay(-2)} className="h-8 w-10 rounded-lg text-[10px] font-semibold active:scale-90 transition-all"
                    style={{ background: "rgba(59,130,246,0.10)", border: "1px solid rgba(59,130,246,0.15)", color: "#60A5FA" }}>-2</button>
                  <button onClick={() => pushDelay(-1)} className="h-8 w-10 rounded-lg text-[10px] font-semibold active:scale-90 transition-all"
                    style={{ background: "rgba(59,130,246,0.10)", border: "1px solid rgba(59,130,246,0.15)", color: "#60A5FA" }}>-1</button>
                  <div className="px-2 min-w-[32px] text-center">
                    <span className="text-sm font-semibold" style={{ color: delayMinutes > 0 ? "var(--status-warning)" : "var(--text-ghost)", fontVariantNumeric: "tabular-nums" }}>
                      {delayMinutes > 0 ? `+${delayMinutes}` : '0'}
                    </span>
                    <div className="text-[7px] font-semibold" style={{ color: "var(--text-ghost)" }}>min</div>
                  </div>
                  <button onClick={() => pushDelay(1)} className="h-8 w-10 rounded-lg text-[10px] font-semibold active:scale-90 transition-all"
                    style={{ background: "var(--status-warning-bg)", border: "1px solid rgba(251,191,36,0.15)", color: "var(--status-warning)" }}>+1</button>
                  <button onClick={() => pushDelay(2)} className="h-8 w-10 rounded-lg text-[10px] font-semibold active:scale-90 transition-all"
                    style={{ background: "var(--status-warning-bg)", border: "1px solid rgba(251,191,36,0.15)", color: "var(--status-warning)" }}>+2</button>
                </div>
                {currentStopIndex < stops.length - 1 && (
                  <button onClick={handleManualNextStop} className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[9px] font-semibold active:scale-90 transition-all"
                    style={{ background: "var(--surface-3)", border: "1px solid var(--border-default)", color: "var(--text-secondary)" }}>
                    Next Stop
                    <ChevronRight className="w-3 h-3" />
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
