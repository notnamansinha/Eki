"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Map as GoogleMap, AdvancedMarker, useMap } from "@vis.gl/react-google-maps";
import RouteTimelineSheet from "@/components/passenger/RouteTimelineSheet";
import { RouteStop, RouteData } from "@/hooks/useRoutes";
import { getDistanceMeters } from "@/lib/mapUtils";
import { rtdb, auth } from "@/lib/firebase";
import { ref, query, orderByChild, equalTo, onValue } from "firebase/database";
import { signInAnonymously } from "firebase/auth";
import { LocateFixed, WifiOff } from "lucide-react";
import { DEFAULT_CENTER, MAP_OPTIONS, MAPS_MAP_ID } from "@/config/maps";

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
  deviceState: "online" | "offline";
  motionState: "moving" | "stopped" | "uncertain"; // Physical movement state from hardware
  tripState: "pre_departure" | "in_service" | "completed" | "maintenance"; // Service visibility
  currentStopIndex?: number;
  delayMinutes?: number;
  lowAccuracy?: boolean; // Set by firmware when 2.5 < HDOP ≤ 4.0
}

// Staleness threshold: show "signal lost" banner if timestamp is older than 90s
const SIGNAL_LOST_MS = 90_000;
// Buses not seen in 5 minutes are considered gone
const BUS_EXPIRY_MS = 300_000;

const WALKING_KMH = 5;
const WALKING_M_PER_MIN = (WALKING_KMH * 1000) / 60;
const BUS_SPEED_FLOOR_KMH = 15;

const BUS_MOTION_COLORS: Record<string, string> = {
  moving:    "#10b981", // emerald — bus is rolling
  stopped:   "#f59e0b", // amber   — stopped at station or in traffic
  uncertain: "#ef4444", // red     — GPS fix lost
};

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

// ── Route polyline drawn imperatively via google.maps.Polyline ───────────────
// Using useMap + useEffect pattern avoids needing the Polyline overlay component.
function RoutePolylines({ decodedPath, hasBuses }: { decodedPath: { lat: number; lng: number }[], hasBuses: boolean }) {
  const map = useMap();
  const routeLineRef = useRef<google.maps.Polyline | null>(null);
  const activeLineRef = useRef<google.maps.Polyline | null>(null);

  useEffect(() => {
    if (!map || decodedPath.length === 0) return;

    routeLineRef.current = new google.maps.Polyline({
      path: decodedPath,
      strokeColor: "#9aa0a6",
      strokeWeight: 7,
      strokeOpacity: 0.8,
      map,
    });

    if (hasBuses) {
      activeLineRef.current = new google.maps.Polyline({
        path: decodedPath,
        strokeColor: "#3b82f6",
        strokeWeight: 7,
        strokeOpacity: 1.0,
        map,
      });
    }

    return () => {
      routeLineRef.current?.setMap(null);
      activeLineRef.current?.setMap(null);
    };
  }, [map, decodedPath, hasBuses]);

  return null;
}

// ── Pan/zoom controller ──────────────────────────────────────────────────────
function MapCenterer({ target, isCentered }: { target: { lat: number; lng: number } | null, isCentered: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (isCentered && target && map) {
      map.panTo(target);
      map.setZoom(16);
    }
  }, [isCentered, target, map]);
  return null;
}

