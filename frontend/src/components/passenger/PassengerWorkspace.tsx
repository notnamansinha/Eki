"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/hooks/useAuth";
import { useRoutes } from "@/hooks/useRoutes";
import { MapPinned as MapIcon, CircleUserRound as User, Loader2, MessageCircle, ArrowLeft, Flag, WifiOff, AlertCircle } from "lucide-react";
import { subscribeLiveBusChangesByRoute } from "@/lib/liveBusStore";
import { useLiveRouteCatalog } from "@/hooks/useLiveRouteCatalog";
import { getJoinedRideStatus } from "@/lib/joinedRideStatus";
import { clearJoinedRidePointer, readJoinedRidePointer, saveJoinedRidePointer } from "@/lib/joinedRidePointer";
import { getAuthVerificationGeneration } from "@/lib/authState";
import { PASSENGER_BUS_START_TIME } from "@/config/passenger";
import { useSettings } from "@/hooks/useSettings";
import { isAuthoritativeLiveBusDelivery } from "@/lib/liveBusDelivery";
import {
  passengerLiveBuses,
  passengerLiveBusSelectionKey,
  passengerTripStates,
  type PassengerLiveBus,
} from "@/lib/passengerLiveBus";
import { useRTDBResume } from "@/hooks/useRTDBResume";
import { isPassengerBusSelectable } from "@/lib/passengerAvailability";
import {
  passengerPanelClassName,
  passengerPanelStyle,
  passengerTopSpacerStyle,
} from "./passengerFrame";
import {
  decideRideTracking,
  isPostRideFeedbackEligible,
  recordSuccessfulJoin,
  type RideIdentity,
  type TrackedRide,
} from "@/lib/rideFeedbackEligibility";
import {
  directionLabelState,
  normalizeRideDirection,
  routeInRideDirectionState,
  routeInRideDirection,
} from "@/lib/rideDirection";
import InAppSelect from "@/components/ui/InAppSelect";
import { isLiveChatDeviceOnline } from "@/lib/activeBusEntries";
import { stopEstimateContext, stopEstimateLabel, type PassengerStopEstimates } from "@/lib/passengerStopEstimates";
import {
  passengerBusAvailabilities,
  reuseUnchangedAvailabilities,
  type PassengerBusAvailability,
} from "@/lib/passengerBusAvailability";

const PassengerTrackingMap = dynamic(() => import("@/components/maps/PassengerTrackingMap"), {
  ssr: false,
  loading: () => <div className="h-full bg-[var(--surface-0)]" role="status" aria-label="Loading map" />,
});
const RouteCarousel = dynamic(() => import("@/components/passenger/ui/RouteCarousel"), { ssr: false });
const AccountTab = dynamic(() => import("@/components/passenger/AccountTab"), { ssr: false });
const MessagingPanel = dynamic(() => import("@/components/shared/MessagingPanel"), { ssr: false });
const FeedbackModal = dynamic(() => import("@/components/shared/FeedbackModal"), { ssr: false });
const PassengerBoardingView = dynamic(() => import("@/components/passenger/PassengerBoardingView"), { ssr: false });

type ViewState = "home" | "tracking" | "profile";

const POST_RIDE_FEEDBACK_DELAY_MS = 10_000;

type ActiveBusData = PassengerLiveBus;

type VisibleBusData = ActiveBusData | PassengerBusAvailability;

type ActiveSessionBusData = ActiveBusData & { sessionId: string };

function hasSessionId(bus: VisibleBusData): bus is ActiveSessionBusData {
  return typeof bus.sessionId === "string" && bus.sessionId.length > 0;
}

