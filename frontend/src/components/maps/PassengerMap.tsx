"use client";

import { memo, useEffect, useRef, useState, useMemo, useCallback, type CSSProperties } from "react";
import { Map as GoogleMap, AdvancedMarker, useMap } from "@vis.gl/react-google-maps";
import RouteTimelineSheet from "@/components/passenger/RouteTimelineSheet";
import DirectionsRoute from "@/components/maps/DirectionsRoute";
import BusPositionGlyph from "@/components/maps/BusPositionGlyph";
import { RouteStop } from "@/hooks/useRoutes";
import { getDistanceMeters } from "@/lib/mapUtils";
import { isLiveBusSignalLost, liveBusFreshnessTimestamp } from "@/lib/liveBusFreshness";
import { serverNow } from "@/lib/serverClock";
import { subscribeLiveBusesByRoute } from "@/lib/liveBusStore";
import {
  normalizePassengerMapBus,
  passengerLiveBusSelectionKey,
  reusePassengerMapBus,
  type PassengerMapBus,
} from "@/lib/passengerLiveBus";
import { passengerRerouteNotice } from "@/lib/passengerRouteStatus";

import { WifiOff, Navigation, Route as RouteOverviewIcon } from "lucide-react";
import { MAP_OPTIONS, MAPS_MAP_ID } from "@/config/maps";
import {
  directionsMatch,
  type DirectedRouteData,
} from "@/lib/rideDirection";
import { normalizeHeading, unwrapHeading } from "@/lib/markerHeading";
import { busEtaPath } from "@/lib/busRouteGeometry";
import { selectLiveBusMarkerPosition, type LiveBusMarkerSelection } from "@/lib/liveBusMarkerPosition";
import { useLiveBusMarkerPosition } from "@/hooks/useLiveBusMarkerPosition";
import { useSmoothPosition } from "@/hooks/useSmoothPosition";
import {
  decodeRoutePathForDisplay,
} from "@/lib/mapRouteGeometry";
import { busStopArrivalTimestamps, StopProjectionCache } from "@/lib/busEta";
import { useDynamicRouteGeometries } from "@/hooks/useDynamicRouteGeometries";
import { useTelemetryRenderTrace } from "@/hooks/useTelemetryRenderTrace";
import { stopLabel } from "@/lib/stopLabel";
import { routeDisplayPath } from "@/lib/routeDisplayPath";
import { publishedStopIndex } from "@/lib/publishedStopIndex";
import type { LatLng } from "@/lib/polyline";
import { stopEstimateContext, type PassengerStopEstimates } from "@/lib/passengerStopEstimates";

export interface PassengerMapProps {
  targetStop: RouteStop;
  route: DirectedRouteData | null;
  resumeGeneration?: number;
  preview?: boolean;
  selectedBusKey?: string;
  /** Explicit destination selection; targetStop may only be a camera fallback. */
  selectedDestinationStopId?: string;
  onStopEstimatesChange?: (estimates: PassengerStopEstimates) => void;
  liveUpdatesAvailable?: boolean;
}

type IncomingBusData = PassengerMapBus;

const WALKING_KMH = 5;
const WALKING_M_PER_MIN = (WALKING_KMH * 1000) / 60;
const BUS_MOTION_COLORS: Record<string, string> = {
  moving:    "#2563eb",
  stopped:   "#b45309",
  uncertain: "#b45309",
};