function PassengerMapInner({ targetStop, route }: PassengerMapProps) {
  const [buses, setBuses] = useState<Map<string, IncomingBusData>>(new Map<string, IncomingBusData>());
  const [stopETAs, setStopETAs] = useState<Record<string, number>>({});
  const [signalLostBuses, setSignalLostBuses] = useState<Set<string>>(new Set());
  const [signalLostLastSeen, setSignalLostLastSeen] = useState<number | null>(null);
  const lastBuzzedStopIdRef = useRef<string | null>(null);
  const lastStopIndexRef = useRef<Record<string, number>>({});
  const stopEntryTimeRef = useRef<Record<string, number>>({});

  const [passengerLocation, setPassengerLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isCentered, setIsCentered] = useState(false);

  // ── Passenger geolocation (read-only — ESP32 is sole source for bus GPS) ──
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
    return route.stops?.map(s => ({ lat: s.lat, lng: s.lng })) || [];
  }, [route.polyline, route.stops]);

  // ── Anonymous auth before reading RTDB ──────────────────────────────────
  useEffect(() => {
    signInAnonymously(auth).catch((err) => {
      console.warn("[RTDB Auth] Anonymous sign-in failed:", err.code);
    });
  }, []);

  // ── RTDB subscription: filtered by routeId ───────────────────────────────
  useEffect(() => {
    const busesRef = query(
      ref(rtdb, "activeBuses"),
      orderByChild("routeId"),
      equalTo(route.id)
    );

    const unsubscribe = onValue(busesRef, (snapshot) => {
      const data = snapshot.val() as Record<string, IncomingBusData>;
      const now = Date.now();

      if (!data) {
        setBuses(new Map());
        setSignalLostBuses(new Set());
        return;
      }

      const activeBuses = new Map<string, IncomingBusData>();
      const newSignalLost = new Set<string>();
      let oldestTimestamp: number | null = null;

      Object.values(data).forEach((bus) => {
        const age = now - bus.timestamp;
        const isFresh = age < BUS_EXPIRY_MS;

        if ((bus.deviceState === "online" && bus.tripState === "in_service") && isFresh) {
          activeBuses.set(bus.busId, bus);

          if (age > SIGNAL_LOST_MS) {
            newSignalLost.add(bus.busId);
            if (oldestTimestamp === null || bus.timestamp < oldestTimestamp) {
              oldestTimestamp = bus.timestamp;
            }
          }

          if (route.stops && route.stops.length > 0) {
            let closestStopIndex: number;
            if (bus.currentStopIndex !== undefined) {
              closestStopIndex = bus.currentStopIndex;
            } else {
              const lastKnown = lastStopIndexRef.current[bus.busId] ?? 0;
              const searchStart = Math.max(0, lastKnown - 1);
              const searchEnd = Math.min(route.stops.length - 1, lastKnown + 3);
              let minD = Infinity;
              closestStopIndex = lastKnown;
              for (let i = searchStart; i <= searchEnd; i++) {
                const d = getDistanceMeters({ lat: bus.lat, lng: bus.lng }, route.stops[i]);
                if (d < minD) { minD = d; closestStopIndex = i; }
              }
              if (minD > 500) {
                route.stops.forEach((stop, idx) => {
                  const d = getDistanceMeters({ lat: bus.lat, lng: bus.lng }, stop);
                  if (d < minD) { minD = d; closestStopIndex = idx; }
                });
              }
              lastStopIndexRef.current[bus.busId] = closestStopIndex;
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

            const DWELL_GATE_MS = 15_000;
            const STOP_PROXIMITY_M = 50;
            route.stops.forEach((stop) => {
              const d = getDistanceMeters({ lat: bus.lat, lng: bus.lng }, stop);
              if (d < STOP_PROXIMITY_M) {
                if (!stopEntryTimeRef.current[stop.id]) {
                  stopEntryTimeRef.current[stop.id] = now;
                }
              } else {
                delete stopEntryTimeRef.current[stop.id];
              }
            });

            const busDist = getDistanceMeters({ lat: bus.lat, lng: bus.lng }, targetStop);
            const dwellAtTarget = stopEntryTimeRef.current[targetStop.id];
            const isAtTarget = dwellAtTarget && (now - dwellAtTarget >= DWELL_GATE_MS);
            if (busDist < 200 && isAtTarget && lastBuzzedStopIdRef.current !== targetStop.id) {
              lastBuzzedStopIdRef.current = targetStop.id;
            }
          }
        }
      });

      setBuses(activeBuses);
      setSignalLostBuses(newSignalLost);
      setSignalLostLastSeen(oldestTimestamp);
    });

    return () => unsubscribe();
  }, [route.id, targetStop, route.stops]);

  const signalLostMinutes = signalLostLastSeen
    ? Math.round((Date.now() - signalLostLastSeen) / 60_000)
    : null;

  const mapCenter = useMemo(() => ({ lat: targetStop.lat, lng: targetStop.lng }), [targetStop.lat, targetStop.lng]);

  return (
    <>
      {/* ── Signal Lost Banner ─────────────────────────────────────────── */}
      {signalLostBuses.size > 0 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2
                        bg-amber-900/90 border border-amber-500/60 text-amber-200
                        px-4 py-2 rounded-xl text-sm backdrop-blur-md shadow-lg
                        animate-in fade-in slide-in-from-top-2 duration-300">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>
            GPS signal lost
            {signalLostMinutes !== null && signalLostMinutes > 0
              ? ` — last seen ${signalLostMinutes} min ago`
              : " — reconnecting…"}
          </span>
        </div>
      )}

      <div className="absolute inset-0 z-0" onPointerDown={() => setIsCentered(false)}>
        <GoogleMap
          mapId={MAPS_MAP_ID}
          defaultCenter={mapCenter}
          defaultZoom={15}
          style={{ width: "100%", height: "100%" }}
          {...MAP_OPTIONS}
        >
          <MapCenterer target={passengerLocation} isCentered={isCentered} />
          <RoutePolylines decodedPath={decodedPath} hasBuses={buses.size > 0} />

          {/* Passenger location dot */}
          {passengerLocation && (
            <AdvancedMarker position={passengerLocation}>
              <div style={{ position: "relative", width: 20, height: 20 }}>
                <div style={{
                  position: "absolute", inset: 0, width: 20, height: 20,
                  borderRadius: "50%", background: "#3b82f6", border: "3px solid white",
                  zIndex: 10, animation: "passengerPulse 2s infinite",
                  boxShadow: "0 0 0 0 rgba(59,130,246,0.7)"
                }} />
              </div>
            </AdvancedMarker>
          )}

          {/* Bus markers */}
          {Array.from(buses.values()).map(bus => {
            const color = BUS_MOTION_COLORS[bus.motionState] ?? BUS_MOTION_COLORS.uncertain;
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

          {/* Stop markers */}
          {route.stops?.map((stop, i) => {
            const isTarget = stop.id === targetStop.id;
            return (
              <AdvancedMarker key={`stop-${stop.id || i}`} position={{ lat: stop.lat, lng: stop.lng }}>
                {isTarget ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ position: "absolute", width: 32, height: 32, background: "#f97316", borderRadius: "50%", animation: "ripple 2s infinite" }} />
                    <div style={{ width: 32, height: 32, background: "#f97316", border: "4px solid #fb923c", borderRadius: "50%", zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 15px rgba(0,0,0,0.3)" }}>
                      <span style={{ color: "white", fontWeight: 900, fontSize: 12 }}>{String.fromCharCode(65 + i)}</span>
                    </div>
                    <span style={{ marginTop: 8, padding: "6px 16px", background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", color: "white", borderRadius: 12, fontSize: 10, whiteSpace: "nowrap", zIndex: 50, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.2em" }}>
                      {stop.shortName}
                    </span>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", opacity: 0.7, transform: "scale(0.9)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, background: "#f97316", border: "2px solid #fb923c", borderRadius: "50%", boxShadow: "0 4px 6px rgba(0,0,0,0.1)" }}>
                      <span style={{ color: "white", fontWeight: 900, fontSize: 10 }}>{String.fromCharCode(65 + i)}</span>
                    </div>
                    <span style={{ marginTop: 4, padding: "2px 8px", background: "rgba(30,41,59,0.8)", color: "white", borderRadius: 4, fontSize: 8, whiteSpace: "nowrap", opacity: 0.6, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      {stop.shortName}
                    </span>
                  </div>
                )}
              </AdvancedMarker>
            );
          })}
        </GoogleMap>
      </div>

      <style>{`
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
      `}</style>

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
