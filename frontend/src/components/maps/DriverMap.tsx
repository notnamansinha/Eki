"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { Map as GoogleMap, AdvancedMarker, useMap } from "@vis.gl/react-google-maps";
import { LocateFixed as GPS, ArrowLeft, Navigation } from "lucide-react";
import DirectionsRoute from "@/components/maps/DirectionsRoute";
import { RouteData } from "@/hooks/useRoutes";
import RouteTimelineSheet from "@/components/passenger/RouteTimelineSheet";
import { auth } from "@/lib/firebaseAuth";
import { DEFAULT_CENTER, MAP_OPTIONS, MAPS_MAP_ID } from "@/config/maps";
import { decodePolyline } from "@/lib/polyline";
import { snapToPolyline } from "@/lib/snapToPolyline";
import { distanceAlongPolyline } from "@/lib/polylineDistance";
import { useSmoothPosition } from "@/hooks/useSmoothPosition";
import {
  ETA_SPEED_FLOOR_KMH,
  ETA_SPEED_FLOOR_METERS_PER_MINUTE,
} from "@/lib/etaConstants";

export interface DriverMapProps {
  route: RouteData;
  busId: string;
  driverLocation: { lat: number; lng: number; heading: number; speed?: number } | null;
  isTracking?: boolean;
  selectedRouteIds?: string[];
  currentStopIndex: number;
  tripState: "pre_departure" | "in_service";
}

const SELECTED_ROUTE_COLOR = "#4285F4";
type NavPhase = "preview" | "navigating";

// ── Traffic layer rendered imperatively ──────────────────────────────────────
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

