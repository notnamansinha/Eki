"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Map as GoogleMap, AdvancedMarker, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import RouteTimelineSheet from "@/components/passenger/RouteTimelineSheet";
import DirectionsRoute from "@/components/maps/DirectionsRoute";
import { RouteStop, RouteData } from "@/hooks/useRoutes";
import { getDistanceMeters } from "@/lib/mapUtils";
import { waitForAuth } from "@/lib/authState";
import { rtdb, auth } from "@/lib/firebase";
import { ref, query, orderByChild, equalTo, onValue } from "firebase/database";

import { LocateFixed, WifiOff, Navigation } from "lucide-react";
import { DEFAULT_CENTER, MAP_OPTIONS, MAPS_MAP_ID } from "@/config/maps";

export interface PassengerMapProps {
  targetStop: RouteStop;
  route: RouteData | null;
}

interface IncomingBusData {
  busId: string;
  routeId: string; // 
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  timestamp: number;
  status?: string; // "active" | "offline"
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
  moving:    "#34D399", // emerald — bus is rolling
  stopped:   "#FBBF24", // amber   — stopped at station or in traffic
  uncertain: "#F87171", // red     — GPS fix lost
};


// ── Traffic layer rendered imperatively ──────────────────────────────────────
function TrafficLayer() {
  const map = useMap();
  const layerRef = useRef<google.maps.TrafficLayer | null>(null);

  useEffect(() => {
    if (!map) return;
    layerRef.current = new google.maps.TrafficLayer();
    layerRef.current.setMap(map);
    return () => { layerRef.current?.setMap(null); };
  }, [map]);

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

function PassengerMapInner({ targetStop, route }: { targetStop: RouteStop; route: RouteData }) {
  const [buses, setBuses] = useState<Map<string, IncomingBusData>>(new Map<string, IncomingBusData>());
  const [stopETAs, setStopETAs] = useState<Record<string, number>>({});
  const [signalLostBuses, setSignalLostBuses] = useState<Set<string>>(new Set());
  const [signalLostLastSeen, setSignalLostLastSeen] = useState<number | null>(null);
  const lastBuzzedStopIdRef = useRef<string | null>(null);
  const lastStopIndexRef = useRef<Record<string, number>>({});
  const stopEntryTimeRef = useRef<Record<string, number>>({});

  const [passengerLocation, setPassengerLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isCentered, setIsCentered] = useState(false);
  const routesLib = useMapsLibrary("routes");
  const arrivalTimestampsRef = useRef<Record<string, number>>({});
  const lastTrafficFetchRef = useRef<number>(0);

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


  // ── RTDB subscription: filtered by routeId ───────────────────────────────
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let isMounted = true;

    waitForAuth().then(() => {
      if (!isMounted) return;

      const busesRef = query(
        ref(rtdb, "activeBuses"),
        orderByChild("routeId"),
        equalTo(route.id)
      );

      unsubscribe = onValue(busesRef, (snapshot) => {
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

        Object.entries(data).forEach(([key, bus]) => {
          bus.busId = bus.busId || key.split("_")[0];
          const isFresh = Date.now() - bus.timestamp < 300_000;
          if (!bus.routeId || !bus.busId || !isFresh) return;

          const isActive = bus.tripState === "in_service" || bus.tripState === "pre_departure";
          const isOffline = bus.status === "offline" || bus.deviceState === "offline";
          if (!isActive || isOffline) return;

          activeBuses.set(bus.busId, bus);

          const age = now - bus.timestamp;
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
        });

        setBuses(activeBuses);
        setSignalLostBuses(newSignalLost);
        setSignalLostLastSeen(oldestTimestamp);
      }, (error) => {
        console.warn("[RTDB] activeBuses read failed:", error.message);
      });
    });

    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [route.id, targetStop, route.stops]);

  // ── 60-Second Live Traffic ETA Fetcher ─────────────────────────────────────
  useEffect(() => {
    if (!routesLib || !route.stops || route.stops.length === 0 || buses.size === 0) return;

    const fetchETAs = async () => {
      const now = Date.now();
      // Only fetch once every 60 seconds
      if (now - lastTrafficFetchRef.current < 60000) return;
      lastTrafficFetchRef.current = now;

      const service = new routesLib.DirectionsService();
      const newArrivals: Record<string, number> = {};

      for (const bus of Array.from(buses.values())) {
        const closestStopIdx = lastStopIndexRef.current[bus.busId] ?? 0;
        const remainingStops = route.stops.slice(closestStopIdx);
        if (remainingStops.length === 0) continue;

        // Chunking the stops 8 waypoints at a time for free tier
        const CHUNK_SIZE = 9;
        const waypointsList = [
          { lat: bus.lat, lng: bus.lng, id: "bus" },
          ...remainingStops
        ];

        const chunks: { lat: number, lng: number, id: string }[][] = [];
        for (let i = 0; i < waypointsList.length - 1; i += CHUNK_SIZE - 1) {
          chunks.push(waypointsList.slice(i, i + CHUNK_SIZE));
          if (i + CHUNK_SIZE >= waypointsList.length) break;
        }

        let totalSeconds = 0;
        const busDelaySec = (bus.delayMinutes || 0) * 60;

        for (const chunk of chunks) {
          if (chunk.length < 2) continue;
          try {
            const res = await service.route({
              origin: chunk[0],
              destination: chunk[chunk.length - 1],
              waypoints: chunk.slice(1, -1).map(p => ({ location: p, stopover: true })),
              travelMode: google.maps.TravelMode.DRIVING,
              optimizeWaypoints: false,
              drivingOptions: {
                departureTime: new Date(),
                trafficModel: google.maps.TrafficModel.BEST_GUESS,
              },
            });

            if (res && res.routes[0]) {
              const legs = res.routes[0].legs;
              for (let i = 0; i < legs.length; i++) {
                const leg = legs[i];
                // Use live traffic duration if available, fallback to normal duration
                const legSeconds = leg.duration_in_traffic?.value || leg.duration?.value || 0;
                totalSeconds += legSeconds;
                
                const targetStopId = chunk[i + 1].id;
                // Add base delay to final timestamp calculation
                const arrivalTimestamp = now + (totalSeconds * 1000) + (busDelaySec * 1000);
                
                // Keep the soonest arrival if multiple buses approach the same stop
                if (!newArrivals[targetStopId] || arrivalTimestamp < newArrivals[targetStopId]) {
                  newArrivals[targetStopId] = arrivalTimestamp;
                }
              }
            }
          } catch (err) {
            console.warn("[Directions API ETA Chunk Failed]", err);
          }
        }
      }

      arrivalTimestampsRef.current = newArrivals;
      // Immediately trigger UI update for the new values
      updateUI();
    };

    fetchETAs();
    const interval = setInterval(fetchETAs, 60000);
    return () => clearInterval(interval);
  }, [routesLib, buses, route.stops]);

  // ── ETA Smooth Interpolation ───────────────────────────────────────────────
  const updateUI = useCallback(() => {
    const now = Date.now();
    const updatedETAs: Record<string, number> = {};
    for (const [stopId, timestamp] of Object.entries(arrivalTimestampsRef.current)) {
      const msRemaining = timestamp - now;
      if (msRemaining > 0) {
        updatedETAs[stopId] = Math.ceil(msRemaining / 60000);
      } else {
        updatedETAs[stopId] = 0;
      }
    }
    setStopETAs(updatedETAs);
  }, []);

  useEffect(() => {
    const interval = setInterval(updateUI, 1000);
    return () => clearInterval(interval);
  }, [updateUI]);

  const signalLostMinutes = signalLostLastSeen
    ? Math.round((Date.now() - signalLostLastSeen) / 60_000)
    : null;

  const mapCenter = useMemo(() => ({ lat: targetStop.lat, lng: targetStop.lng }), [targetStop.lat, targetStop.lng]);

  const routeStops = useMemo(() => {
    return route.stops?.map(s => ({ lat: s.lat, lng: s.lng })) ?? [];
  }, [route.stops]);

  return (
    <>
      {/* ── Signal Lost Banner ── */}
      {signalLostBuses.size > 0 && (
        <div className="absolute top-10 left-4 right-4 z-50 animate-slide-down">
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-[12px] font-semibold"
            style={{ 
              background: "var(--status-warning-bg)", 
              border: "1px solid rgba(251, 191, 36, 0.2)",
              color: "var(--status-warning)" 
            }}>
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            <span>
              GPS signal lost
              {signalLostMinutes !== null && signalLostMinutes > 0
                ? ` · ${signalLostMinutes}m ago`
                : " · reconnecting…"}
            </span>
          </div>
        </div>
      )}

      <div className="absolute inset-0 z-0" style={{ background: "var(--surface-0)" }} onPointerDown={() => setIsCentered(false)}>
        <GoogleMap
          mapId={MAPS_MAP_ID}
          defaultCenter={mapCenter}
          defaultZoom={15}
          style={{ width: "100%", height: "100%" }}
          {...MAP_OPTIONS}
        >
          <MapCenterer target={passengerLocation} isCentered={isCentered} />
          <TrafficLayer />
          <DirectionsRoute
            stops={routeStops}
            color={route.color || "#3b82f6"}
            hasBuses={buses.size > 0}
          />

          {/* Passenger location dot */}
          {passengerLocation && (
            <AdvancedMarker position={passengerLocation}>
              <div style={{ position: "relative", width: 18, height: 18 }}>
                <div style={{
                  position: "absolute", inset: 0, width: 18, height: 18,
                  borderRadius: "50%", background: "#3b82f6", border: "3px solid white",
                  zIndex: 10, animation: "passengerPulse 2s infinite",
                  boxShadow: "0 0 0 0 rgba(59,130,246,0.6)"
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
                <div style={{ width: 44, height: 44, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ transform: `rotate(${snappedHeading}deg)`, transition: "transform 600ms" }}>
                    <Navigation size={30} fill={color} color="white" strokeWidth={1} />
                  </div>
                  <div style={{ position: "absolute", bottom: -3, right: -3, width: 8, height: 8, borderRadius: "50%", background: color, border: "1.5px solid #09090b" }} />
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
                    <div style={{ position: "absolute", width: 28, height: 28, background: "var(--accent)", borderRadius: "50%", animation: "ripple 2s infinite" }} />
                    <div style={{ width: 28, height: 28, background: "var(--accent)", border: "3px solid #fb923c", borderRadius: "50%", zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 12px rgba(250,93,41,0.3)" }}>
                      <span style={{ color: "white", fontWeight: 800, fontSize: 11 }}>{String.fromCharCode(65 + i)}</span>
                    </div>
                    <span style={{ marginTop: 6, padding: "3px 10px", background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "var(--text-primary)", borderRadius: 8, fontSize: 9, whiteSpace: "nowrap", zIndex: 50, fontWeight: 700 }}>
                      {stop.shortName}
                    </span>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", opacity: 0.75 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, background: "var(--accent)", border: "2px solid #fb923c", borderRadius: "50%", boxShadow: "0 2px 4px rgba(0,0,0,0.2)" }}>
                      <span style={{ color: "white", fontWeight: 800, fontSize: 9 }}>{String.fromCharCode(65 + i)}</span>
                    </div>
                    <span style={{ marginTop: 3, padding: "1px 6px", background: "var(--surface-2)", color: "var(--text-tertiary)", borderRadius: 4, fontSize: 8, whiteSpace: "nowrap", fontWeight: 600 }}>
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
          0% { box-shadow: 0 0 0 0 rgba(250, 93, 41, 0.4); }
          70% { box-shadow: 0 0 0 20px rgba(250, 93, 41, 0); }
          100% { box-shadow: 0 0 0 0 rgba(250, 93, 41, 0); }
        }
        @keyframes passengerPulse {
          0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.6); }
          70% { box-shadow: 0 0 0 14px rgba(59, 130, 246, 0); }
          100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
        }
      `}</style>

      {passengerLocation && (
        <div className="absolute bottom-[90px] right-4 z-40">
          <button
            onClick={() => setIsCentered(true)}
            className="flex items-center justify-center w-11 h-11 rounded-xl transition-all duration-300 border active:scale-95"
            style={{
              background: isCentered ? "rgba(59, 130, 246, 0.15)" : "var(--surface-2)",
              borderColor: isCentered ? "rgba(59, 130, 246, 0.3)" : "var(--border-default)",
              color: isCentered ? "#60A5FA" : "var(--text-secondary)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            }}
            aria-label="Center on my location"
          >
            <LocateFixed className="w-4.5 h-4.5" />
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
  if (!props.route) {
    return <div style={{ position: "relative", width: "100%", height: "100%", background: "var(--surface-0)" }} />;
  }
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <PassengerMapInner targetStop={props.targetStop} route={props.route!} />
    </div>
  );
}
