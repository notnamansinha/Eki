"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/hooks/useAuth";
import { useRoutes } from "@/hooks/useRoutes";
import { MapPinned as MapIcon, CircleUserRound as User, Loader2, MessageCircle, ArrowLeft, Flag, WifiOff, AlertCircle } from "lucide-react";
import { subscribeLiveBuses } from "@/lib/liveBusStore";
import { PASSENGER_BUS_START_TIME } from "@/config/passenger";
import { useSettings } from "@/hooks/useSettings";
import { hasValidBusCoordinates } from "@/lib/liveBusFreshness";
import { isActiveRideSnapshot } from "@/lib/liveBusSnapshot";
import { isAuthoritativeLiveBusDelivery } from "@/lib/liveBusDelivery";
import { useRTDBResume } from "@/hooks/useRTDBResume";
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

interface ActiveBusData {
  busId: string;
  routeId: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  status?: "active" | "offline";
  deviceState: "online" | "offline";
  tripState: "pre_departure" | "in_service" | "completed";
  motionState: "moving" | "stopped" | "uncertain";
  timestamp: number;
  driverId?: string;
  currentStopIndex?: number;
  delayMinutes?: number;
  sessionId?: string;
}

type ActiveSessionBusData = ActiveBusData & { sessionId: string };

function hasSessionId(bus: ActiveBusData): bus is ActiveSessionBusData {
  return typeof bus.sessionId === "string" && bus.sessionId.length > 0;
}