function DriverMapInner({ route, driverLocation, busId, isTracking, selectedRouteIds, currentStopIndex, tripState }: DriverMapProps) {
  const stops = useMemo(() => route.stops || [], [route.stops]);
  const nextStop = stops[currentStopIndex] ?? stops[stops.length - 1];
  const [delayMinutes, setDelayMinutes] = useState(0);

  const routeStops = useMemo(() => {
    return stops.map(s => ({ lat: s.lat, lng: s.lng }));
  }, [stops]);

  const routePath = useMemo(() => {
    if (route.polyline) {
      try {
        const decoded = decodePolyline(route.polyline);
        if (decoded.length >= 2) return decoded;
      } catch {
        // Legacy routes fall back to their saved stop coordinates.
      }
    }
    return routeStops;
  }, [route.polyline, routeStops]);

  const pushDelay = useCallback((addMin: number) => {
    const next = Math.max(0, delayMinutes + addMin);
    setDelayMinutes(next);
    if (!busId) {
      console.warn("[DriverMap] Delay was not synced because no bus is assigned.");
      return;
    }
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
    const currentUser = auth.currentUser;
    if (!backendUrl || !currentUser) {
      console.warn("[DriverMap] Delay was not synced because the shift service is unavailable.");
      return;
    }
    const routesToUpdate = selectedRouteIds?.length ? selectedRouteIds : [route.id];
    void currentUser.getIdToken().then((token) =>
      Promise.all(routesToUpdate.map(async (routeId) => {
        const response = await fetch(`${backendUrl}/api/shifts/delay`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ busId, routeId, delayMinutes: next }),
        });
        if (!response.ok) throw new Error(`Delay update failed with HTTP ${response.status}`);
      })),
    ).catch((error) => console.error("[DriverMap] Delay sync failed:", error));
  }, [busId, delayMinutes, route.id, selectedRouteIds]);

  const [navPhase, setNavPhase] = useState<NavPhase>(isTracking ? "navigating" : "preview");
  const [isCentered, setIsCentered] = useState(true);
  const displayDur = useMemo(() => {
    if (navPhase !== "navigating" || !driverLocation || !nextStop) {
      return 0;
    }
    const distM = distanceAlongPolyline(
      { lat: driverLocation.lat, lng: driverLocation.lng },
      { lat: nextStop.lat, lng: nextStop.lng },
      routePath,
    );
    const speedKmh = Math.max(
      driverLocation.speed || ETA_SPEED_FLOOR_KMH,
      ETA_SPEED_FLOOR_KMH,
    );
    const speedMs = speedKmh / 3.6;
    const durationSec = speedMs > 0 ? distM / speedMs : 0;
    return Math.round(durationSec / 10) * 10;
  }, [driverLocation, navPhase, nextStop, routePath]);

  const handleRecenter = useCallback(() => setIsCentered(true), []);
  const handlePointerDown = useCallback(() => setIsCentered(false), []);
  const handleBackToPreview = useCallback(() => setNavPhase("preview"), []);

  const upcomingETAs = useMemo(() => {
    const etaMap: Record<string, number> = {};
    let accumTime = displayDur;
    if (nextStop?.id) {
      etaMap[nextStop.id] = Math.round((accumTime / 60) + delayMinutes);
      for (let i = currentStopIndex + 1; i < stops.length; i++) {
        const dist = distanceAlongPolyline(stops[i - 1], stops[i], routePath) + 125;
        accumTime += (dist / ETA_SPEED_FLOOR_METERS_PER_MINUTE) * 60;
        etaMap[stops[i].id] = Math.round((accumTime / 60) + delayMinutes);
      }
    }
    return etaMap;
  }, [displayDur, delayMinutes, nextStop, currentStopIndex, stops, routePath]);

  const snappedHeading = driverLocation ? Math.round(driverLocation.heading / 5) * 5 : 0;

  const [preferredSegmentIndex, setPreferredSegmentIndex] = useState(-1);
  const snappedDriverLocation = useMemo(() => {
    if (!driverLocation) return null;
    const result = snapToPolyline(
      { lat: driverLocation.lat, lng: driverLocation.lng },
      routePath,
      {
        headingDegrees: driverLocation.heading,
        preferredSegmentIndex,
        maxSegmentJump: 25,
      },
    );
    return { ...result, heading: driverLocation.heading };
  }, [driverLocation, preferredSegmentIndex, routePath]);
  useEffect(() => {
    if (!snappedDriverLocation?.snapped) return;
    const frame = requestAnimationFrame(() =>
      setPreferredSegmentIndex(snappedDriverLocation.segmentIndex),
    );
    return () => cancelAnimationFrame(frame);
  }, [snappedDriverLocation]);
  const smoothDriverPosition = useSmoothPosition(
    snappedDriverLocation?.point ?? null,
  );

  const defaultCenter = smoothDriverPosition
    ? smoothDriverPosition
    : (stops.length ? { lat: stops[0].lat, lng: stops[0].lng } : DEFAULT_CENTER);

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
          <MapCenterer
            target={
              smoothDriverPosition && snappedDriverLocation
                ? { ...smoothDriverPosition, heading: snappedDriverLocation.heading }
                : null
            }
            isCentered={isCentered}
            navPhase={navPhase}
          />
          <DirectionsRoute
            stops={routeStops}
            polyline={route.polyline}
            color={route.color || SELECTED_ROUTE_COLOR}
            hasBuses={navPhase === "navigating"}
          />

          {/* Stop markers */}
          {stops.map((stop, i) => {
            const dotColor = "var(--accent)"; // FORCED ORANGE
            
            // Native halo text style (White text, thick black halo)
            const labelStyle: React.CSSProperties = {
              marginTop: 4,
              color: "#ffffff",
              fontSize: i === currentStopIndex ? 11 : 9.5,
              fontWeight: 800,
              whiteSpace: "nowrap",
              textShadow: "2px 0 #000, -2px 0 #000, 0 2px #000, 0 -2px #000, 1px 1px #000, -1px -1px #000, 1px -1px #000, -1px 1px #000, 0 4px 8px rgba(0,0,0,0.8)",
              zIndex: 50
            };

            return (
              <AdvancedMarker key={`stop-${stop.id || i}`} position={{ lat: stop.lat, lng: stop.lng }}>
                {i === currentStopIndex ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ position: "absolute", top: 2, width: 26, height: 26, background: dotColor, borderRadius: "50%", animation: "ripple 2s infinite" }} />
                    <div style={{ width: 26, height: 26, background: dotColor, border: `3.5px solid #000000`, borderRadius: "50%", zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(0,0,0,0.5)" }}>
                      <span style={{ color: "#ffffff", fontWeight: 900, fontSize: 12 }}>{String.fromCharCode(65 + i)}</span>
                    </div>
                    <span style={labelStyle}>
                      {stop.shortName}
                    </span>
                  </div>
                ) : i < currentStopIndex ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, background: dotColor, opacity: 0.6, borderRadius: "50%" }}>
                    <span style={{ color: "#ffffff", fontWeight: 800, fontSize: 7 }}>{String.fromCharCode(65 + i)}</span>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ width: 20, height: 20, background: dotColor, border: `3px solid #000000`, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 4px rgba(0,0,0,0.4)" }}>
                      <span style={{ color: "#ffffff", fontWeight: 800, fontSize: 9 }}>{String.fromCharCode(65 + i)}</span>
                    </div>
                    <span style={labelStyle}>
                      {stop.shortName}
                    </span>
                  </div>
                )}
              </AdvancedMarker>
            );
          })}

          {/* Driver bus marker */}
          {driverLocation && snappedDriverLocation && smoothDriverPosition && (
            <AdvancedMarker position={smoothDriverPosition}>
              <div style={{ width: 44, height: 44, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(66,133,244,0.15)", animation: "ping 1s infinite", opacity: 0.6 }} />
                <div style={{ transform: `rotate(${snappedHeading}deg)`, transition: "transform 200ms ease-out", zIndex: 10 }}>
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
          0% { transform: scale(1); opacity: 0.6; }
          70% { transform: scale(3.5); opacity: 0; }
          100% { transform: scale(3.5); opacity: 0; }
        }
        @keyframes ping {
          0% { transform: scale(1); opacity: 0.6; }
          75%, 100% { transform: scale(2); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="animation: ripple"], [style*="animation: ping"] {
            animation: none !important;
          }
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
        {navPhase !== "preview" && (
          <RouteTimelineSheet
            route={route}
            targetStopId={stops[stops.length - 1]?.id || ""}
            activeBusId={busId}
            stopETAs={upcomingETAs}
            headerContent={
              <div className="flex items-center w-full justify-between mt-2 pl-2">
                <div className="flex items-center gap-2">
                  <div className="status-live" style={{ fontSize: "9px", padding: "2px 8px" }}>
                    {tripState === "in_service" ? "Ride in service" : "Armed · awaiting stop 1"}
                  </div>
                  {delayMinutes > 0 && (
                    <span className="px-2 py-0.5 rounded text-[9px] font-semibold"
                      style={{ background: "var(--status-warning-bg)", color: "var(--status-warning)" }}>
                      +{delayMinutes} min
                    </span>
                  )}
                </div>
                <span className="text-[9px] font-semibold" style={{ color: "var(--text-ghost)" }}>
                  Ends automatically at final stop
                </span>
              </div>
            }
            bottomControls={
              <div className="flex items-center gap-2 justify-between w-full">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-semibold mr-1" style={{ color: "var(--text-ghost)" }}>Delay</span>
                  <button onClick={() => pushDelay(-2)} aria-label="Decrease delay by 2 minutes" className="h-11 w-11 rounded-lg text-[10px] font-semibold active:scale-90 transition-all"
                    style={{ background: "rgba(59,130,246,0.10)", border: "1px solid rgba(59,130,246,0.15)", color: "#60A5FA" }}>-2</button>
                  <button onClick={() => pushDelay(-1)} aria-label="Decrease delay by 1 minute" className="h-11 w-11 rounded-lg text-[10px] font-semibold active:scale-90 transition-all"
                    style={{ background: "rgba(59,130,246,0.10)", border: "1px solid rgba(59,130,246,0.15)", color: "#60A5FA" }}>-1</button>
                  <div className="px-2 min-w-[32px] text-center">
                    <span className="text-sm font-semibold" style={{ color: delayMinutes > 0 ? "var(--status-warning)" : "var(--text-ghost)", fontVariantNumeric: "tabular-nums" }}>
                      {delayMinutes > 0 ? `+${delayMinutes}` : '0'}
                    </span>
                    <div className="text-[7px] font-semibold" style={{ color: "var(--text-ghost)" }}>min</div>
                  </div>
                  <button onClick={() => pushDelay(1)} aria-label="Increase delay by 1 minute" className="h-11 w-11 rounded-lg text-[10px] font-semibold active:scale-90 transition-all"
                    style={{ background: "var(--status-warning-bg)", border: "1px solid rgba(251,191,36,0.15)", color: "var(--status-warning)" }}>+1</button>
                  <button onClick={() => pushDelay(2)} aria-label="Increase delay by 2 minutes" className="h-11 w-11 rounded-lg text-[10px] font-semibold active:scale-90 transition-all"
                    style={{ background: "var(--status-warning-bg)", border: "1px solid rgba(251,191,36,0.15)", color: "var(--status-warning)" }}>+2</button>
                </div>
                <span className="text-[9px] font-semibold" style={{ color: "var(--text-ghost)" }}>
                  Stop progress updates automatically
                </span>
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