export default function PassengerWorkspace() {
  const {
    isConnected,
    isResuming,
    resumeGeneration,
    connectionGeneration,
    markSnapshotReceived,
  } = useRTDBResume();
  const { user } = useAuth();
  const { settings } = useSettings();
  const [currentView, setCurrentView] = useState<ViewState>("home");
  const { routes, error: routesError, retry: retryRoutes } = useRoutes();
  const { catalog: routeCatalog, projectionReady, catalogReady, error: catalogError, retry: retryCatalog } = useLiveRouteCatalog(`${connectionGeneration}:${resumeGeneration}`);
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [selectedDestinationStopId, setSelectedDestinationStopId] = useState("");
  const [mapEstimates, setMapEstimates] = useState<PassengerStopEstimates>();
  const updateStopEstimates = useCallback((next: PassengerStopEstimates) => {
    setMapEstimates(current => current?.context === next.context && current.nextStopIndex === next.nextStopIndex &&
      current.unavailable === next.unavailable && Object.keys(current.minutes).length === Object.keys(next.minutes).length &&
      Object.entries(next.minutes).every(([id, minutes]) => current.minutes[id] === minutes) ? current : next);
  }, []);
  const [selectedLiveBusKey, setSelectedLiveBusKey] = useState("");
  const [selectedBusId, setSelectedBusId] = useState("");
  const [activeBuses, setActiveBuses] = useState<ActiveBusData[]>([]);
  const [availableBuses, setAvailableBuses] = useState<PassengerBusAvailability[]>([]);
  const [availabilityNow, setAvailabilityNow] = useState(() => Date.now());
  const [isMessagingOpen, setIsMessagingOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackBusId, setFeedbackBusId] = useState("");
  const [feedbackDriverId, setFeedbackDriverId] = useState("");
  const [feedbackSessionId, setFeedbackSessionId] = useState("");
  const [completedRide, setCompletedRide] = useState<TrackedRide | null>(null);
  const [trackedSessionId, setTrackedSessionId] = useState("");
  const [joinedRouteId, setJoinedRouteId] = useState("");
  const [detailDataError, setDetailDataError] = useState<string | null>(null);
  const [rideRecoveryError, setRideRecoveryError] = useState<string | null>(null);
  const [rideRecoveryNotice, setRideRecoveryNotice] = useState<string | null>(null);
  const [rideStatusRetry, setRideStatusRetry] = useState(0);
  const [restoredBoarding, setRestoredBoarding] = useState<{
    uid: string; sessionId: string; boardingStopId: string; alightingStopId: string | null;
  } | null>(null);
  const liveDataError = catalogError || detailDataError || rideRecoveryError;
  const trackedRideRef = useRef<TrackedRide | null>(null);
  const pendingCompletionSessionIdRef = useRef<string | null>(null);
  const latestTripStatesRef = useRef<Map<string, ActiveBusData["tripState"]>>(new Map());
  const rawLiveBusesRef = useRef(new Map<string, unknown>());
  const activeLiveBusesRef = useRef(new Map<string, ActiveBusData>());
  const boardingRevisionRef = useRef(0);
  useEffect(() => {
    if (!user || user.role !== "passenger" || trackedRideRef.current?.hasJoined) return;
    const sessionId = readJoinedRidePointer(user.uid);
    if (!sessionId) return;
    const controller = new AbortController();
    const boardingRevision = boardingRevisionRef.current;
    const authGeneration = getAuthVerificationGeneration();
    const current = () => !controller.signal.aborted && boardingRevision === boardingRevisionRef.current && authGeneration === getAuthVerificationGeneration() &&
      readJoinedRidePointer(user.uid) === sessionId;
    void getJoinedRideStatus(sessionId, controller.signal).then(status => {
      if (!current()) return;
      if (!status.boarding || status.status === "completed" || status.status === "interrupted" || status.status === "failed") {
        clearJoinedRidePointer(user.uid);
        if (status.status === "interrupted" || status.status === "failed") setRideRecoveryNotice("Your joined ride has ended.");
        return;
      }
      trackedRideRef.current = recordSuccessfulJoin(null, {
        sessionId, busId: status.busId, routeId: status.routeId, driverId: "",
      });
      setRestoredBoarding({ uid: user.uid, sessionId, ...status.boarding });
      setTrackedSessionId(sessionId);
      setJoinedRouteId(status.routeId);
      setSelectedRouteId(status.routeId);
      setSelectedBusId(status.busId);
      setSelectedDestinationStopId(status.boarding.alightingStopId ?? "");
      setRideRecoveryError(null);
      setCurrentView("tracking");
    }).catch(error => {
      if (!current()) return;
      if (error?.status === 403 || error?.status === 404) clearJoinedRidePointer(user.uid);
      setRideRecoveryError("Your boarding could not be restored. Retry to verify your joined ride.");
    });
    return () => controller.abort();
  }, [user, rideStatusRetry]);
  const catalogRoutes = routes.filter(route => {
    const availability = routeCatalog[route.id];
    return availability && (availability.active > 0 || availability.available > 0) &&
      ((route.stops?.length ?? 0) > 0 || (route.waypoints?.length ?? 0) > 0);
  });
  const displayRoutes = isConnected && !liveDataError ? catalogRoutes : [];
  // Keep observing the chosen route through temporary catalog/data gaps.
  // Hiding choices after a detail error must not detach the listener needed
  // to recover them. Catalog scope and user-selectable availability differ.
  const effectiveRouteId = ((currentView === "tracking" && Boolean(selectedRouteId)) || catalogRoutes.some(route => route.id === selectedRouteId))
    ? selectedRouteId : catalogRoutes[0]?.id ?? "";

  // Listen to Firebase Realtime Database for active buses using the existing
  // Firebase session established by the root auth provider.
  // Ride actions require a server-owned lifecycle. Online assigned devices
  // also expose a read-only route/location preview.
  useEffect(() => {
    if (!user || !projectionReady || !catalogReady) return;
    let alive = true;
    const authGeneration = getAuthVerificationGeneration();
    const current = () => alive && authGeneration === getAuthVerificationGeneration();
    const rawBuses = rawLiveBusesRef.current;
    // Keep an explicitly joined ride observable while browsing another route.
    const subscribedRoutes = [...new Set([effectiveRouteId, joinedRouteId].filter((id): id is string => Boolean(id)))];
    const authoritative = new Set<string>();
    const disposals = subscribedRoutes.map(routeId => subscribeLiveBusChangesByRoute(routeId, (change) => {
        if (!current()) return;
        const trackedRideSessionId =
          trackedRideRef.current?.sessionId ?? pendingCompletionSessionIdRef.current;
        const previousTrackedState = trackedRideSessionId
          ? latestTripStatesRef.current.get(trackedRideSessionId)
          : undefined;
        if (change.type === "reset") {
          const rawSnapshot = change.snapshot as Record<string, unknown> | null;
          for (const [key, raw] of rawLiveBusesRef.current) {
            if (raw && typeof raw === "object" && (raw as Record<string, unknown>).routeId === routeId) rawLiveBusesRef.current.delete(key);
          }
          Object.entries(rawSnapshot ?? {}).forEach(([key, value]) => rawLiveBusesRef.current.set(key, value));
          const merged = Object.fromEntries(rawLiveBusesRef.current);
          activeLiveBusesRef.current = new Map(
            passengerLiveBuses(merged, Date.now()).map((bus) => [
              passengerLiveBusSelectionKey(bus),
              bus,
            ]),
          );
          latestTripStatesRef.current = passengerTripStates(merged);
        } else {
          const previous = rawLiveBusesRef.current.get(change.key);
          if (previous && typeof previous === "object") {
            const oldBus = previous as Record<string, unknown>;
            if (typeof oldBus.sessionId === "string") {
              latestTripStatesRef.current.delete(oldBus.sessionId);
            }
            const oldNormalized = passengerLiveBuses({ [change.key]: previous }, Date.now())[0];
            if (oldNormalized) {
              activeLiveBusesRef.current.delete(passengerLiveBusSelectionKey(oldNormalized));
            }
          }
          if (change.type === "remove") {
            rawLiveBusesRef.current.delete(change.key);
          } else {
            rawLiveBusesRef.current.set(change.key, change.value);
            const nextBus = passengerLiveBuses({ [change.key]: change.value }, Date.now())[0];
            if (nextBus) {
              activeLiveBusesRef.current.set(passengerLiveBusSelectionKey(nextBus), nextBus);
            }
            passengerTripStates({ [change.key]: change.value }).forEach((state, sessionId) => {
              latestTripStatesRef.current.set(sessionId, state);
            });
          }
        }

        if (trackedRideSessionId && !latestTripStatesRef.current.has(trackedRideSessionId)) {
          if (previousTrackedState) {
            latestTripStatesRef.current.set(trackedRideSessionId, previousTrackedState);
          }
        }
        setActiveBuses([...activeLiveBusesRef.current.values()]);
        setAvailableBuses(passengerBusAvailabilities(
          Object.fromEntries(rawLiveBusesRef.current),
          Date.now(),
        ));
        if (isAuthoritativeLiveBusDelivery(change.source)) {
          authoritative.add(routeId);
          if (authoritative.size === subscribedRoutes.length) { setDetailDataError(null); if (!catalogError) markSnapshotReceived(); }
        }
        if (change.source === "invalidation") authoritative.delete(routeId);
      }, (error) => {
        if (!current()) return;
        authoritative.delete(routeId);
        setDetailDataError(`Live bus data could not be loaded. ${error.message}. Retry after checking your connection.`);
      }));

    return () => {
      alive = false;
      disposals.forEach(dispose => dispose());
      rawBuses.clear();
      activeLiveBusesRef.current.clear();
    };
  }, [user, projectionReady, catalogReady, catalogError, effectiveRouteId, joinedRouteId, trackedSessionId, connectionGeneration, markSnapshotReceived, resumeGeneration]);

  useEffect(() => {
    if (projectionReady && catalogReady && !catalogError && !detailDataError && !effectiveRouteId && !joinedRouteId) markSnapshotReceived();
  }, [projectionReady, catalogReady, catalogError, detailDataError, effectiveRouteId, joinedRouteId, markSnapshotReceived]);

  const joinedProjectionPresent = activeBuses.some(bus => bus.sessionId === trackedSessionId);
  useEffect(() => {
    const ride = trackedRideRef.current;
    if (!user || !projectionReady || !catalogReady || !ride?.hasJoined || !trackedSessionId || joinedProjectionPresent || latestTripStatesRef.current.get(trackedSessionId) === "completed") return;
    const controller = new AbortController();
    const authGeneration = getAuthVerificationGeneration();
    const current = () => !controller.signal.aborted && authGeneration === getAuthVerificationGeneration();
    let timer: ReturnType<typeof setTimeout> | undefined, running = false, failed = false;
    const visibleOnline = () => document.visibilityState === "visible" && navigator.onLine;
    const check = async () => {
      if (!current() || running || failed || !visibleOnline()) return;
      if (timer) clearTimeout(timer); timer = undefined; running = true;
      let nonterminal = false;
      try {
        const status = await getJoinedRideStatus(trackedSessionId, controller.signal);
        if (!current() || trackedRideRef.current?.sessionId !== trackedSessionId) return;
        if (status.sessionId !== trackedSessionId || status.busId !== ride.busId || status.routeId !== ride.routeId) throw Error("Recovered ride identity did not match the joined session.");
        setRideRecoveryError(null);
        if (status.status === "completed") { latestTripStatesRef.current.set(status.sessionId, "completed"); setActiveBuses(buses => [...buses]); }
        else if (status.status === "interrupted" || status.status === "failed") {
          setRideRecoveryNotice(status.status === "interrupted" ? "Your joined ride was interrupted." : "Your joined ride ended without completion.");
          trackedRideRef.current = null; setTrackedSessionId(""); setJoinedRouteId("");
        } else nonterminal = true;
      } catch { if (current()) { failed = true; setRideRecoveryError("Your joined ride status could not be recovered. Retry to check its authoritative status."); } }
      finally { running = false; if (nonterminal && current() && visibleOnline()) timer = setTimeout(() => { timer = undefined; void check(); }, 15_000); }
    };
    const resume = () => { if (visibleOnline()) void check(); else if (timer) { clearTimeout(timer); timer = undefined; } };
    document.addEventListener("visibilitychange", resume); window.addEventListener("online", resume); window.addEventListener("offline", resume);
    void check();
    return () => { controller.abort(); if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); window.removeEventListener("offline", resume); };
  }, [projectionReady, catalogReady, trackedSessionId, joinedProjectionPresent, user, connectionGeneration, resumeGeneration, rideStatusRetry]);

  // Presence expires without another RTDB event after power/network loss.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setAvailabilityNow(now);
      const next = passengerBusAvailabilities(Object.fromEntries(rawLiveBusesRef.current), now);
      setAvailableBuses(previous => reuseUnchangedAvailabilities(previous, next));
    }, 2_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeRoute = routes.find(route => route.id === effectiveRouteId);
  const busesOnRoute: VisibleBusData[] = [...activeBuses, ...availableBuses].filter(
    (bus) => bus.routeId === effectiveRouteId,
  );
  const selectedBusOnRoute =
    busesOnRoute.find((bus) => bus.sessionId === trackedSessionId) ??
    busesOnRoute.find((bus) => passengerLiveBusSelectionKey(bus) === selectedLiveBusKey) ??
    busesOnRoute.find((bus) => bus.busId === selectedBusId);
  const activeBusOnRoute =
    selectedBusOnRoute ??
    busesOnRoute.find((bus) => isPassengerBusSelectable(bus, availabilityNow)) ??
    busesOnRoute[0];
  // Pick a fresh bus for a new selection, then retain that identity through a
  // signal gap instead of silently moving an existing viewer to another bus.
  // A fallback shown while the selected entry is absent never replaces it.
  if (currentView === "tracking" && activeBusOnRoute && (selectedBusOnRoute || (!selectedLiveBusKey && !selectedBusId))) {
    const key = passengerLiveBusSelectionKey(activeBusOnRoute);
    if (key !== selectedLiveBusKey) { setSelectedLiveBusKey(key); setSelectedBusId(activeBusOnRoute.busId); }
  }
  const activeSessionId = activeBusOnRoute?.sessionId;
  const busSelectable = isConnected && !isResuming && !liveDataError && isPassengerBusSelectable(activeBusOnRoute, availabilityNow);
  const selectableBusesOnRoute = busesOnRoute.filter(bus => isConnected && !isResuming && !liveDataError && isPassengerBusSelectable(bus, availabilityNow));
  const directionPending = activeBusOnRoute?.directionState === "pending";
  const normalizedDirection = normalizeRideDirection(activeBusOnRoute?.direction);
  const rideDirectionState = directionPending ? "pending"
    : normalizedDirection === "forward" ? "forward"
    : normalizedDirection === "reverse" ? "reverse" : "pending";
  const directedRoute = useMemo(() => routeInRideDirectionState(activeRoute, rideDirectionState), [activeRoute, rideDirectionState]);
  // Forward order is only the configured preview, never a resolved direction.
  const preview = !directedRoute;
  const mapRoute = useMemo(() => directedRoute ?? (activeRoute ? routeInRideDirection(activeRoute, "forward") : undefined), [directedRoute, activeRoute]);
  const stopEstimates = mapRoute && mapEstimates?.context === stopEstimateContext(mapRoute,
    activeBusOnRoute ? passengerLiveBusSelectionKey(activeBusOnRoute) : undefined, activeBusOnRoute?.routeVersion) ? mapEstimates : undefined;
  const effectiveDestinationStopId =
    mapRoute?.stops?.some((stop) => stop.id === selectedDestinationStopId)
      ? selectedDestinationStopId
      : "";
  const targetStop = mapRoute?.stops?.find(
    (stop) => stop.id === effectiveDestinationStopId,
  ) ||
    (mapRoute?.stops && mapRoute.stops.length > 0
      ? mapRoute.stops[mapRoute.stops.length - 1]
      : (mapRoute?.waypoints && mapRoute.waypoints.length > 0 ? {
        id: "terminus",
        lat: mapRoute.waypoints[mapRoute.waypoints.length - 1].lat,
        lng: mapRoute.waypoints[mapRoute.waypoints.length - 1].lng,
        name: "Final Destination",
        shortName: "TERMINUS"
      } : null));
  const endedMessage = completedRide !== null;

  const visibleView: ViewState = currentView;

  useEffect(() => {
    if (completedRide) return;

    const activeRides = new Map<string, RideIdentity>();
    for (const bus of activeBuses) {
      if (!hasSessionId(bus)) continue;
      activeRides.set(bus.sessionId, {
        sessionId: bus.sessionId,
        busId: bus.busId,
        routeId: bus.routeId,
        driverId: bus.driverId || "",
      });
    }
    const action = decideRideTracking(
      trackedRideRef.current,
      activeRides,
      (sessionId) => latestTripStatesRef.current.get(sessionId),
    );

    switch (action.type) {
      case "complete": {
        // queueMicrotask defers the state update out of the effect body
        // (satisfying react-hooks/set-state-in-effect) while ensuring it
        // cannot be cancelled by effect cleanup the way a setTimeout can.
        const rideToComplete = action.ride;
        pendingCompletionSessionIdRef.current = rideToComplete.sessionId;
        trackedRideRef.current = null;
        queueMicrotask(() => {
          setTrackedSessionId("");
          setJoinedRouteId("");
          setCompletedRide(rideToComplete);
        });
        break;
      }
      case "observe":
        trackedRideRef.current = action.ride;
        break;
      case "freeze":
      case "none":
        // Freeze keeps the original ride identity: never re-bind to a
        // different session after the tracked ride vanished (#68).
        break;
    }
    return undefined;
  }, [activeBuses, completedRide]);

  useEffect(() => {
    if (!completedRide) return;

    const feedbackTimer = setTimeout(() => {
      const currentTripState = latestTripStatesRef.current.get(completedRide.sessionId);
      if (isPostRideFeedbackEligible(completedRide, currentTripState)) {
        setFeedbackSessionId(completedRide.sessionId);
        setFeedbackBusId(completedRide.busId);
        setFeedbackDriverId(completedRide.driverId);
        setShowFeedbackModal(true);
      }
      latestTripStatesRef.current.delete(completedRide.sessionId);
      pendingCompletionSessionIdRef.current = null;
      setCompletedRide(null);
      setCurrentView(view => view === "tracking" ? "home" : view);
      setIsMessagingOpen(false);
    }, POST_RIDE_FEEDBACK_DELAY_MS);

    return () => clearTimeout(feedbackTimer);
  }, [completedRide]);

  const handleOpenMessaging = () => {
    setIsMessagingOpen(true);
    setUnreadCount(0);
  };

  const handleRouteSelect = (routeId: string) => {
    setSelectedRouteId(routeId);
    setSelectedDestinationStopId("");
    setSelectedLiveBusKey("");
    setSelectedBusId("");
    setIsMessagingOpen(false);
    setUnreadCount(0);
    setCurrentView("tracking");
  };

  return (
    <div data-passenger-workspace className="relative flex flex-col overflow-hidden text-white" style={{ height: "100dvh" }}>
      {(isResuming || rideRecoveryNotice || routesError || liveDataError) && <div className="relative z-50 shrink-0 space-y-2 bg-zinc-950 px-4 pb-2 pt-safe">
      {isResuming && (
        <div
          className="flex items-center gap-2 rounded-xl border border-amber-400/20 bg-zinc-950 px-4 py-3 text-sm font-semibold text-amber-300 shadow-lg"
          role="status"
          aria-live="polite"
        >
          <WifiOff className="size-4 shrink-0" aria-hidden="true" />
          <span className="text-pretty">{connectionGeneration === 0 ? "Connecting to live bus data..." : "Reconnecting to live bus data..."}</span>
        </div>
      )}
      {rideRecoveryNotice && <div className="rounded-xl bg-zinc-950 px-4 py-3 text-sm text-amber-300" role="status">{rideRecoveryNotice}</div>}
      {(routesError || liveDataError) && (
        <div
          className="flex items-start gap-3 rounded-xl border border-red-400/20 bg-zinc-950 px-4 py-3 text-sm text-red-300 shadow-lg"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="font-semibold">{routesError ? "Routes could not be loaded." : "Live bus data unavailable."}</p>
            <p className="mt-0.5 text-xs text-red-300/70">{routesError || liveDataError}</p>
          </div>
          <button
            type="button"
            onClick={() => { if (routesError) retryRoutes(); if (catalogError || detailDataError) { retryCatalog(); import("@/lib/liveBusStore").then(module => module.invalidateLiveBusCache()); } if (rideRecoveryError) setRideStatusRetry(value => value + 1); }}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Retry
          </button>
        </div>
      )}
      </div>}
      <div className="relative min-h-0 flex-1 overflow-clip">

        {/* ── HOME VIEW ── */}
        <div inert={visibleView !== "home"} aria-hidden={visibleView !== "home"} className={`absolute inset-0 z-20 flex flex-col pt-safe transition-[opacity,transform] duration-500 ${visibleView === "home" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8 pointer-events-none"}`}>

          {/* Top spacer to frame the bus illustration near the top of the screen */}
          <div className="shrink-0" style={passengerTopSpacerStyle} aria-hidden="true" />

          {/* Unified Transit Panel that fills the rest of the height, with a gap above bottom nav */}
          <div className={`${passengerPanelClassName} flex-1`}
            style={passengerPanelStyle}
          >
            {/* Heading Section - Fixed */}
            <div className="text-center pb-6 mb-4 mx-6 shrink-0">
              <h1 className="text-[32px] font-black tracking-tight mb-2 leading-none" style={{ color: "var(--text-primary)" }}>
                Live Routes
              </h1>
              <p className="text-[15px] font-medium mt-2" style={{ color: "var(--text-secondary)" }}>
                Select a route to view the live bus location.
              </p>
            </div>

            {/* Status / Routes Section - Scrollable */}
            <div
              className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth hide-scrollbar px-4 pb-32"
              style={{ scrollBehavior: 'smooth', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {displayRoutes.length > 0 ? (
                <>
                  {settings.announcementActive && settings.announcementText && (
                    <div
                      className="rounded-2xl p-4 mb-3 mx-1 flex items-center justify-center border text-center"
                      style={{ background: "#4c0519", borderColor: "#881337" }}
                    >
                      <p className="line-clamp-3 break-words min-w-0 text-[13px] font-black tracking-wider uppercase leading-tight text-[#fecdd3]">
                        {settings.announcementText}
                      </p>
                    </div>
                  )}
                  <RouteCarousel
                    routes={displayRoutes}
                    selectedRouteId={effectiveRouteId}
                     onClick={handleRouteSelect}
                     getActiveBusesCount={(routeId) => routeCatalog[routeId]?.active ?? 0}
                     getAvailableBusesCount={(routeId) => routeCatalog[routeId]?.available ?? 0}
                     getDirectionState={(routeId) => {
                       const bus = activeBuses.find((entry) => entry.routeId === routeId && isPassengerBusSelectable(entry, availabilityNow));
                       if (!bus) return "unknown";
                       return bus?.directionState === "pending" ? "pending" : normalizeRideDirection(bus?.direction);
                     }}
                   />
                </>
              ) : (
                <div className="rounded-xl p-8 text-center mx-1 flex flex-col items-center justify-center gap-2"
                  style={{ background: "var(--surface-2)", border: "1px dashed var(--border-default)" }}>
                  {settings.announcementActive && settings.announcementText && (
                    <div className="inline-flex items-center px-4 py-1.5 rounded-full border mb-1"
                      style={{ background: "#4c0519", borderColor: "#881337" }}>
                      <span className="line-clamp-3 break-words min-w-0 text-[12px] font-black tracking-wider uppercase text-[#fecdd3]">
                        {settings.announcementText}
                      </span>
                    </div>
                  )}
                  <p className="text-[13px] font-medium" style={{ color: "var(--text-tertiary)" }}>
                    {settings.noBusesMessage || "No buses running"}
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--text-ghost)" }}>
                    {isResuming
                      ? "Unable to reach live data. Check your connection."
                      : (settings.noBusesSubMessage || "Service starts at {time}").replace("{time}", settings.serviceStartTime || PASSENGER_BUS_START_TIME)}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── TRACKING VIEW ── */}
        <div data-passenger-tracking inert={visibleView !== "tracking"} aria-hidden={visibleView !== "tracking"} className={`absolute inset-0 z-20 flex flex-col pointer-events-none transition-opacity duration-500 ${visibleView === "tracking" ? "opacity-100 bg-zinc-950" : "opacity-0"}`}>
          {!endedMessage && mapRoute && targetStop ? (
            <>
              {/* Top bar: back + route info */}
              <div data-tracking-controls className="absolute inset-x-0 top-0 w-full z-40 pt-safe px-4 pb-4 pointer-events-none"
                style={{ background: "linear-gradient(to bottom, rgba(9,9,11,0.92) 0%, transparent 100%)" }}>
                <div className="flex items-center gap-4 max-w-lg mx-auto pt-4 pointer-events-auto">
                  <button
                    type="button"
                    onClick={() => {
                      if (isMessagingOpen) {
                        setIsMessagingOpen(false);
                        return;
                      }
                      setCurrentView("home");
                    }}
                    className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-90 hover:opacity-90 shadow-sm cursor-pointer pointer-events-auto"
                    style={{ backgroundColor: "var(--surface-3)", border: "1px solid var(--border-subtle)" }}
                    aria-label={isMessagingOpen ? "Close live chat" : "Back to home"}
                    onPointerDown={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-4)")}
                    onPointerUp={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-3)")}
                    onPointerLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-3)")}
                  >
                    <ArrowLeft className="w-5 h-5" style={{ color: "var(--text-secondary)" }} />
                  </button>
                  {activeBusOnRoute ? (
                    <div className="relative z-10 flex-1 min-w-0 flex flex-col gap-2 rounded-2xl p-3 shadow-lg pointer-events-auto"
                      style={{ background: "var(--surface-1)", border: "1px solid var(--border-default)" }}>
                      {(selectableBusesOnRoute.length > 1 || (!busSelectable && selectableBusesOnRoute.length > 0)) &&
                        !busesOnRoute.some(
                          (bus) => bus.sessionId === trackedSessionId,
                        ) && (
                        <InAppSelect
                          name="live-bus"
                          value={passengerLiveBusSelectionKey(activeBusOnRoute)}
                          onChange={(value) => {
                            setSelectedLiveBusKey(value);
                            setSelectedBusId(busesOnRoute.find(bus => passengerLiveBusSelectionKey(bus) === value)?.busId ?? "");
                            setIsMessagingOpen(false);
                          }}
                          style={{
                            background: "var(--surface-2)",
                            border: "1px solid var(--border-subtle)",
                            color: "var(--text-primary)",
                          }}
                          ariaLabel="Live bus"
                          placeholder="Choose a live bus…"
                          options={selectableBusesOnRoute.map(bus => ({
                            value: passengerLiveBusSelectionKey(bus),
                            label: `Bus ${bus.busId} · ${hasSessionId(bus) ? directionLabelState(bus.directionState === "pending" ? "pending" : normalizeRideDirection(bus.direction), activeRoute?.stops ?? []) : "Service not started"}`,
                          }))}
                        />
                      )}
                      {!busSelectable ? (
                        <div role="status">
                          <p className="text-xs font-semibold text-amber-300">Live tracking paused</p>
                          <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                            Location updates are unavailable. The last known location is shown; live ETAs and boarding resume when tracking returns.
                          </p>
                        </div>
                      ) : !preview && directedRoute && hasSessionId(activeBusOnRoute) ? (
                        <PassengerBoardingView
                          key={activeBusOnRoute.sessionId}
                          sessionId={activeBusOnRoute.sessionId}
                          route={directedRoute}
                          stopEstimates={stopEstimates}
                          tripState={activeBusOnRoute.tripState === "in_service" ? "in_service" : "pre_departure"}
                          destinationStopId={effectiveDestinationStopId}
                          restoredBoarding={restoredBoarding && restoredBoarding.uid === user?.uid && restoredBoarding.sessionId === activeBusOnRoute.sessionId ? restoredBoarding : undefined}
                          onDestinationStopChange={setSelectedDestinationStopId}
                          onJoined={() => {
                            boardingRevisionRef.current++;
                            if (user?.role === "passenger") saveJoinedRidePointer(user.uid, activeBusOnRoute.sessionId);
                            trackedRideRef.current = recordSuccessfulJoin(
                              trackedRideRef.current,
                              {
                                sessionId: activeBusOnRoute.sessionId,
                                busId: activeBusOnRoute.busId,
                                routeId: activeBusOnRoute.routeId,
                                driverId: activeBusOnRoute.driverId || "",
                              },
                            );
                            setTrackedSessionId(activeBusOnRoute.sessionId);
                            setJoinedRouteId(activeBusOnRoute.routeId);
                            setRideRecoveryError(null); setRideRecoveryNotice(null);
                          }}
                        />
                      ) : (
                        <div>
                          <p className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
                            {hasSessionId(activeBusOnRoute) ? "Direction pending" : "Bus online · service not started"}
                          </p>
                          <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                            {hasSessionId(activeBusOnRoute)
                              ? "Live location and configured route shown. Travel order and ETAs appear once direction is resolved."
                              : "Live location and configured route shown. Boarding and ETAs appear when service starts."}
                          </p>
                        <InAppSelect
                          name="destination-station"
                          ariaLabel="Destination station"
                          placeholder="Choose destination station…"
                          value={effectiveDestinationStopId}
                          onChange={setSelectedDestinationStopId}
                          options={[
                            { value: "", label: "Choose destination station…" },
                            ...(mapRoute.stops ?? []).map((stop, index) => ({
                              value: stop.id,
                              label: stop.name,
                              detail: stopEstimateLabel(stopEstimates ?? { context: "", minutes: {}, unavailable: hasSessionId(activeBusOnRoute) ? "Direction pending" : "Service not started" }, stop.id, index),
                            })),
                          ]}
                          style={{
                            background: "var(--surface-2)",
                            border: "1px solid var(--border-subtle)",
                          }}
                        />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5 rounded-2xl bg-[var(--surface-1)] p-3 shadow-lg pointer-events-auto">
                      <p className="text-[11px] font-semibold uppercase tracking-widest leading-none" style={{ color: "var(--accent)" }}>
                        Waiting for live bus data…
                      </p>
                      <p className="break-words text-pretty text-[17px] font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>
                        {mapRoute.name}
                      </p>
                    </div>
                  )}
                </div>
                {/* Keep chat in header flow, below the variable-height boarding card. */}
                {busSelectable && activeSessionId && isLiveChatDeviceOnline(activeBusOnRoute) && !isMessagingOpen && (
                  <div className="mt-2 flex justify-end max-w-lg mx-auto animate-scale-in pointer-events-none">
                    <button
                      onClick={handleOpenMessaging}
                      className="w-12 h-12 rounded-xl flex items-center justify-center transition-all active:scale-95 relative pointer-events-auto"
                      style={{
                        background: "var(--surface-2)",
                        border: "1px solid var(--border-default)",
                        boxShadow: "0 4px 16px rgba(0,0,0,0.3)"
                      }}
                      aria-label={activeSessionId ? "Open live chat" : "Open live chat status"}
                      title={activeSessionId ? "Open live chat" : "Device online; chat will unlock when the ride is armed"}
                    >
                      <MessageCircle className="w-5 h-5" style={{ color: "var(--status-live)" }} />
                      {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-semibold text-white px-1"
                          style={{ background: "var(--status-danger)", boxShadow: "0 0 0 2px var(--surface-0)" }}>
                          {unreadCount > 9 ? "9+" : unreadCount}
                        </span>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Full-bleed map; camera padding and notices measure the overlay. */}
              <div className="absolute inset-0 z-0 pointer-events-auto">
                {visibleView === "tracking" && (
                  <PassengerTrackingMap
                    targetStop={targetStop}
                    selectedDestinationStopId={effectiveDestinationStopId}
                    onStopEstimatesChange={updateStopEstimates}
                    route={mapRoute}
                    resumeGeneration={resumeGeneration}
                    liveUpdatesAvailable={isConnected && !isResuming && !liveDataError}
                    preview={preview}
                    selectedBusKey={activeBusOnRoute ? passengerLiveBusSelectionKey(activeBusOnRoute) : undefined}
                  />
                )}
              </div>

              {/* Messaging Overlay */}
              {visibleView === "tracking" && busSelectable && activeSessionId && isMessagingOpen && isLiveChatDeviceOnline(activeBusOnRoute) && (
                <div className="absolute inset-x-0 top-16 bottom-[80px] z-50 animate-slide-up flex flex-col pointer-events-auto">
                   <MessagingPanel
                    key={activeSessionId || "online-no-session"}
                     sessionId={activeSessionId || ""}
                    currentUserRole="passenger"
                    currentUserId={user?.uid || "anonymous"}
                    isOverlay={true}
                    onClose={() => setIsMessagingOpen(false)}
                    onUnreadCountChange={setUnreadCount}
                    unavailableMessage={activeSessionId ? undefined : "The bus device is online. Chat will unlock when the administrator arms the ride."}
                  />
                </div>
              )}
            </>
          ) : endedMessage ? (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center px-10 text-center animate-fade-in pointer-events-auto"
              style={{ background: "rgba(9, 9, 11, 0.9)" }}>
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
                style={{ background: "var(--status-danger-bg)", border: "1px solid rgba(248, 113, 113, 0.15)" }}>
                <Flag className="w-8 h-8" style={{ color: "var(--status-danger)" }} />
              </div>
              <p className="text-xl font-extrabold tracking-tight mb-2" style={{ color: "var(--text-primary)" }}>
                Route ended
              </p>
              <p className="text-[13px] mb-6 max-w-xs" style={{ color: "var(--text-tertiary)" }}>
                The bus has reached the terminus.
              </p>
              <div className="flex items-center gap-2 px-5 py-2.5 rounded-xl"
                style={{ background: "var(--status-live-bg)" }}>
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--status-live)" }} />
                <p className="text-[11px] font-semibold" style={{ color: "var(--status-live)" }}>
                  Waiting for next bus
                </p>
              </div>
              <button
                onClick={() => {
                  setCurrentView("home");
                }}
                className="mt-6 px-6 py-2.5 rounded-xl text-[13px] font-semibold transition-all active:scale-95"
                style={{ background: "rgba(255,255,255,0.1)", color: "white", border: "1px solid rgba(255,255,255,0.05)" }}
              >
                Return to Routes
              </button>
            </div>
          ) : null}
        </div>

        {/* ── PROFILE VIEW ── */}
        <div inert={visibleView !== "profile"} aria-hidden={visibleView !== "profile"} className={`absolute inset-0 z-30 flex flex-col transition-[opacity,transform] duration-500 ${visibleView === "profile" ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-8 pointer-events-none"}`}>
          {visibleView === "profile" && <AccountTab />}
        </div>
      </div>

      {showFeedbackModal && (
        <FeedbackModal
          userId={user?.uid || "anonymous"}
          busId={feedbackBusId}
          driverId={feedbackDriverId}
          sessionId={feedbackSessionId}
          onClose={() => setShowFeedbackModal(false)}
        />
      )}

      {/* Bottom Navigation — Fixed Transit Tab Bar */}
      <div className="absolute bottom-0 inset-x-0 z-[100] pb-safe pointer-events-none flex justify-center">
        <nav className="w-full pointer-events-auto flex items-center justify-around px-2 py-2.5 rounded-t-[24px]"
          style={{
            background: "rgba(22, 22, 26, 0.98)",
            borderTop: "1px solid rgba(255, 255, 255, 0.15)",
          }}>
          <button
            onClick={() => {
              setIsMessagingOpen(false);
              setCurrentView("home");
            }}
            className="flex flex-col items-center justify-center h-[60px] w-[140px] rounded-[20px] transition-all duration-300 relative group active:scale-95 gap-1.5"
            style={{
              background: (visibleView === "home" || visibleView === "tracking") ? "rgba(255,255,255,0.08)" : "transparent"
            }}
          >
            <MapIcon className="w-[22px] h-[22px] transition-colors" strokeWidth={2.5} style={{
              color: (visibleView === "home" || visibleView === "tracking") ? "var(--text-primary)" : "var(--text-tertiary)"
            }} />
            <span className="text-[13px] font-bold transition-colors leading-none" style={{
              color: (visibleView === "home" || visibleView === "tracking") ? "var(--text-primary)" : "var(--text-tertiary)"
            }}>
              Routes
            </span>
          </button>

          <button
            onClick={() => setCurrentView("profile")}
            className="flex flex-col items-center justify-center h-[60px] w-[140px] rounded-[20px] transition-all duration-300 relative group active:scale-95 gap-1.5"
            style={{
              background: visibleView === "profile" ? "rgba(255,255,255,0.08)" : "transparent"
            }}
          >
            <User className="w-[22px] h-[22px] transition-colors" strokeWidth={2.5} style={{
              color: visibleView === "profile" ? "var(--text-primary)" : "var(--text-tertiary)"
            }} />
            <span className="text-[13px] font-bold transition-colors leading-none" style={{
              color: visibleView === "profile" ? "var(--text-primary)" : "var(--text-tertiary)"
            }}>
              Profile
            </span>
          </button>
        </nav>
      </div>
    </div>
  );
}
