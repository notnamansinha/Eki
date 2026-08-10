"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Map as GoogleMap, AdvancedMarker, useMap } from "@vis.gl/react-google-maps";
import RouteTimelineSheet from "@/components/passenger/RouteTimelineSheet";
import DirectionsRoute from "@/components/maps/DirectionsRoute";
import { RouteStop, RouteData } from "@/hooks/useRoutes";
import { getDistanceMeters } from "@/lib/mapUtils";
import { hasValidBusCoordinates, isLiveBusSignalLost } from "@/lib/liveBusFreshness";
import { subscribeLiveBuses } from "@/lib/liveBusStore";
import { isActiveRideSnapshot } from "@/lib/liveBusSnapshot";

import { WifiOff, Navigation } from "lucide-react";
import { MAP_OPTIONS, MAPS_MAP_ID } from "@/config/maps";
import { decodePolyline, type LatLng } from "@/lib/polyline";
import { snapToPolyline } from "@/lib/snapToPolyline";
import {
  distanceAlongPolyline,
  positionAlongPolyline,
  preparePolylineDistanceIndex,
} from "@/lib/polylineDistance";
import { ETA_SPEED_FLOOR_KMH } from "@/lib/etaConstants";
import { useSmoothPosition } from "@/hooks/useSmoothPosition";

export interface PassengerMapProps {
  targetStop: RouteStop;
  route: RouteData | null;
  resumeGeneration?: number;
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
  tripState: "pre_departure" | "in_service" | "completed"; // Service visibility
  currentStopIndex?: number;
  delayMinutes?: number;
}

const WALKING_KMH = 5;
const WALKING_M_PER_MIN = (WALKING_KMH * 1000) / 60;
const BUS_MOTION_COLORS: Record<string, string> = {
  moving:    "#34D399", // emerald — bus is rolling
  stopped:   "#FBBF24", // amber   — stopped at station or in traffic
  uncertain: "#F87171", // red     — GPS fix lost
};

function BusMarker({
  bus,
  path,
}: {
  bus: IncomingBusData;
  path: readonly LatLng[];
}) {
  const [preferredSegmentIndex, setPreferredSegmentIndex] = useState(-1);
  const result = useMemo(
    () =>
      snapToPolyline(
        { lat: bus.lat, lng: bus.lng },
        path,
        {
          headingDegrees: bus.heading,
          preferredSegmentIndex,
          maxSegmentJump: 25,
        },
      ),
    [bus.lat, bus.lng, bus.heading, path, preferredSegmentIndex],
  );
  useEffect(() => {
    if (!result.snapped) return;
    const frame = requestAnimationFrame(() =>
      setPreferredSegmentIndex(result.segmentIndex),
    );
    return () => cancelAnimationFrame(frame);
  }, [result]);
  const smoothPosition = useSmoothPosition(result.point);

  const color =
    BUS_MOTION_COLORS[bus.motionState] ?? BUS_MOTION_COLORS.uncertain;
  const snappedHeading = Math.round(bus.heading / 5) * 5;

  return (
    <AdvancedMarker position={smoothPosition ?? result.point}>
      <div
        style={{
          width: 44,
          height: 44,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            transform: `rotate(${snappedHeading}deg)`,
            transition: "transform 200ms ease-out",
          }}
        >
          <Navigation size={30} fill={color} color="white" strokeWidth={1} />
        </div>
        <div
          style={{
            position: "absolute",
            bottom: -3,
            right: -3,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: color,
            border: "1.5px solid #09090b",
          }}
        />
      </div>
    </AdvancedMarker>
  );
}


// ── Traffic layer rendered imperatively ──────────────────────────────────────
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