const BusMarker = memo(function BusMarker({
  bus,
  signalLost,
}: {
  bus: IncomingBusData;
  signalLost: boolean;
}) {
  const markerSelection = useLiveBusMarkerPosition(bus);
  const markerPoint = useSmoothPosition(markerSelection.position);
  useTelemetryRenderTrace(bus, "passenger", markerPoint !== null, { position: markerPoint, selection: markerSelection });

  const [displayHeading, setDisplayHeading] = useState(() =>
    normalizeHeading(bus.heading),
  );
  const displayHeadingRef = useRef(displayHeading);
  useEffect(() => {
    if (bus.motionState !== "moving" || bus.speed < 3 || bus.deviceState !== "online") return;
    const nextDisplayHeading = unwrapHeading(bus.heading, displayHeadingRef.current);
    displayHeadingRef.current = nextDisplayHeading;
    setDisplayHeading(nextDisplayHeading);
  }, [bus.heading, bus.motionState, bus.speed, bus.deviceState]);

  const color = signalLost || markerSelection.uncertain ? "#b45309"
    : BUS_MOTION_COLORS[bus.motionState] ?? BUS_MOTION_COLORS.uncertain;

  if (!markerPoint) return null;
  return (
    <AdvancedMarker position={markerPoint} anchorLeft="-50%" anchorTop="-50%" zIndex={40}>
      <BusPositionGlyph
        label={
          signalLost ? `${bus.busId} — last known location`
          : markerSelection.decision === "match_pending"
            ? `${bus.busId} — updating route position`
            : markerSelection.uncertain
              ? `${bus.busId} — approximate GNSS position`
              : `${bus.busId} — ${bus.motionState}`
        }
        heading={displayHeading}
        color={color}
        uncertain={signalLost || markerSelection.uncertain || bus.deviceState !== "online"}
      />
    </AdvancedMarker>
  );
});


