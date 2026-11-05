"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/hooks/useAuth";
import { useRoutes } from "@/hooks/useRoutes";
import { MapPinned, UserRound, Loader2, MessageCircle, ArrowLeft, Flag, WifiOff, AlertCircle, Info, Megaphone } from "lucide-react";
import { subscribeLiveBusChangesByRoute } from "@/lib/liveBusStore";
import { useLiveRouteCatalog } from "@/hooks/useLiveRouteCatalog";
import { getJoinedRideStatus } from "@/lib/joinedRideStatus";
import { clearJoinedRidePointer, readJoinedRidePointer, saveJoinedRidePointer } from "@/lib/joinedRidePointer";
import { getAuthVerificationGeneration } from "@/lib/authState";
import { PASSENGER_BUS_START_TIME } from "@/config/passenger";
import { useSettings } from "@/hooks/useSettings";
import { formatNoBusesSubMessage } from "@/lib/serviceMessages";
import { isAuthoritativeLiveBusDelivery } from "@/lib/liveBusDelivery";
import {
  passengerLiveBuses,
  passengerLiveBusSelectionKey,
  passengerTripStates,
  type PassengerLiveBus,
} from "@/lib/passengerLiveBus";
import { serverNow } from "@/lib/serverClock";
import { useRTDBResume } from "@/hooks/useRTDBResume";
import { isPassengerBusSelectable } from "@/lib/passengerAvailability";
import { describeLiveBusHealth, liveBusHealth } from "@/lib/liveBusHealth";
import {
  passengerNavClassName,
  passengerNavClearance,
  passengerNavFrameClassName,
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
import PassengerDate from "@/components/passenger/ui/PassengerDate";
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
const RoutesTab = dynamic(() => import("@/components/passenger/RoutesTab"), { ssr: false });
const MessagingPanel = dynamic(() => import("@/components/shared/MessagingPanel"), { ssr: false });
const FeedbackModal = dynamic(() => import("@/components/shared/FeedbackModal"), { ssr: false });
const PassengerBoardingView = dynamic(() => import("@/components/passenger/PassengerBoardingView"), { ssr: false });

type ViewState = "home" | "tracking" | "routes" | "profile";
type PassengerSection = Exclude<ViewState, "tracking">;

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
  // Profile mounts on first visit and then stays mounted (inert while hidden),
  // so leaving it neither blanks the fading view nor discards its local state.
  const [profileMounted, setProfileMounted] = useState(false);
  // The route schedule follows the same mount-once rule as Profile.
  const [routesMounted, setRoutesMounted] = useState(false);
  const [isMessagingOpen, setIsMessagingOpen] = useState(false);
  const showSection = useCallback((section: PassengerSection) => {
    setIsMessagingOpen(false);
    if (section === "routes") setRoutesMounted(true);
    if (section === "profile") setProfileMounted(true);
    setCurrentView(section);
  }, []);

  useEffect(() => {
    const syncSection = () => {
      const hash = window.location.hash;
      showSection(hash === "#routes" ? "routes" : hash === "#profile" ? "profile" : "home");
    };
    // Leave the default Map view alone so an in-progress ride can restore normally.
    const initial = window.location.hash ? window.requestAnimationFrame(syncSection) : 0;
    window.addEventListener("popstate", syncSection);
    return () => {
      window.cancelAnimationFrame(initial);
      window.removeEventListener("popstate", syncSection);
    };
  }, [showSection]);

  function navigateSection(section: PassengerSection) {
    const hash = section === "home" ? "" : "#" + section;
    const { pathname, search } = window.location;
    if (window.location.hash !== hash) window.history.pushState(null, "", pathname + search + hash);
    showSection(section);
  }

  const { routes, error: routesError, retry: retryRoutes } = useRoutes();
  const { catalog: routeCatalog, projectionReady, catalogReady, error: catalogError, retry: retryCatalog } = useLiveRouteCatalog(`${connectionGeneration}:${resumeGeneration}`);
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [selectedDestinationStopId, setSelectedDestinationStopId] = useState("");
  const [mapEstimates, setMapEstimates] = useState<PassengerStopEstimates>();
  const updateStopEstimates = useCallback((next: PassengerStopEstimates) => {
    setMapEstimates(current => current?.context === next.context && current.nextStopIndex === next.nextStopIndex &&
      current.atStopIndex === next.atStopIndex &&
      (current.unobservedStopIndices ?? []).join(",") === (next.unobservedStopIndices ?? []).join(",") &&
      current.unavailable === next.unavailable && Object.keys(current.minutes).length === Object.keys(next.minutes).length &&
      Object.entries(next.minutes).every(([id, minutes]) => current.minutes[id] === minutes) ? current : next);
  }, []);
  const [selectedLiveBusKey, setSelectedLiveBusKey] = useState("");
  const [selectedBusId, setSelectedBusId] = useState("");
  const [activeBuses, setActiveBuses] = useState<ActiveBusData[]>([]);
  const [availableBuses, setAvailableBuses] = useState<PassengerBusAvailability[]>([]);
  const [availabilityNow, setAvailabilityNow] = useState(() => serverNow());
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
            passengerLiveBuses(merged, serverNow()).map((bus) => [
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
            const oldNormalized = passengerLiveBuses({ [change.key]: previous }, serverNow())[0];
            if (oldNormalized) {
              activeLiveBusesRef.current.delete(passengerLiveBusSelectionKey(oldNormalized));
            }
          }
          if (change.type === "remove") {
            rawLiveBusesRef.current.delete(change.key);
          } else {
            rawLiveBusesRef.current.set(change.key, change.value);
            const nextBus = passengerLiveBuses({ [change.key]: change.value }, serverNow())[0];
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
          serverNow(),
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
      const now = serverNow();
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
  // Lifecycle ("in service") is not location freshness: say which one failed.
  const activeBusHealth = activeBusOnRoute ? liveBusHealth(activeBusOnRoute, availabilityNow) : undefined;
  // Blame the connection only while the socket is down; a connected client
  // can still be waiting on the backend projection.
  const pausedNotice = !isConnected
    ? { title: "Live tracking paused", detail: "This device is reconnecting to live bus data. The last known location is shown; live ETAs and boarding resume when the connection returns." }
    : isResuming || liveDataError
      ? { title: "Live tracking paused", detail: "Live bus data is not available right now. The last known location is shown; live ETAs and boarding resume when it returns." }
      : activeBusOnRoute?.automaticServicePaused === true
        ? { title: "Tracking paused", detail: "Service is paused for this bus. Its location is shown, but there is no live ride to board." }
        : activeBusHealth && activeBusHealth.state !== "live" && activeBusHealth.state !== "delayed"
          ? describeLiveBusHealth(activeBusHealth)
          : { title: "Live tracking paused", detail: "Location updates are unavailable. The last known location is shown; live ETAs and boarding resume when tracking returns." };
  // Chat is between passenger and driver; it needs the connection and a
  // reporting bus, not a GPS fix. A GNSS blip must not close or reset it.
  const chatAvailable = isConnected && !isResuming && !liveDataError && activeBusOnRoute?.automaticServicePaused !== true &&
    (activeBusHealth?.state === "live" || activeBusHealth?.state === "delayed" || activeBusHealth?.state === "gnss_lost");
  const chatShown = (view: ViewState) => view === "tracking" && isMessagingOpen && chatAvailable && Boolean(activeSessionId) &&
    isLiveChatDeviceOnline(activeBusOnRoute);
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
  const keyboardRouteButton = useRef<HTMLButtonElement | null>(null);
  const trackingBackButton = useRef<HTMLButtonElement>(null);
  const liveRoutesHeading = useRef<HTMLHeadingElement>(null);
  const liveRouteScroller = useRef<HTMLDivElement>(null);
  const liveRouteContent = useRef<HTMLDivElement>(null);
  const [hasMoreRoutes, setHasMoreRoutes] = useState(false);

  useEffect(() => {
    const scroller = liveRouteScroller.current;
    const content = liveRouteContent.current;
    if (!scroller || !content || typeof ResizeObserver === "undefined") return;
    const update = () => {
      setHasMoreRoutes(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 1);
    };
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    observer.observe(content);
    scroller.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", update);
    };
  }, []);

  useEffect(() => {
    const routeButton = keyboardRouteButton.current;
    if (!routeButton) return;
    if (visibleView === "tracking") {
      trackingBackButton.current?.focus({ preventScroll: true });
    } else {
      // Only Back from tracking returns focus to the route; leaving for another
      // section forgets it, so a later tap on the first tab keeps focus there.
      keyboardRouteButton.current = null;
      if (visibleView === "home") (routeButton.isConnected ? routeButton : liveRoutesHeading.current)?.focus();
    }
  }, [visibleView]);

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
    const focused = document.activeElement;
    keyboardRouteButton.current =
      focused instanceof HTMLButtonElement && focused.dataset.passengerRoute === routeId && focused.matches(":focus-visible")
        ? focused : null;
    setSelectedRouteId(routeId);
    setSelectedDestinationStopId("");
    setSelectedLiveBusKey("");
    setSelectedBusId("");
    setIsMessagingOpen(false);
    setUnreadCount(0);
    setCurrentView("tracking");
  };

  const announcement = settings.announcementActive && settings.announcementText ? (
    <div className="pp-announcement" role="note">
      <Megaphone className="size-5" aria-hidden="true" />
      <p className="min-w-0">{settings.announcementText}</p>
    </div>
  ) : null;
  // Only ride-recovery messages are written for riders; the others name internals.
  const plainDataError = !routesError && !catalogError && !detailDataError && rideRecoveryError
    ? rideRecoveryError
    : "Check your connection, then try again.";

  return (
    <div data-passenger-workspace data-passenger-section={visibleView} className="pp-workspace relative flex flex-col overflow-hidden" style={{ height: "100dvh" }}>
      {(!isConnected || rideRecoveryNotice || routesError || liveDataError) && <div className="pp-alerts relative z-50 shrink-0 space-y-2 px-4 pb-2 pt-safe">
      {!isConnected && (
        <div className="pp-banner" data-tone="warning" role="status" aria-live="polite">
          <WifiOff className="size-4" aria-hidden="true" />
          <span className="text-pretty">{connectionGeneration === 0 ? "Connecting to live bus data…" : "Reconnecting to live bus data…"}</span>
        </div>
      )}
      {rideRecoveryNotice && (
        <div className="pp-banner" data-tone="warning" role="status">
          <Info className="size-4" aria-hidden="true" />
          <span>{rideRecoveryNotice}</span>
        </div>
      )}
      {(routesError || liveDataError) && (
        <div className="pp-banner" data-tone="danger" role="alert">
          <AlertCircle className="size-4" aria-hidden="true" />
          <div className="flex-1">
            <p className="pp-banner-title">{routesError ? "Routes could not be loaded." : "Live bus data is unavailable."}</p>
            <p className="pp-banner-detail">{plainDataError}</p>
          </div>
          <button
            type="button"
            onClick={() => { if (routesError) retryRoutes(); if (catalogError || detailDataError) { retryCatalog(); import("@/lib/liveBusStore").then(module => module.invalidateLiveBusCache()); } if (rideRecoveryError) setRideStatusRetry(value => value + 1); }}
            className="pp-btn-secondary shrink-0"
          >
            Retry
          </button>
        </div>
      )}
      </div>}
      <main className="relative min-h-0 flex-1 overflow-clip">

        {/* ── HOME VIEW ── */}
        <div inert={visibleView !== "home"} aria-hidden={visibleView !== "home"} className={`passenger-home absolute inset-0 z-20 flex flex-col pt-safe transition-[opacity,transform] duration-200 ${visibleView === "home" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"}`}>

          {/* Top spacer to frame the bus illustration near the top of the screen */}
          <div className="shrink-0" style={passengerTopSpacerStyle} aria-hidden="true" />

          {/* Unified Transit Panel that fills the rest of the height, with a gap above bottom nav */}
          <div className={`${passengerPanelClassName} flex-1`}
            style={passengerPanelStyle}
          >
            {/* Heading Section - Fixed */}
            <div className="passenger-home-heading pp-home-heading pb-5 mb-3 mx-6 shrink-0">
              <PassengerDate />
              <div className="passenger-home-title">
                <h1 ref={liveRoutesHeading} tabIndex={-1} className="pp-title">
                  Live routes
                </h1>
                <span className="passenger-home-count">
                  {displayRoutes.length} {displayRoutes.length === 1 ? "route" : "routes"}
                </span>
              </div>
              <p className="pp-subtitle">
                Select a route to view the live bus location.
              </p>
              <hr className="pp-rule" aria-hidden="true" />
            </div>

            {/* Status / Routes Section - Scrollable */}
            <div
              ref={liveRouteScroller}
              className="passenger-live-route-scroll flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-32"
            >
              <div ref={liveRouteContent}>
                {displayRoutes.length > 0 ? (
                  <>
                    {announcement}
                    <RouteCarousel
                      routes={displayRoutes}
                      selectedRouteId={selectedRouteId}
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
                  <div className="pp-empty">
                    {announcement}
                    <p className="pp-empty-title">
                      {settings.noBusesMessage || "No buses running"}
                    </p>
                    <p className="pp-empty-detail">
                      {!isConnected
                        ? "Unable to reach live data. Check your connection."
                        : isResuming || liveDataError
                          ? "Live bus data is not available right now."
                          : formatNoBusesSubMessage(settings.noBusesSubMessage || "Service starts at {time}", settings.serviceStartTime || PASSENGER_BUS_START_TIME)}
                    </p>
                  </div>
                )}
              </div>
            </div>
            {displayRoutes.length > 0 && (
              <p className="passenger-home-scroll-hint" aria-hidden="true" data-overflow={hasMoreRoutes}>
                Scroll for more routes
              </p>
            )}
          </div>
        </div>

        {/* ── TRACKING VIEW ── */}
        <div data-passenger-tracking inert={visibleView !== "tracking"} aria-hidden={visibleView !== "tracking"} className={`absolute inset-0 z-20 flex flex-col pointer-events-none transition-opacity duration-200 ${visibleView === "tracking" ? "opacity-100 bg-[var(--pp-page)]" : "opacity-0"}`}>
          {!endedMessage && mapRoute && targetStop ? (
            <>
              {/* Top bar: back + route info */}
              <div data-tracking-controls className="pp-tracking-scrim absolute inset-x-0 top-0 w-full z-40 pt-safe px-4 pb-4 pointer-events-none">
                <h1 className="sr-only">{mapRoute.name}</h1>
                <div className="flex items-center gap-4 max-w-lg mx-auto pt-4 pointer-events-auto">
                  <button
                    ref={trackingBackButton}
                    type="button"
                    onClick={() => {
                      if (chatShown(visibleView)) {
                        setIsMessagingOpen(false);
                        return;
                      }
                      setIsMessagingOpen(false);
                      setCurrentView("home");
                    }}
                    className="pp-icon-button cursor-pointer pointer-events-auto"
                    aria-label={chatShown(visibleView) ? "Close live chat" : "Back to home"}
                  >
                    <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                  </button>
                  {activeBusOnRoute ? (
                    <div className="pp-float-card relative z-10 flex-1 min-w-0 flex flex-col gap-2 p-3 pointer-events-auto">
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
                          ariaLabel="Live bus"
                          placeholder="Choose a live bus…"
                          options={selectableBusesOnRoute.map(bus => ({
                            value: passengerLiveBusSelectionKey(bus),
                            label: `Bus ${bus.busId} · ${hasSessionId(bus) ? directionLabelState(bus.directionState === "pending" ? "pending" : normalizeRideDirection(bus.direction), activeRoute?.stops ?? []) : "Service not started"}`,
                          }))}
                        />
                      )}
                      {!busSelectable && (
                        <div role="status" aria-live="polite">
                          <p className="pp-status-title" data-tone={"tone" in pausedNotice && pausedNotice.tone === "danger" ? "danger" : "warning"}>{pausedNotice.title}</p>
                          <p className="pp-status-detail">
                            {pausedNotice.detail}
                          </p>
                        </div>
                      )}
                      {/* The boarding card stays mounted through a tracking blip so a
                          chosen stop, an in-flight join and "On board" survive it. */}
                      {!preview && directedRoute && hasSessionId(activeBusOnRoute) ? (
                        <PassengerBoardingView
                          key={activeBusOnRoute.sessionId}
                          sessionId={activeBusOnRoute.sessionId}
                          route={directedRoute}
                          stopEstimates={stopEstimates}
                          tripState={activeBusOnRoute.tripState === "in_service" ? "in_service" : "pre_departure"}
                          liveHealth={activeBusHealth}
                          boardingBlockedReason={busSelectable ? undefined : "Boarding resumes when live tracking returns."}
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
                      ) : busSelectable ? (
                        <div className="flex flex-col gap-2">
                          <div>
                          <p className="pp-status-title">
                            {hasSessionId(activeBusOnRoute) ? "Direction pending" : "Bus online · service not started"}
                          </p>
                          <p className="pp-status-detail">
                            {hasSessionId(activeBusOnRoute)
                              ? "Live location and configured route shown. Travel order and ETAs appear once direction is resolved."
                              : "Live location and configured route shown. Boarding and ETAs appear when service starts."}
                          </p>
                          </div>
                        <InAppSelect
                          name="destination-station"
                          ariaLabel="Destination station"
                          placeholder="Choose destination stop"
                          value={effectiveDestinationStopId}
                          onChange={setSelectedDestinationStopId}
                          options={[
                            { value: "", label: "Choose destination stop" },
                            ...(mapRoute.stops ?? []).map((stop, index) => ({
                              value: stop.id,
                              label: stop.name,
                              detail: stopEstimateLabel(stopEstimates ?? { context: "", minutes: {}, unavailable: hasSessionId(activeBusOnRoute) ? "Direction pending" : "Service not started" }, stop.id, index),
                            })),
                          ]}
                        />
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="pp-float-card min-w-0 flex-1 flex flex-col justify-center gap-1 p-3 pointer-events-auto">
                      <p className="pp-status-title">
                        Waiting for live bus data…
                      </p>
                      <p className="pp-tracking-route break-words text-pretty">
                        {mapRoute.name}
                      </p>
                    </div>
                  )}
                </div>
                {/* Keep chat in header flow, below the variable-height boarding card. */}
                {chatAvailable && activeSessionId && isLiveChatDeviceOnline(activeBusOnRoute) && !chatShown(visibleView) && (
                  <div className="mt-2 flex justify-end max-w-lg mx-auto animate-scale-in pointer-events-none">
                    <button
                      onClick={handleOpenMessaging}
                      className="pp-map-button relative pointer-events-auto"
                      aria-label={activeSessionId ? "Open live chat" : "Open live chat status"}
                      title={activeSessionId ? "Open live chat" : "Device online; chat will unlock when the ride is armed"}
                    >
                      <MessageCircle className="w-5 h-5" aria-hidden="true" style={{ color: "var(--accent)" }} />
                      {unreadCount > 0 && (
                        <span className="pp-unread">
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
              {chatShown(visibleView) && activeSessionId && (
                <div className="absolute inset-x-0 top-16 z-50 animate-slide-up flex flex-col pointer-events-auto" style={{ bottom: passengerNavClearance }}>
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
            <div className="pp-ended absolute inset-0 z-30 flex flex-col items-center justify-center px-10 text-center animate-fade-in pointer-events-auto">
              <div className="pp-ended-icon">
                <Flag className="w-8 h-8" aria-hidden="true" />
              </div>
              <h1 className="pp-ended-title">
                Route ended
              </h1>
              <p className="pp-subtitle max-w-xs">
                The bus has reached the terminus.
              </p>
              <p className="pp-ended-wait" role="status">
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Waiting for the next bus
              </p>
              <button
                type="button"
                onClick={() => {
                  setCurrentView("home");
                }}
                className="pp-btn-secondary mt-6"
              >
                Return to live routes
              </button>
            </div>
          ) : null}
        </div>

        {/* ── ROUTES (SCHEDULE) VIEW ── */}
        <div inert={visibleView !== "routes"} aria-hidden={visibleView !== "routes"} className={`absolute inset-0 z-30 flex flex-col transition-[opacity,transform] duration-200 ${visibleView === "routes" ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-2 pointer-events-none"}`}>
          {routesMounted && <RoutesTab />}
        </div>

        {/* ── PROFILE VIEW ── */}
        <div inert={visibleView !== "profile"} aria-hidden={visibleView !== "profile"} className={`absolute inset-0 z-30 flex flex-col transition-[opacity,transform] duration-200 ${visibleView === "profile" ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-2 pointer-events-none"}`}>
          {profileMounted && <AccountTab />}
        </div>
      </main>

      {showFeedbackModal && (
        <FeedbackModal
          userId={user?.uid || "anonymous"}
          busId={feedbackBusId}
          driverId={feedbackDriverId}
          sessionId={feedbackSessionId}
          onClose={() => setShowFeedbackModal(false)}
        />
      )}

      <div className={passengerNavFrameClassName + " z-[100]"}>
        <nav aria-label="Passenger sections" className={passengerNavClassName}>
          <button type="button" className="passenger-section-button"
            aria-current={visibleView === "home" || visibleView === "tracking" ? "page" : undefined}
            onClick={() => navigateSection("home")}>
            <MapPinned size={24} strokeWidth={2} aria-hidden="true" />
            <span>Live</span>
          </button>

          <button type="button" className="passenger-section-button"
            aria-current={visibleView === "routes" ? "page" : undefined}
            onClick={() => navigateSection("routes")}>
            <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M6 12h12" />
              <circle cx="4" cy="12" r="2" fill="currentColor" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
              <circle cx="20" cy="12" r="2" fill="currentColor" />
            </svg>
            <span>Routes</span>
          </button>

          <button type="button" className="passenger-section-button"
            aria-current={visibleView === "profile" ? "page" : undefined}
            onClick={() => navigateSection("profile")}>
            <UserRound size={24} strokeWidth={2} aria-hidden="true" />
            <span>Profile</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