export default function PassengerWorkspace() {
  const {
    isResuming,
    resumeGeneration,
    connectionGeneration,
    markSnapshotReceived,
  } = useRTDBResume();
  const { user } = useAuth();
  const { settings } = useSettings();
  const [currentView, setCurrentView] = useState<ViewState>("home");
  const { routes, error: routesError, retry: retryRoutes } = useRoutes();
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [selectedBoardingStopId, setSelectedBoardingStopId] = useState("");
  const [selectedLiveSessionId, setSelectedLiveSessionId] = useState("");
  const [activeBuses, setActiveBuses] = useState<ActiveBusData[]>([]);
  const [isMessagingOpen, setIsMessagingOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackBusId, setFeedbackBusId] = useState("");
  const [feedbackDriverId, setFeedbackDriverId] = useState("");
  const [feedbackSessionId, setFeedbackSessionId] = useState("");
  const [completedRide, setCompletedRide] = useState<TrackedRide | null>(null);
  const [trackedSessionId, setTrackedSessionId] = useState("");
  const trackedRideRef = useRef<TrackedRide | null>(null);
  const pendingCompletionSessionIdRef = useRef<string | null>(null);
  const latestTripStatesRef = useRef<Map<string, ActiveBusData["tripState"]>>(new Map());

  // Listen to Firebase Realtime Database for active buses using the existing
  // Firebase session established by the root auth provider.
  // Visibility is now driven purely by tripState (computed by the backend trip
  // state machine). The old frontend departure-detection hack is gone.
  useEffect(() => {
    const unsubscribe = subscribeLiveBuses((snapshot, source) => {
        const data = snapshot as Record<string, ActiveBusData> | null;
        const newBuses: ActiveBusData[] = [];
        const nextTripStates = new Map<string, ActiveBusData["tripState"]>();

        if (data) {
          Object.entries(data as Record<string, ActiveBusData>).forEach(([key, bus]) => {
            const normalizedBus = bus.busId
              ? bus
              : { ...bus, busId: key.split("_")[0] };
            if (normalizedBus.sessionId) {
              nextTripStates.set(
                normalizedBus.sessionId,
                normalizedBus.tripState,
              );
            }
            // Safety net: discard stale entries while RTDB cleanup catches up.
            if (
              !normalizedBus.routeId ||
              !normalizedBus.busId ||
              !hasValidBusCoordinates(normalizedBus.lat, normalizedBus.lng)
            ) {
              return;
            }

            // Show bus if it's actively tracking — allow pre_departure so the
            // backend tripState geofence doesn't hide a freshly started driver.
            if (
              !isActiveRideSnapshot(
                normalizedBus as unknown as Record<string, unknown>,
              )
            ) return;

            newBuses.push(normalizedBus);
          });
        }

        const trackedRideSessionId =
          trackedRideRef.current?.sessionId ?? pendingCompletionSessionIdRef.current;
        if (trackedRideSessionId && !nextTripStates.has(trackedRideSessionId)) {
          const previousState = latestTripStatesRef.current.get(trackedRideSessionId);
          if (previousState) nextTripStates.set(trackedRideSessionId, previousState);
        }
        latestTripStatesRef.current = nextTripStates;
        setActiveBuses(newBuses);
        if (isAuthoritativeLiveBusDelivery(source)) {
          markSnapshotReceived();
        }
      }, (error) => {
        console.warn("[RTDB] activeBuses read failed:", error.message);
      });

    return () => {
      unsubscribe();
    };
  }, [connectionGeneration, markSnapshotReceived, resumeGeneration]);

  const sessionBuses = activeBuses.filter(hasSessionId);
  const activeRouteIds = Array.from(new Set(sessionBuses.map(b => b.routeId)));
  const availableRoutes = routes.filter(r => activeRouteIds.includes(r.id));
  const displayRoutes = availableRoutes.filter(
    (route) => (route.stops?.length ?? 0) > 0 || (route.waypoints?.length ?? 0) > 0,
  );
  const effectiveRouteId = displayRoutes.some(route => route.id === selectedRouteId)
    ? selectedRouteId
    : displayRoutes[0]?.id ?? "";
  const activeRoute = displayRoutes.find(route => route.id === effectiveRouteId);
  const effectiveStopId =
    activeRoute?.stops?.some((stop) => stop.id === selectedBoardingStopId)
      ? selectedBoardingStopId
      : activeRoute?.stops?.[0]?.id ?? "";

  const targetStop = activeRoute?.stops?.find(s => s.id === effectiveStopId) ||
    (activeRoute?.stops && activeRoute.stops.length > 0
      ? activeRoute.stops[activeRoute.stops.length - 1]
      : (activeRoute?.waypoints && activeRoute.waypoints.length > 0 ? {
        id: "terminus",
        lat: activeRoute.waypoints[activeRoute.waypoints.length - 1].lat,
        lng: activeRoute.waypoints[activeRoute.waypoints.length - 1].lng,
        name: "Final Destination",
        shortName: "TERMINUS"
      } : null));

  const busesOnRoute = sessionBuses.filter(
    (bus) => bus.routeId === effectiveRouteId,
  );
  const activeBusOnRoute =
    busesOnRoute.find((bus) => bus.sessionId === trackedSessionId) ??
    busesOnRoute.find((bus) => bus.sessionId === selectedLiveSessionId) ??
    busesOnRoute[0];
  const activeBusOnRouteId = activeBusOnRoute?.busId;
  const activeSessionId = activeBusOnRoute?.sessionId;
  const endedMessage = completedRide !== null;

  const visibleView: ViewState =
    currentView === "tracking" && !activeBusOnRouteId && !endedMessage ? "home" : currentView;

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
    }, POST_RIDE_FEEDBACK_DELAY_MS);

    return () => clearTimeout(feedbackTimer);
  }, [completedRide]);

  const handleOpenMessaging = () => {
    setIsMessagingOpen(true);
    setUnreadCount(0);
  };

  const handleRouteSelect = (routeId: string) => {
    setSelectedRouteId(routeId);
    setSelectedBoardingStopId("");
    setSelectedLiveSessionId("");
    setIsMessagingOpen(false);
    setUnreadCount(0);
    setCurrentView("tracking");
  };

  return (
    <div className="relative overflow-hidden text-white" style={{ height: "100dvh" }}>
      {isResuming && (
        <div
          className="absolute left-4 right-4 z-50 flex items-center gap-2 rounded-xl border border-amber-400/20 bg-zinc-950 px-4 py-3 text-sm font-semibold text-amber-300 shadow-lg"
          style={{ top: "calc(env(safe-area-inset-top) + 1rem)" }}
          role="status"
          aria-live="polite"
        >
          <WifiOff className="size-4 shrink-0" aria-hidden="true" />
          <span className="text-pretty">Reconnecting to live bus data...</span>
        </div>
      )}
      {routesError && (
        <div
          className="absolute left-4 right-4 z-50 flex items-start gap-3 rounded-xl border border-red-400/20 bg-zinc-950 px-4 py-3 text-sm text-red-300 shadow-lg"
          style={{ top: isResuming ? "calc(env(safe-area-inset-top) + 5rem)" : "calc(env(safe-area-inset-top) + 1rem)" }}
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="font-semibold">Routes could not be loaded.</p>
            <p className="mt-0.5 text-xs text-red-300/70">{routesError}</p>
          </div>
          <button
            type="button"
            onClick={retryRoutes}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Retry
          </button>
        </div>
      )}
      <div className="absolute inset-0 flex flex-col overflow-hidden">

        {/* Map layer — only present on tracking */}
        <div className={`absolute inset-0 z-0 transition-opacity duration-500 ${visibleView === "tracking" ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          {visibleView === "tracking" && activeRoute && targetStop && (
            <PassengerTrackingMap
              targetStop={targetStop}
              route={activeRoute}
              resumeGeneration={resumeGeneration}
            />
          )}
        </div>



        {/* ── HOME VIEW ── */}
        <div className={`absolute inset-0 z-20 flex flex-col pt-safe transition-[opacity,transform] duration-500 ${visibleView === "home" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8 pointer-events-none"}`}>

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
                Select a route to view schedules.
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
                      <p className="text-[13px] font-black tracking-wider uppercase leading-tight text-[#fecdd3]">
                        {settings.announcementText}
                      </p>
                    </div>
                  )}
                  <RouteCarousel
                    routes={displayRoutes}
                    selectedRouteId={effectiveRouteId}
                    onClick={handleRouteSelect}
                    getActiveBusesCount={(routeId) => sessionBuses.filter(b => b.routeId === routeId).length}
                  />
                </>
              ) : (
                <div className="rounded-xl p-8 text-center mx-1 flex flex-col items-center justify-center gap-2"
                  style={{ background: "var(--surface-2)", border: "1px dashed var(--border-default)" }}>
                  {settings.announcementActive && settings.announcementText && (
                    <div className="inline-flex items-center px-4 py-1.5 rounded-full border mb-1"
                      style={{ background: "#4c0519", borderColor: "#881337" }}>
                      <span className="text-[12px] font-black tracking-wider uppercase text-[#fecdd3]">
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
        <div className={`absolute inset-0 z-20 pointer-events-none transition-opacity duration-500 ${visibleView === "tracking" ? "opacity-100" : "opacity-0"}`}>
          {!endedMessage && activeRoute && targetStop ? (
            <>
              {/* Top bar: back + route info */}
              <div className="absolute top-0 w-full z-40 pt-safe px-4 pb-6 pointer-events-auto"
                style={{ background: "linear-gradient(to bottom, rgba(9,9,11,0.92) 0%, transparent 100%)" }}>
                <div className="flex items-center gap-4 max-w-lg mx-auto pt-12">
                  <button
                    onClick={() => setCurrentView("home")}
                    className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-90 hover:opacity-90 shadow-sm cursor-pointer"
                    style={{ backgroundColor: "var(--surface-3)", border: "1px solid var(--border-subtle)" }}
                    aria-label="Back to home"
                    onPointerDown={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-4)")}
                    onPointerUp={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-3)")}
                    onPointerLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-3)")}
                  >
                    <ArrowLeft className="w-5 h-5" style={{ color: "var(--text-secondary)" }} />
                  </button>
                  {activeBusOnRoute ? (
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      {busesOnRoute.length > 1 &&
                        !busesOnRoute.some(
                          (bus) => bus.sessionId === trackedSessionId,
                        ) && (
                        <select
                          value={activeBusOnRoute.sessionId}
                          onChange={(event) => {
                            setSelectedLiveSessionId(event.target.value);
                            setSelectedBoardingStopId("");
                          }}
                          className="w-full rounded-lg px-3 py-2 text-xs font-semibold outline-none"
                          style={{
                            background: "var(--surface-2)",
                            border: "1px solid var(--border-subtle)",
                            color: "var(--text-primary)",
                          }}
                          aria-label="Live bus"
                        >
                          {busesOnRoute.map((bus) => (
                            <option key={bus.sessionId} value={bus.sessionId}>
                              Bus {bus.busId}
                            </option>
                          ))}
                        </select>
                      )}
                      <PassengerBoardingView 
                        key={activeBusOnRoute.sessionId}
                        sessionId={activeBusOnRoute.sessionId}
                        route={activeRoute}
                        tripState={activeBusOnRoute.tripState === "in_service" ? "in_service" : "pre_departure"}
                        onBoardingStopChange={setSelectedBoardingStopId}
                        onJoined={() => {
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
                        }}
                      />
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5">
                      <p className="text-[11px] font-semibold uppercase tracking-widest leading-none" style={{ color: "var(--accent)" }}>
                        Live
                      </p>
                      <p className="text-[17px] font-semibold truncate leading-tight" style={{ color: "var(--text-primary)" }}>
                        {activeRoute.name}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Messaging FAB */}
              {activeRouteIds.includes(activeRoute.id) && !isMessagingOpen && (
                <div className="absolute top-[160px] right-4 z-50 animate-scale-in pointer-events-auto">
                  <button
                    onClick={handleOpenMessaging}
                    className="w-12 h-12 rounded-xl flex items-center justify-center transition-all active:scale-95 relative"
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--border-default)",
                      boxShadow: "0 4px 16px rgba(0,0,0,0.3)"
                    }}
                    aria-label="Open live chat"
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

              {/* Passenger Boarding View was moved to the header above */}

              {/* Messaging Overlay */}
              {isMessagingOpen && (
                <div className="absolute inset-x-0 top-16 bottom-[80px] z-50 animate-slide-up flex flex-col pointer-events-auto">
                   <MessagingPanel
                     key={activeSessionId || "no-session"}
                     sessionId={activeSessionId || ""}
                    currentUserRole="passenger"
                    currentUserId={user?.uid || "anonymous"}
                    isOverlay={true}
                    onClose={() => setIsMessagingOpen(false)}
                    onUnreadCountChange={setUnreadCount}
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
        <div className={`absolute inset-0 z-30 flex flex-col transition-[opacity,transform] duration-500 ${visibleView === "profile" ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-8 pointer-events-none"}`}>
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
              if (visibleView === "tracking" || visibleView === "home") {
                setCurrentView(visibleView === "tracking" ? "home" : activeRoute ? "tracking" : "home");
              } else {
                setCurrentView("home");
              }
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