// ── Traffic layer rendered imperatively ──────────────────────────────────────
// ── Pan/zoom controller ──────────────────────────────────────────────────────
function MapCenterer({ target, isCentered, previewPoints, hasBus, controlsInset }: {
  target: { lat: number; lng: number } | null;
  isCentered: boolean;
  previewPoints?: { lat: number; lng: number }[];
  hasBus: boolean;
  controlsInset: number;
}) {
  const map = useMap();
  const topInset = Math.max(32, controlsInset + 24);
  const [bottomInset, setBottomInset] = useState(160);
  useEffect(() => {
    const viewport = map?.getDiv?.();
    if (!viewport) return;
    const mapRoot = viewport.closest<HTMLElement>("[data-passenger-map]");
    const sheet = mapRoot?.querySelector<HTMLElement>("[data-map-sheet]");
    const measure = () => {
      const bounds = viewport.getBoundingClientRect();
      const overlay = sheet?.getBoundingClientRect();
      const overlap = overlay ? Math.max(0, bounds.bottom - Math.max(bounds.top, overlay.top)) : 0;
      setBottomInset(Math.round(Math.min(bounds.height * 0.65, overlap + 24)));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(viewport);
    if (sheet) observer?.observe(sheet);
    sheet?.addEventListener("transitionend", measure);
    return () => { observer?.disconnect(); sheet?.removeEventListener("transitionend", measure); };
  }, [map]);
  const fittedStage = useRef<string | null>(null);
  // Content identity, not array identity: a rebuilt but identical path must not
  // refit over a manual drag, while an edited route path must refit.
  const geometryKey = useMemo(() => {
    if (!previewPoints) return "";
    let hash = 0;
    for (const { lat, lng } of previewPoints) hash = (Math.imul(hash, 31) + Math.round(lat * 1e6) * 7 + Math.round(lng * 1e6)) | 0;
    return `${previewPoints.length}:${hash}`;
  }, [previewPoints]);
  useEffect(() => {
    if (!map) return;
    if (!isCentered) { fittedStage.current = null; return; }
    if (previewPoints) {
      // Fit once for the route, and once when its first GPS fix arrives.
      // Subsequent fixes must not repeatedly zoom or override a manual drag.
      const stage = `${geometryKey}:${hasBus ? "bus" : "route"}:${topInset}:${bottomInset}`;
      if (fittedStage.current === stage) return;
      const points = [...previewPoints, ...(hasBus && target ? [target] : [])]
        .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
      if (points.length === 0) return;
      const bounds = points.reduce((result, point) => ({
        north: Math.max(result.north, point.lat), south: Math.min(result.south, point.lat),
        east: Math.max(result.east, point.lng), west: Math.min(result.west, point.lng),
      }), { north: -Infinity, south: Infinity, east: -Infinity, west: Infinity });
      map.fitBounds(bounds, { top: topInset, bottom: bottomInset, left: 32, right: 32 });
      fittedStage.current = stage;
      return;
    }
    if (isCentered && target && map) {
      map.panTo(target);
      if (fittedStage.current !== "follow") map.setZoom(16);
      fittedStage.current = "follow";
    }
  }, [isCentered, target, map, previewPoints, geometryKey, hasBus, topInset, bottomInset]);
  return null;
}

function PassengerMapInner({
  targetStop,
  route,
  resumeGeneration = 0,
  preview = false,
  selectedBusKey,
  selectedDestinationStopId,
  onStopEstimatesChange,
  liveUpdatesAvailable = true,
}: {
  targetStop: RouteStop;
  route: DirectedRouteData;
  resumeGeneration?: number;
  preview?: boolean;
  selectedBusKey?: string;
  selectedDestinationStopId?: string;
  onStopEstimatesChange?: PassengerMapProps["onStopEstimatesChange"];
  liveUpdatesAvailable?: boolean;
}) {
  const mapRootRef = useRef<HTMLDivElement>(null);
  const [controlsInset, setControlsInset] = useState(0);
  // Notices need the same overlay inset even before the Maps SDK is ready.
  useEffect(() => {
    const root = mapRootRef.current;
    const header = root?.closest("[data-passenger-tracking]")?.querySelector<HTMLElement>("[data-tracking-controls]");
    if (!root || !header) return;
    const measure = () => setControlsInset(Math.round(Math.max(0,
      header.getBoundingClientRect().bottom - root.getBoundingClientRect().top)));
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(root); observer?.observe(header);
    return () => observer?.disconnect();
  }, []);
  const [buses, setBuses] = useState<Map<string, IncomingBusData>>(new Map<string, IncomingBusData>());
  const previousBusesRef = useRef<Map<string, IncomingBusData>>(new Map());
  const [stopETAs, setStopETAs] = useState<Record<string, number>>({});
  const [uiNow, setUiNow] = useState(() => serverNow());
  const routeRef = useRef(route);
  useEffect(() => {
    routeRef.current = route;
  }, [route]);
  useEffect(() => {
    previousBusesRef.current = new Map();
  }, [route.id, route.rideDirection, route.configVersion, route.stops, selectedBusKey]);

  const [passengerLocation, setPassengerLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [geolocationNotice, setGeolocationNotice] = useState<string | null>(null);
  const [liveReadFailed, setLiveReadFailed] = useState(false);
  const [isCentered, setIsCentered] = useState(true);
  const [focusBus, setFocusBus] = useState(!preview);
  const [inspectedStopId, setInspectedStopId] = useState<string | null>(null);
  const arrivalTimestampsRef = useRef<Record<string, number>>({});
  const routeStops = useMemo(() => {
    return route.stops?.map(s => ({ lat: s.lat, lng: s.lng })) ?? [];
  }, [route.stops]);
  // Dynamic reroute geometry is fetched once per route version from a
  // version-keyed sibling node (`activeRouteGeometry`), so the high-frequency
  // activeBuses child never carries the full polyline.
  const dynamicGeometries = useDynamicRouteGeometries(buses);
  // Each bus keeps its own geometry and next-stop progress.
  const etaMarkerSelections = useRef(new Map<string, LiveBusMarkerSelection>());
  const etaSelectionInputs = useRef(new Map<string, IncomingBusData>());
  const etaBusPositions = useRef(new Map<string, {
    path: readonly LatLng[]; point: LatLng; heading: number;
    routeVersion: number | undefined; direction: unknown; position: number | null;
    sessionId: string | undefined; nextStopIndex: number; stopPositions: ReadonlyMap<string, number | null>;
  }>());
  const stopProjectionCache = useRef(new StopProjectionCache());
  useEffect(() => {
    const selections = etaMarkerSelections.current;
    const inputs = etaSelectionInputs.current;
    const positions = etaBusPositions.current;
    const projections = stopProjectionCache.current;
    return () => {
      selections.clear();
      inputs.clear();
      positions.clear();
      projections.clear();
    };
  }, [route.id, route.rideDirection, route.configVersion, route.geometryVersion]);
  // Backend active geometry is already ordered in travel direction; direction-
  // specific reversePolyline stays in Z→A order. Only legacy forward-only
  // geometry is reversed for a reverse ride (handled in mapRouteGeometry).
  const routePath = useMemo(
    () => decodeRoutePathForDisplay(route, null),
    [route],
  );
  const [repairedRoadPath, setRepairedRoadPath] = useState<LatLng[]>([]);
  const roadPath = useMemo(
    () => repairedRoadPath.length >= 2 ? repairedRoadPath :
      routeDisplayPath(route.polylineQuality === "HIGH_QUALITY" ? route.polyline : undefined, [], true),
    [repairedRoadPath, route.polyline, route.polylineQuality],
  );
  const onConfiguredGeometryReady = useCallback((path: LatLng[]) => {
    setRepairedRoadPath(path);
  }, []);
  const geometryUnavailable = !preview && [...buses.values()].some(bus =>
    bus.routeSource === "dynamic-reroute"
      ? !dynamicGeometries.has(bus.busId)
      : roadPath.length < 2,
  );
  const anyGeometryAvailable = [...buses.values()].some(bus => bus.routeSource === "dynamic-reroute"
    ? dynamicGeometries.has(bus.busId) : roadPath.length >= 2);
  const aggregateArrivals = !selectedBusKey && buses.size > 1;
  // A fleet has no single progress index. A selected/sole bus always follows
  // its current publication, including corrections and session replacement.
  const progressBus = !preview && buses.size === 1 ? buses.values().next().value : undefined;
  const activeBusStopIndex = publishedStopIndex(progressBus?.currentStopIndex, route.stops.length);

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
    if (!passengerLocation || selectedDestinationStopId !== targetStop.id) return undefined;
    const dist = getDistanceMeters(passengerLocation, targetStop);
    return Math.ceil(dist / WALKING_M_PER_MIN);
  }, [passengerLocation, selectedDestinationStopId, targetStop]);


  // ── RTDB subscription: filtered by routeId ───────────────────────────────
  useEffect(() => {
    const unsubscribe = subscribeLiveBusesByRoute(route.id, (snapshot) => {
        setLiveReadFailed(false);
        const allData = snapshot as Record<string, unknown> | null;
        const now = serverNow();
        const currentRoute = routeRef.current;

        if (!allData) {
          previousBusesRef.current = new Map();
          arrivalTimestampsRef.current = {};
          setStopETAs({});
          setBuses(new Map());
          return;
        }

        const activeBuses = new Map<string, IncomingBusData>();

        Object.entries(allData).forEach(([key, incoming]) => {
          const normalized = normalizePassengerMapBus(key, incoming, now);
          if (
            !normalized ||
            normalized.routeId !== currentRoute.id ||
            (selectedBusKey && passengerLiveBusSelectionKey(normalized) !== selectedBusKey) ||
            (!preview && !directionsMatch(normalized.direction, currentRoute.rideDirection))
          ) return;
          const nextBus: IncomingBusData = {
            ...normalized,
            ...(preview ? { direction: undefined, matchedLocation: undefined, mapMatchSeq: undefined, mapMatchSampledAt: undefined, routeSource: undefined } : {}),
            heading: normalizeHeading(normalized.heading),
          };

          const bus = reusePassengerMapBus(previousBusesRef.current.get(nextBus.busId), nextBus);
          activeBuses.set(bus.busId, bus);

        });
        previousBusesRef.current = activeBuses;
        if (activeBuses.size === 0) {
          arrivalTimestampsRef.current = {};
          setStopETAs({});
        }
        setBuses((previous) => previous.size === activeBuses.size &&
          [...activeBuses].every(([id, bus]) => previous.get(id) === bus)
          ? previous : activeBuses);
      }, (error) => {
        console.warn("[RTDB] activeBuses read failed:", error.message);
        setLiveReadFailed(true);
      });

    return () => {
      unsubscribe();
    };
  }, [route.id, route.rideDirection, route.configVersion, route.stops, resumeGeneration, preview, selectedBusKey]);

  // One clock publication; the calculation effect owns arrival labels.
  const updateUI = useCallback(() => {
    setUiNow(serverNow());
  }, []);

  useEffect(() => {
    if (preview || !route.stops || route.stops.length === 0 || buses.size === 0) {
      // No bus to compute arrivals for (route empty or bus gone): clear any
      // previous route's arrival timestamps so stale countdowns never outlive
      // the bus that produced them (#67).
      if (Object.keys(arrivalTimestampsRef.current).length > 0) {
        arrivalTimestampsRef.current = {};
        let cancelled = false;
        queueMicrotask(() => { if (!cancelled) setStopETAs({}); });
        return () => { cancelled = true; };
      }
      return;
    }

    const calculateETAs = () => {
      const now = serverNow();
      for (const id of etaMarkerSelections.current.keys()) {
        if (!buses.has(id)) {
          etaMarkerSelections.current.delete(id);
          etaSelectionInputs.current.delete(id);
          etaBusPositions.current.delete(id);
        }
      }
      const newArrivals: Record<string, number> = {};

      for (const bus of Array.from(buses.values())) {
        if (bus.deviceState !== "online" || isLiveBusSignalLost(liveBusFreshnessTimestamp(bus), now)) continue;
        const nextStopIndex = publishedStopIndex(bus.currentStopIndex, route.stops.length);
        if (nextStopIndex === undefined) continue;
        const remainingStops = route.stops.slice(nextStopIndex);
        if (remainingStops.length === 0) continue;
        // Each bus projects its position and stops along ITS OWN path so a
        // dynamic reroute on one bus never shifts another bus's ETA. Dynamic
        // geometry is fetched once per route version; until it resolves the
        // bus falls back to the shared configured path.
        if (bus.routeSource === "dynamic-reroute" && !dynamicGeometries.has(bus.busId)) continue;
        const busPath = busEtaPath(bus.busId, dynamicGeometries, roadPath);
        if (busPath.length < 2) continue;
        const previousSelection = etaMarkerSelections.current.get(bus.busId);
        const selection = etaSelectionInputs.current.get(bus.busId) === bus &&
          previousSelection && (previousSelection.pendingUntil === undefined || now < previousSelection.pendingUntil)
          ? previousSelection
          : selectLiveBusMarkerPosition(bus, previousSelection, now);
        etaMarkerSelections.current.set(bus.busId, selection);
        etaSelectionInputs.current.set(bus.busId, bus);
        const busPoint = selection.position ?? { lat: bus.lat, lng: bus.lng };
        const geometryKey = bus.routeSource === "dynamic-reroute"
          ? ["dynamic", bus.busId, bus.routeVersion]
          : ["configured", route.id, route.geometryVersion];
        const projectionKey = JSON.stringify([...geometryKey, route.rideDirection, route.configVersion]);
        const stopPositions = stopProjectionCache.current.positions(
          projectionKey, busPath, route.stops,
          bus.routeSource === "dynamic-reroute" ? dynamicGeometries.get(bus.busId)?.firstStopIndex ?? 0 : 0,
        );
        const cachedPosition = etaBusPositions.current.get(bus.busId);
        // The same coordinate/heading can belong to another loop visit.
        // Reuse only the same session, authoritative leg and itinerary revision.
        const busPathPosition = cachedPosition?.path === busPath &&
          cachedPosition.point.lat === busPoint.lat && cachedPosition.point.lng === busPoint.lng &&
          cachedPosition.heading === bus.heading && cachedPosition.routeVersion === bus.routeVersion &&
          cachedPosition.direction === bus.routeDirection && cachedPosition.sessionId === bus.sessionId &&
          cachedPosition.nextStopIndex === nextStopIndex && cachedPosition.stopPositions === stopPositions
          ? cachedPosition.position
          : stopProjectionCache.current.busPosition(projectionKey, busPoint, bus.heading, nextStopIndex);
        etaBusPositions.current.set(bus.busId, {
          path: busPath, point: busPoint, heading: bus.heading,
          routeVersion: bus.routeVersion, direction: bus.routeDirection, position: busPathPosition,
          sessionId: bus.sessionId, nextStopIndex, stopPositions,
        });
        const arrivals = busStopArrivalTimestamps({
          busPoint,
          heading: bus.heading,
          speedKmh: bus.speed,
          delayMinutes: bus.delayMinutes ?? 0,
          path: busPath,
          remainingStops,
          now,
          stopPositions,
          busPathPosition,
        });
        for (const [stopId, arrivalTimestamp] of Object.entries(arrivals)) {
          if (
            !newArrivals[stopId] ||
            arrivalTimestamp < newArrivals[stopId]
          ) {
            newArrivals[stopId] = arrivalTimestamp;
          }
        }
      }

      arrivalTimestampsRef.current = newArrivals;
      // Publish arrival labels without advancing the clock from this effect.
      // The independent timer advances uiNow; feeding it back here loops.
      setStopETAs(Object.fromEntries(Object.entries(newArrivals).map(([id, time]) =>
        [id, Math.max(0, Math.ceil((time - now) / 60_000))],
      )));
    };

    calculateETAs();
  }, [
    buses,
    uiNow,
    preview,
    route.id,
    route.rideDirection,
    route.configVersion,
    route.geometryVersion,
    route.stops,
    roadPath,
    dynamicGeometries,
  ]);

  // ── ETA Smooth Interpolation ───────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(updateUI, 15_000);
    return () => clearInterval(interval);
  }, [updateUI]);

  // The UI timer triggers renders during silence. Evaluate against the actual
  // clock on every render: a new fix can be newer than the last timer tick.
  const signalLostBuses = [...buses.values()].filter(bus =>
    !liveUpdatesAvailable || bus.deviceState === "offline" || isLiveBusSignalLost(liveBusFreshnessTimestamp(bus)),
  );
  const signalLostLastSeen = signalLostBuses.length
    ? Math.min(...signalLostBuses.map(bus => liveBusFreshnessTimestamp(bus) ?? bus.timestamp)) : null;
  const signalLostMinutes = signalLostLastSeen
    ? Math.max(0, Math.round((uiNow - signalLostLastSeen) / 60_000))
    : null;
  const rerouteNotice = useMemo(() => {
    return passengerRerouteNotice([...buses.values()].map((bus) => bus.routeState));
  }, [buses]);

  const mapCenter = useMemo(() => ({ lat: targetStop.lat, lng: targetStop.lng }), [targetStop.lat, targetStop.lng]);
  const firstBus = useMemo(() => Array.from(buses.values())[0], [buses]);
  const firstBusMarker = useLiveBusMarkerPosition(firstBus);
  const estimatesUnavailable = liveReadFailed || !liveUpdatesAvailable ? "Updates unavailable"
    : signalLostBuses.length === buses.size && buses.size > 0 ? "Signal delayed"
    // Paused automatic service has fresh location but no live ride progress.
    : buses.size > 0 && [...buses.values()].every(bus => bus.automaticServicePaused === true) ? "Tracking paused"
    : preview ? (firstBus?.sessionId ? "Direction pending" : "Service not started")
    : buses.size === 0 ? "Waiting for bus"
    : progressBus && activeBusStopIndex === undefined ? "Stop progress unavailable"
    : !anyGeometryAvailable ? "Route unavailable" : undefined;
  const estimateContext = stopEstimateContext(route, selectedBusKey, buses.size === 1 ? firstBus?.routeVersion : undefined);
  useEffect(() => {
    onStopEstimatesChange?.({ context: estimateContext, minutes: estimatesUnavailable ? {} : stopETAs,
      nextStopIndex: activeBusStopIndex, unavailable: estimatesUnavailable });
  }, [onStopEstimatesChange, estimateContext, estimatesUnavailable, stopETAs, activeBusStopIndex]);
  const centerTarget = useMemo(() => {
    return firstBusMarker.position ?? mapCenter;
  }, [firstBusMarker.position, mapCenter]);

  return (
    <div ref={mapRootRef} data-passenger-map className="relative h-full w-full" style={{ "--tracking-controls-inset": `${controlsInset}px` } as CSSProperties}>
      <div data-map-notices className="pointer-events-none absolute left-4 right-20 z-40 flex flex-col gap-2" style={{ top: "calc(var(--tracking-controls-inset, 0px) + 16px)" }}>
      {(liveReadFailed || !liveUpdatesAvailable) && (
        <div className="rounded-xl px-4 py-2.5 text-[12px] font-semibold"
          style={{ background: "var(--surface-2)", color: "var(--status-warning)" }} role="alert">
          Live bus updates are unavailable. Check your connection and reload to retry.
        </div>
      )}
      {preview && buses.size === 0 && !liveReadFailed && (
        <div className="rounded-xl bg-zinc-950/90 p-3 text-sm" role="status">
          Waiting for live location. The configured route remains available.
        </div>
      )}
      {/* Telemetry silence does not identify a receiver or network failure. */}
      {!liveReadFailed && liveUpdatesAvailable && signalLostBuses.length > 0 && (
        <div role="status" aria-live="polite">
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-[12px] font-semibold"
            style={{ 
              background: "var(--surface-2)",
              border: "1px solid rgba(251, 191, 36, 0.2)",
              color: "var(--status-warning)" 
            }}>
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            <span>
              Live location updates delayed
              {signalLostMinutes !== null && signalLostMinutes > 0
                ? ` · last update ${signalLostMinutes}m ago`
                : " · waiting for a fresh update…"}
            </span>
          </div>
        </div>
      )}
      {!liveReadFailed && rerouteNotice && signalLostBuses.length === 0 && (
        <div role="status">
          <div
            className="flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-[12px] font-semibold"
            style={{
              background: "var(--surface-2)",
              border: "1px solid rgba(251, 191, 36, 0.2)",
              color: "var(--status-warning)",
            }}
          >
            <Navigation className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{rerouteNotice}</span>
          </div>
        </div>
      )}
      {!liveReadFailed && geolocationNotice && signalLostBuses.length === 0 && !rerouteNotice && (
        <div role="status">
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

      </div>
      <div className="absolute inset-0 z-0" style={{ background: "var(--surface-0)" }} onPointerDown={() => setIsCentered(false)} onTouchStart={() => setIsCentered(false)}>
        <GoogleMap
          mapId={MAPS_MAP_ID}
          defaultCenter={centerTarget}
          defaultZoom={15}
          style={{ width: "100%", height: "100%" }}
          {...MAP_OPTIONS}
        >
          <MapCenterer target={centerTarget} isCentered={isCentered}
            controlsInset={controlsInset}
            previewPoints={!focusBus ? (routePath.length ? routePath : routeStops) : undefined}
            hasBus={Boolean(firstBusMarker.position)} />
          <DirectionsRoute
            key={`${route.id}:${route.rideDirection}:configured`}
            routeId={route.id}
            stops={routeStops}
            polyline={route.polyline}
            polylineQuality={route.polylineQuality}
            color={route.color || "#3b82f6"}
            hasBuses={buses.size > 0}
            direction={route.rideDirection}
            nextStopIndices={preview ? undefined : [...buses.values()].filter(bus => bus.routeSource !== "dynamic-reroute").flatMap(bus => {
              const index = publishedStopIndex(bus.currentStopIndex, route.stops.length);
              return index === undefined ? [] : [index];
            })}
            progressDistanceM={!preview && buses.size === 1 && firstBus && firstBus.routeSource !== "dynamic-reroute" &&
              firstBusMarker.decision === "matched" && !firstBusMarker.uncertain &&
              (firstBus.matchedLocation?.matchConfidence ?? 0) >= 0.7 && firstBus.routeGeometryVersion === route.geometryVersion &&
              !isLiveBusSignalLost(liveBusFreshnessTimestamp(firstBus))
              ? firstBus?.matchedLocation?.alongRouteDistanceM : undefined}
            completedStopIndex={progressBus?.routeSource === "dynamic-reroute" ? activeBusStopIndex : undefined}
            hideRemaining={progressBus?.routeSource === "dynamic-reroute"}
            progressContext={progressBus ? JSON.stringify([progressBus.sessionId, route.id, route.rideDirection, route.configVersion, route.geometryVersion]) : undefined}
            onGeometryReady={onConfiguredGeometryReady}
          />

          {[...dynamicGeometries.entries()].map(([busId, geometry]) => {
            const bus = buses.get(busId);
            if (!bus || preview) return null;
            const index = publishedStopIndex(bus.currentStopIndex, route.stops.length);
            return <DirectionsRoute
              key={`${busId}:${buses.get(busId)?.routeVersion}`}
              stops={routeStops}
              polyline={geometry.polyline}
              polylineQuality="HIGH_QUALITY"
              color={route.color || "#3b82f6"}
              hasBuses
              nextStopIndices={index === undefined ? [] : [index]}
              firstStopIndex={geometry.firstStopIndex ?? -1}
              progressDistanceM={buses.size === 1 && firstBusMarker.decision === "matched" && !firstBusMarker.uncertain &&
                (bus.matchedLocation?.matchConfidence ?? 0) >= 0.7 &&
                !isLiveBusSignalLost(liveBusFreshnessTimestamp(bus)) ? bus.matchedLocation?.alongRouteDistanceM : undefined}
              direction={route.rideDirection}
            />;
          })}

          {/* Bus markers */}
          {Array.from(buses.values()).map(bus => (
            <BusMarker key={bus.busId} bus={bus} signalLost={!liveUpdatesAvailable || bus.deviceState !== "online" || isLiveBusSignalLost(liveBusFreshnessTimestamp(bus))} />
          ))}

          {/* Ordinary stops stay compact; labels are reserved for the current selection. */}
          {route.stops?.map((stop, i) => {
            const isTarget = stop.id === selectedDestinationStopId;
            const isPast = activeBusStopIndex !== undefined && i < activeBusStopIndex;
            const showLabel = isTarget || i === activeBusStopIndex || stop.id === inspectedStopId;
            return <AdvancedMarker key={`stop-${stop.id || i}`} position={{lat:stop.lat,lng:stop.lng}} anchorLeft="-50%" anchorTop="-50%">
              <button type="button" aria-label={`Show stop ${stop.name}`} title={`${stop.name}${isPast ? " — passed" : ""}`}
                onClick={() => setInspectedStopId(stop.id)} onFocus={() => setInspectedStopId(stop.id)}
                // Inspecting a stop is not a manual pan; keep following the bus.
                onPointerDown={event => event.stopPropagation()} onTouchStart={event => event.stopPropagation()}
                className="relative flex size-11 items-center justify-center" style={{opacity:isPast ? 0.6 : 1}}>
                <span aria-label={isPast ? `${stop.name} — passed` : undefined} className="flex size-5 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white shadow-sm"
                  style={{background:isPast ? "#71717a" : "var(--accent)",outline:isTarget ? "2px solid #18181b" : undefined}}>{stopLabel(i)}</span>
                {showLabel && <span className="absolute top-10 max-w-40 truncate rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold text-zinc-900 shadow-sm">{stop.shortName || stop.name}</span>}
              </button>
            </AdvancedMarker>;
          })}
        </GoogleMap>
      </div>



      <div data-map-camera-controls className="absolute right-4 z-40 flex flex-col gap-2" style={{ top: "calc(var(--tracking-controls-inset, 0px) + 16px)" }}>
        <button
          disabled={!firstBusMarker.position}
          onClick={() => { setFocusBus(true); setIsCentered(true); }}
          className="flex size-12 items-center justify-center rounded-xl border shadow-lg disabled:opacity-40"
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
        <button type="button" aria-label="Show route overview" onClick={() => {setFocusBus(false);setIsCentered(true);}}
          className="flex size-12 items-center justify-center rounded-xl border border-zinc-500 bg-zinc-950 text-white shadow-lg">
          <RouteOverviewIcon className="size-5" aria-hidden="true" />
        </button>
      </div>

      <RouteTimelineSheet
        route={route}
        preview={preview}
        targetStopId={selectedDestinationStopId ?? ""}
        activeBusId={null}
        stopETAs={estimatesUnavailable ? {} : stopETAs}
        walkMinutesToTarget={walkMinutesToTarget}
        currentStopIndex={activeBusStopIndex}
        aggregateArrivals={aggregateArrivals}
        geometryUnavailable={geometryUnavailable}
      />
    </div>
  );
}

export default function PassengerMap(props: PassengerMapProps) {
  if (!props.route) {
    return <div style={{ position: "relative", width: "100%", height: "100%", background: "var(--surface-0)" }} />;
  }
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <PassengerMapInner
        key={`${props.route.id}:${props.route.rideDirection}:${props.preview ? "preview" : "ride"}:${props.selectedBusKey ?? "all"}`}
        targetStop={props.targetStop}
        route={props.route}
        resumeGeneration={props.resumeGeneration}
        preview={props.preview}
        selectedBusKey={props.selectedBusKey}
        selectedDestinationStopId={props.selectedDestinationStopId}
        onStopEstimatesChange={props.onStopEstimatesChange}
        liveUpdatesAvailable={props.liveUpdatesAvailable}
      />
    </div>
  );
}