function PassengerMapInner({
  targetStop,
  route,
  resumeGeneration = 0,
}: {
  targetStop: RouteStop;
  route: RouteData;
  resumeGeneration?: number;
}) {
  const [buses, setBuses] = useState<Map<string, IncomingBusData>>(new Map<string, IncomingBusData>());
  const [stopETAs, setStopETAs] = useState<Record<string, number>>({});
  const [uiNow, setUiNow] = useState(() => Date.now());
  const [signalLostBuses, setSignalLostBuses] = useState<Set<string>>(new Set());
  const [signalLostLastSeen, setSignalLostLastSeen] = useState<number | null>(null);
  const [activeBusStopIndex, setActiveBusStopIndex] = useState<number | undefined>(undefined);
  const lastBuzzedStopIdRef = useRef<string | null>(null);
  const lastStopIndexRef = useRef<Record<string, number>>({});
  const stopEntryTimeRef = useRef<Record<string, number>>({});
  // Hysteresis: tracks which stops are "inside" (entered but not yet exited via the larger exit radius)
  const stopInsideRef = useRef<Record<string, boolean>>({}); // busId+stopId -> inside state
  const routeRef = useRef(route);
  const targetStopRef = useRef(targetStop);
  useEffect(() => {
    routeRef.current = route;
    targetStopRef.current = targetStop;
  }, [route, targetStop]);

  const [passengerLocation, setPassengerLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [geolocationNotice, setGeolocationNotice] = useState<string | null>(null);
  const [isCentered, setIsCentered] = useState(false);
  const arrivalTimestampsRef = useRef<Record<string, number>>({});
  const routeStops = useMemo(() => {
    return route.stops?.map(s => ({ lat: s.lat, lng: s.lng })) ?? [];
  }, [route.stops]);
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
  const routeDistanceIndex = useMemo(
    () => preparePolylineDistanceIndex(routePath),
    [routePath],
  );
  const stopPathPositions = useMemo(
    () =>
      new Map(
        (route.stops ?? []).map((stop) => [
          stop.id,
          positionAlongPolyline(stop, routeDistanceIndex),
        ]),
      ),
    [route.stops, routeDistanceIndex],
  );

  // ── Passenger geolocation (read-only — ESP32 is sole source for bus GPS) ──
  useEffect(() => {
    if (!navigator.geolocation) {
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setPassengerLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeolocationNotice(null);
      },
      (error) => {
        setGeolocationNotice(
          error.code === error.PERMISSION_DENIED
            ? "Allow location access to show your walking ETA."
            : "Your location is temporarily unavailable.",
        );
      },
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 10_000 }
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
    const unsubscribe = subscribeLiveBuses((snapshot) => {
        const allData = snapshot as Record<string, IncomingBusData> | null;
        const data = allData
          ? Object.fromEntries(
              Object.entries(allData).filter(([, bus]) => bus.routeId === route.id),
            )
          : null;
        const now = Date.now();
        const currentRoute = routeRef.current;
        const currentTargetStop = targetStopRef.current;

        if (!data) {
          setBuses(new Map());
          setSignalLostBuses(new Set());
          return;
        }

        const activeBuses = new Map<string, IncomingBusData>();
        const newSignalLost = new Set<string>();
        let oldestTimestamp: number | null = null;

        Object.entries(data).forEach(([key, incoming]) => {
          const bus: IncomingBusData = incoming.busId
            ? incoming
            : { ...incoming, busId: key.split("_")[0] };
          if (
            !bus.routeId ||
            !bus.busId ||
            !hasValidBusCoordinates(bus.lat, bus.lng) ||
            !isActiveRideSnapshot(bus as unknown as Record<string, unknown>)
          ) {
            return;
          }

          activeBuses.set(bus.busId, bus);

          if (
            isLiveBusSignalLost(bus.timestamp, now) ||
            bus.deviceState === "offline"
          ) {
            newSignalLost.add(bus.busId);
            if (oldestTimestamp === null || bus.timestamp < oldestTimestamp) {
              oldestTimestamp = bus.timestamp;
            }
          }

          if (!currentRoute.stops?.length) return;

          let closestStopIndex: number;
          if (bus.currentStopIndex !== undefined) {
            closestStopIndex = bus.currentStopIndex;
            lastStopIndexRef.current[bus.busId] = closestStopIndex;
          } else {
            const lastKnown = lastStopIndexRef.current[bus.busId] ?? 0;
            const searchStart = Math.max(0, lastKnown - 1);
            const searchEnd = Math.min(
              currentRoute.stops.length - 1,
              lastKnown + 3,
            );
            let minDistance = Number.POSITIVE_INFINITY;
            closestStopIndex = lastKnown;
            for (let index = searchStart; index <= searchEnd; index += 1) {
              const distance = getDistanceMeters(bus, currentRoute.stops[index]);
              if (distance < minDistance) {
                minDistance = distance;
                closestStopIndex = index;
              }
            }
            if (minDistance > 500) {
              currentRoute.stops.forEach((stop, index) => {
                const distance = getDistanceMeters(bus, stop);
                if (distance < minDistance) {
                  minDistance = distance;
                  closestStopIndex = index;
                }
              });
            }
            lastStopIndexRef.current[bus.busId] = closestStopIndex;
          }

          const STOP_ENTRY_RADIUS_M = 35;
          const STOP_EXIT_RADIUS_M = 45;
          const DWELL_GATE_MS = 10_000;
          const lastKnownIndex = lastStopIndexRef.current[bus.busId] ?? 0;
          const sequenceStart = Math.max(0, lastKnownIndex - 1);
          const sequenceEnd = Math.min(
            currentRoute.stops.length - 1,
            lastKnownIndex + 2,
          );
          const candidateStops = currentRoute.stops
            .slice(sequenceStart, sequenceEnd + 1)
            .map((stop, offset) => ({
              stop,
              index: sequenceStart + offset,
            }));

          for (const { stop, index } of candidateStops) {
            const insideKey = bus.busId + ":" + stop.id;
            const distance = getDistanceMeters(bus, stop);
            const wasInside = stopInsideRef.current[insideKey] ?? false;

            if (!wasInside && distance < STOP_ENTRY_RADIUS_M) {
              stopInsideRef.current[insideKey] = true;
              stopEntryTimeRef.current[insideKey] ??= now;
              if (index > (lastStopIndexRef.current[bus.busId] ?? 0)) {
                lastStopIndexRef.current[bus.busId] = index;
              }
            } else if (wasInside && distance > STOP_EXIT_RADIUS_M) {
              stopInsideRef.current[insideKey] = false;
              delete stopEntryTimeRef.current[insideKey];
            }
          }

          const busDistance = getDistanceMeters(bus, currentTargetStop);
          const dwellAtTarget =
            stopEntryTimeRef.current[bus.busId + ":" + currentTargetStop.id];
          const isAtTarget =
            dwellAtTarget !== undefined &&
            now - dwellAtTarget >= DWELL_GATE_MS;
          if (
            busDistance < STOP_EXIT_RADIUS_M &&
            isAtTarget &&
            lastBuzzedStopIdRef.current !== currentTargetStop.id
          ) {
            lastBuzzedStopIdRef.current = currentTargetStop.id;
          }
        });
        setBuses(activeBuses);
        setSignalLostBuses(newSignalLost);
        setSignalLostLastSeen(oldestTimestamp);
        // Update activeBusStopIndex reactively from the first bus
        const firstEntry = activeBuses.values().next().value as IncomingBusData | undefined;
        if (firstEntry) {
          const idx = lastStopIndexRef.current[firstEntry.busId] ?? 0;
          setActiveBusStopIndex(idx);
        }
      }, (error) => {
        console.warn("[RTDB] activeBuses read failed:", error.message);
      });

    return () => {
      unsubscribe();
    };
  }, [route.id, resumeGeneration]);

  // ── High-Frequency Speed-Aware ETA Fallback (Haversine) ──────────────────
  const updateUI = useCallback(() => {
    const now = Date.now();
    setUiNow(now);
    const updatedETAs: Record<string, number> = {};
    for (const [stopId, timestamp] of Object.entries(arrivalTimestampsRef.current)) {
      updatedETAs[stopId] = Math.max(0, Math.ceil((timestamp - now) / 60_000));
    }
    setStopETAs(updatedETAs);
  }, []);

  useEffect(() => {
    if (!route.stops || route.stops.length === 0 || buses.size === 0) {
      // No bus to compute arrivals for (route empty or bus gone): clear any
      // previous route's arrival timestamps so stale countdowns never outlive
      // the bus that produced them (#67).
      if (Object.keys(arrivalTimestampsRef.current).length > 0) {
        arrivalTimestampsRef.current = {};
        setStopETAs({});
      }
      return;
    }

    const calculateETAs = () => {
      const now = Date.now();
      const newArrivals: Record<string, number> = {};

      for (const bus of Array.from(buses.values())) {
        const closestStopIdx = lastStopIndexRef.current[bus.busId] ?? 0;
        const remainingStops = route.stops.slice(closestStopIdx);
        if (remainingStops.length === 0) continue;
        const busPoint = { lat: bus.lat, lng: bus.lng };
        const busPathPosition = positionAlongPolyline(
          busPoint,
          routeDistanceIndex,
          { headingDegrees: bus.heading },
        );

        const speedKmh = Math.max(
          bus.speed || ETA_SPEED_FLOOR_KMH,
          ETA_SPEED_FLOOR_KMH,
        );
        const speedMs = speedKmh / 3.6;
        const busDelaySec = (bus.delayMinutes || 0) * 60;

        for (let i = 0; i < remainingStops.length; i++) {
          const stop = remainingStops[i];
          const stopPathPosition = stopPathPositions.get(stop.id);
          const accumDistMeters =
            busPathPosition !== null &&
            stopPathPosition !== null &&
            stopPathPosition !== undefined
              ? Math.abs(stopPathPosition - busPathPosition)
              : distanceAlongPolyline(busPoint, stop, routePath);
          
          // Add 45 seconds of dwell time per intermediate stop.
          let totalSeconds = accumDistMeters / speedMs;
          if (i > 0) totalSeconds += (i * 45); 

          const arrivalTimestamp = now + (totalSeconds * 1000) + (busDelaySec * 1000);
          
          if (!newArrivals[stop.id] || arrivalTimestamp < newArrivals[stop.id]) {
            newArrivals[stop.id] = arrivalTimestamp;
          }
        }
      }

      arrivalTimestampsRef.current = newArrivals;
      // Immediately trigger UI update for the new values
      updateUI();
    };

    calculateETAs();
  }, [
    buses,
    route.id,
    route.stops,
    routePath,
    routeDistanceIndex,
    stopPathPositions,
    updateUI,
  ]);

  // ── ETA Smooth Interpolation ───────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(updateUI, 15_000);
    return () => clearInterval(interval);
  }, [updateUI]);

  const signalLostMinutes = signalLostLastSeen
    ? Math.max(0, Math.round((uiNow - signalLostLastSeen) / 60_000))
    : null;

  const mapCenter = useMemo(() => ({ lat: targetStop.lat, lng: targetStop.lng }), [targetStop.lat, targetStop.lng]);
  const centerTarget = useMemo(() => {
    const firstBus = Array.from(buses.values())[0];
    if (!firstBus) return mapCenter;
    return snapToPolyline(
      { lat: firstBus.lat, lng: firstBus.lng },
      routePath,
      { headingDegrees: firstBus.heading },
    ).point;
  }, [buses, mapCenter, routePath]);

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
      {geolocationNotice && signalLostBuses.size === 0 && (
        <div className="absolute top-10 left-4 right-4 z-50" role="status">
          <div
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-[12px] font-semibold"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border-default)",
              color: "var(--text-secondary)",
            }}
          >
            <Navigation className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{geolocationNotice}</span>
          </div>
        </div>
      )}

      <div className="absolute inset-0 z-0" style={{ background: "var(--surface-0)" }} onPointerDown={() => setIsCentered(false)} onTouchStart={() => setIsCentered(false)}>
        <GoogleMap
          mapId={MAPS_MAP_ID}
          defaultCenter={mapCenter}
          defaultZoom={15}
          style={{ width: "100%", height: "100%" }}
          {...MAP_OPTIONS}
        >
          <MapCenterer target={centerTarget} isCentered={isCentered} />
          <DirectionsRoute
            stops={routeStops}
            polyline={route.polyline}
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
          {Array.from(buses.values()).map(bus => (
            <BusMarker key={bus.busId} bus={bus} path={routePath} />
          ))}

          {/* Stop markers */}
          {route.stops?.map((stop, i) => {
            const isTarget = stop.id === targetStop.id;
            const dotColor = "var(--accent)"; // FORCED ORANGE
            
            // Get the current stop index — reactive state from RTDB (driver/ESP32 source of truth)
            const currentStopIndex = activeBusStopIndex ?? 0;
            const isPast = i < currentStopIndex;
            
            // Native halo text style (White text, thick black halo)
            const labelStyle: React.CSSProperties = {
              marginTop: 4,
              color: "#ffffff",
              fontSize: isTarget ? 11 : 9.5,
              fontWeight: 800,
              whiteSpace: "nowrap",
              textShadow: "2px 0 #000, -2px 0 #000, 0 2px #000, 0 -2px #000, 1px 1px #000, -1px -1px #000, 1px -1px #000, -1px 1px #000, 0 4px 8px rgba(0,0,0,0.8)",
              zIndex: 50
            };

            return (
              <AdvancedMarker key={`stop-${stop.id || i}`} position={{ lat: stop.lat, lng: stop.lng }}>
                {isPast ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, background: dotColor, opacity: 0.6, borderRadius: "50%" }}>
                    <span style={{ color: "#ffffff", fontWeight: 800, fontSize: 7 }}>{String.fromCharCode(65 + i)}</span>
                  </div>
                ) : isTarget ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ position: "absolute", top: 2, width: 26, height: 26, background: dotColor, borderRadius: "50%", animation: "ripple 2s infinite" }} />
                    <div style={{ width: 26, height: 26, background: dotColor, border: `3.5px solid #000000`, borderRadius: "50%", zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(0,0,0,0.5)" }}>
                      <span style={{ color: "#ffffff", fontWeight: 900, fontSize: 12 }}>{String.fromCharCode(65 + i)}</span>
                    </div>
                    <span style={labelStyle}>
                      {stop.shortName}
                    </span>
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
        </GoogleMap>
      </div>

      <style>{`
        @keyframes ripple {
          0% { transform: scale(1); opacity: 0.6; }
          70% { transform: scale(3.5); opacity: 0; }
          100% { transform: scale(3.5); opacity: 0; }
        }
        @keyframes passengerPulse {
          0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.6); }
          70% { box-shadow: 0 0 0 14px rgba(59, 130, 246, 0); }
          100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
        }
      `}</style>

      <div className="absolute top-[220px] right-4 z-40">
        <button
          onClick={() => setIsCentered(true)}
          className="flex items-center justify-center w-12 h-12 rounded-xl transition-all duration-300 border active:scale-95 shadow-lg"
          style={{
            background: isCentered ? "rgba(59, 130, 246, 0.15)" : "var(--surface-2)",
            borderColor: isCentered ? "rgba(59, 130, 246, 0.3)" : "var(--border-default)",
            color: isCentered ? "#60A5FA" : "var(--text-secondary)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          }}
          aria-label="Center on bus"
        >
          <Navigation className="w-5 h-5" fill={isCentered ? "currentColor" : "none"} />
        </button>
      </div>

      <RouteTimelineSheet
        route={route}
        targetStopId={targetStop.id}
        activeBusId={null}
        stopETAs={stopETAs}
        walkMinutesToTarget={walkMinutesToTarget}
        currentStopIndex={activeBusStopIndex}
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
      <PassengerMapInner
        targetStop={props.targetStop}
        route={props.route}
        resumeGeneration={props.resumeGeneration}
      />
    </div>
  );
}
