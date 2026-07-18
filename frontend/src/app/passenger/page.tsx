"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import PassengerMap from "@/components/maps/PassengerMap";
import AccountTab from "@/components/passenger/AccountTab";
import MessagingPanel from "@/components/shared/MessagingPanel";
import FeedbackModal from "@/components/shared/FeedbackModal";
import { useAuth } from "@/hooks/useAuth";
import { useRoutes } from "@/hooks/useRoutes";
import { MapPinned as MapIcon, CircleUserRound as User, Loader2, MessageCircle, ArrowLeft, Flag } from "lucide-react";
import { rtdb, auth } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import { waitForAuth } from "@/lib/authState";
import { PASSENGER_BUS_START_TIME } from "@/config/passenger";
import RouteCarousel from "@/components/passenger/ui/RouteCarousel";
import PassengerBoardingView from "@/components/passenger/PassengerBoardingView";
import { useSettings } from "@/hooks/useSettings";
import { getDistanceMeters } from "@/lib/mapUtils";

type ViewState = "home" | "tracking" | "profile";

interface ActiveBusData {
  busId: string;
  routeId: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  status?: string; // "active" | "offline"
  deviceState: string;
  tripState: string;
  motionState: string;
  timestamp: number;
  driverId?: string;
  currentStopIndex?: number;
  delayMinutes?: number;
  sessionId?: string;
}

export default function PassengerPage() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const [currentView, setCurrentView] = useState<ViewState>("home");
  const { routes } = useRoutes();
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [selectedStopId, setSelectedStopId] = useState("");
  const [activeBuses, setActiveBuses] = useState<ActiveBusData[]>([]);
  const [isMessagingOpen, setIsMessagingOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackBusId, setFeedbackBusId] = useState("");
  const [feedbackDriverId, setFeedbackDriverId] = useState("");
  const trackingBusIdRef = useRef<string | null>(null);
  const trackingDriverIdRef = useRef<string | null>(null);
  const latestBusDriversRef = useRef<Map<string, string>>(new Map());
  const [endedMessage, setEndedMessage] = useState(false);
  const [isBoarded, setIsBoarded] = useState(false);

  // Listen to Firebase Realtime Database for active buses.
  // signInAnonymously ensures auth != null, required by RTDB security rules.
  // Visibility is now driven purely by tripState (computed by the backend trip
  // state machine). The old frontend departure-detection hack is gone.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let isMounted = true;

    waitForAuth().then(() => {
      if (!isMounted) return;
      const busesRef = ref(rtdb, "activeBuses");

      unsubscribe = onValue(busesRef, (snapshot) => {
        const data = snapshot.val();
        console.log("[Passenger] RTDB activeBuses raw:", data ? Object.keys(data) : "null");
        const newBuses: ActiveBusData[] = [];
        const driverMap = new Map<string, string>();

        if (data) {
          Object.entries(data as Record<string, ActiveBusData>).forEach(([key, bus]) => {
            bus.busId = bus.busId || key.split("_")[0];
            // Safety net: discard entries older than 5 minutes (RTDB cleanup lag).
            const isFresh = Date.now() - bus.timestamp < 300_000;
            if (!bus.routeId || !bus.busId || !isFresh) {
              console.log("[Passenger] Skipped (stale/missing):", key, { routeId: bus.routeId, busId: bus.busId, isFresh });
              return;
            }

            // Show bus if it's actively tracking — allow pre_departure so the
            // backend tripState geofence doesn't hide a freshly started driver.
            const isActive = bus.tripState === "in_service" || bus.tripState === "pre_departure";
            // Only skip if explicitly marked offline by driver stop action
            const isOffline = bus.status === "offline" || bus.deviceState === "offline";
            console.log("[Passenger] Bus check:", key, { tripState: bus.tripState, status: bus.status, deviceState: bus.deviceState, isActive, isOffline });
            if (!isActive || isOffline) return;

            newBuses.push(bus);
            if (bus.driverId) driverMap.set(bus.busId, bus.driverId);
          });
        }

        console.log("[Passenger] setActiveBuses count:", newBuses.length);
        latestBusDriversRef.current = driverMap;
        setActiveBuses(newBuses);
      }, (error) => {
        console.warn("[RTDB] activeBuses read failed:", error.message);
      });
    });

    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const activeRouteIds = Array.from(new Set(activeBuses.map(b => b.routeId)));
  const availableRoutes = routes.filter(r => activeRouteIds.includes(r.id));
  const displayRoutes = availableRoutes;
  const displayRoutesIdsStr = displayRoutes.map(r => r.id).join(',');

  useEffect(() => {
    if (displayRoutes.length > 0 && (!selectedRouteId || !displayRoutes.some(r => r.id === selectedRouteId))) {
      setSelectedRouteId(displayRoutes[0].id);
    }
  }, [displayRoutesIdsStr]);

  const activeRoute = displayRoutes.find(r => r.id === selectedRouteId) || displayRoutes[0];

  useEffect(() => {
    if (activeRoute && activeRoute.stops && activeRoute.stops.length > 0) {
      if (!selectedStopId || !activeRoute.stops.some(s => s.id === selectedStopId)) {
        setSelectedStopId(activeRoute.stops[0].id);
      }
    }
  }, [activeRoute, selectedStopId]);

  const targetStop = activeRoute?.stops?.find(s => s.id === selectedStopId) ||
    (activeRoute?.stops && activeRoute.stops.length > 0
      ? activeRoute.stops[activeRoute.stops.length - 1]
      : (activeRoute?.waypoints && activeRoute.waypoints.length > 0 ? {
        id: "terminus",
        lat: activeRoute.waypoints[activeRoute.waypoints.length - 1].lat,
        lng: activeRoute.waypoints[activeRoute.waypoints.length - 1].lng,
        name: "Final Destination",
        shortName: "TERMINUS"
      } : {
        id: "live-endpoint",
        lat: 23.0347,
        lng: 72.5483,
        name: "Tracking Area",
        shortName: "LIVE"
      }));

  const activeBusOnRoute = activeBuses.find(b => b.routeId === selectedRouteId);
  const activeBusOnRouteId = activeBusOnRoute?.busId;
  const activeSessionId = activeBusOnRoute?.sessionId;

  useEffect(() => {
    setIsBoarded(false);
  }, [activeSessionId]);

  // Compute live ETA for NextBusCard
  const liveEtaMinutes = useMemo(() => {
    if (!activeBusOnRoute || !targetStop || !activeRoute?.stops) return undefined;
    const busSpeedKmh = activeBusOnRoute.speed > 0 ? activeBusOnRoute.speed : 35;
    const mPerMin = (busSpeedKmh * 1000) / 60;
    const dist = getDistanceMeters(
      { lat: activeBusOnRoute.lat, lng: activeBusOnRoute.lng },
      { lat: targetStop.lat, lng: targetStop.lng }
    ) * 1.3;
    return Math.ceil(dist / mPerMin) + (activeBusOnRoute.delayMinutes || 0);
  }, [activeBusOnRoute?.lat, activeBusOnRoute?.lng, activeBusOnRoute?.speed, activeBusOnRoute?.delayMinutes, targetStop?.lat, targetStop?.lng]);

  const busMotionState = (activeBusOnRoute?.motionState || "uncertain") as "moving" | "stopped" | "uncertain";

  // Automatically return to home if tracking view is open but there are no buses and the ended message is gone
  useEffect(() => {
    if (currentView === "tracking" && !activeBusOnRouteId && !endedMessage) {
      setCurrentView("home");
    }
  }, [currentView, activeBusOnRouteId, endedMessage]);

  useEffect(() => {
    let timerId: NodeJS.Timeout;

    if (activeBusOnRouteId) {
      trackingBusIdRef.current = activeBusOnRouteId;
      trackingDriverIdRef.current = latestBusDriversRef.current.get(activeBusOnRouteId) || null;
    } else if (trackingBusIdRef.current) {
      const finishedBusId = trackingBusIdRef.current;
      const finishedDriverId = trackingDriverIdRef.current;
      setEndedMessage(true);
      timerId = setTimeout(() => {
        setFeedbackBusId(finishedBusId);
        setFeedbackDriverId(finishedDriverId || "");
        setShowFeedbackModal(true);
        trackingBusIdRef.current = null;
        trackingDriverIdRef.current = null;
        setEndedMessage(false);
      }, 10000);
    }

    return () => {
      if (timerId) clearTimeout(timerId);
    };
  }, [activeBusOnRouteId]);

  const handleOpenMessaging = () => {
    setIsMessagingOpen(true);
    setUnreadCount(0);
  };

  const handleRouteSelect = (routeId: string) => {
    setSelectedRouteId(routeId);
    setCurrentView("tracking");
  };

  return (
    <div className="relative text-white overflow-hidden" style={{ height: "100dvh", backgroundColor: "var(--surface-0)" }}>
      {/* Background Image Layer: Full screen map flowing naturally */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage: "url('/userpanel.webp')",
          backgroundSize: "cover",
          backgroundPosition: "center -24px", // Masks exactly 24px of the top to bring the bus closer to the top without clipping it
          backgroundRepeat: "no-repeat",
        }}
      />

      <div className="absolute inset-0 flex flex-col overflow-hidden">

        {/* Map layer — only present on tracking */}
        <div className={`absolute inset-0 z-0 transition-opacity duration-500 ${currentView === "tracking" ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          <PassengerMap
            targetStop={targetStop!}
            route={activeRoute}
          />
        </div>



        {/* ── HOME VIEW ── */}
        <div className={`absolute inset-0 z-20 flex flex-col pt-safe transition-all duration-500 ${currentView === "home" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8 pointer-events-none"}`}>

          {/* Top spacer to frame the bus illustration near the top of the screen */}
          <div className="shrink-0" style={{ height: "34vh", minHeight: "250px" }} aria-hidden="true" />

          {/* Unified Transit Panel that fills the rest of the height, with a gap above bottom nav */}
          <div className="flex-1 flex flex-col mx-4 mb-[110px] rounded-[32px] overflow-hidden relative shadow-2xl pt-8"
            style={{
              background: "linear-gradient(180deg, #1c1c1e 0%, #151517 100%)",
              borderTop: "1px solid rgba(255, 255, 255, 0.12)",
              borderLeft: "1px solid rgba(255, 255, 255, 0.04)",
              borderRight: "1px solid rgba(255, 255, 255, 0.04)",
              boxShadow: "0 12px 48px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.05)"
            }}
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
              {settings.announcementActive && settings.announcementText && (
                <div className="mx-1 mb-3 rounded-xl px-4 py-2.5 flex items-center gap-2" style={{ background: "var(--accent-subtle)", border: "1px solid var(--accent-glow)" }}>
                  <span className="text-[11px] font-semibold" style={{ color: "var(--accent)" }}>{settings.announcementText}</span>
                </div>
              )}
              {displayRoutes.length > 0 ? (
                <RouteCarousel
                  routes={displayRoutes}
                  selectedRouteId={selectedRouteId}
                  onClick={handleRouteSelect}
                  getActiveBusesCount={(routeId) => activeBuses.filter(b => b.routeId === routeId).length}
                />
              ) : (
                <div className="rounded-xl p-8 text-center mx-1"
                  style={{ background: "var(--surface-2)", border: "1px dashed var(--border-default)" }}>
                  <p className="text-[13px] font-medium mb-1" style={{ color: "var(--text-tertiary)" }}>
                    {settings.noBusesMessage || "No buses running"}
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--text-ghost)" }}>
                    {(settings.noBusesSubMessage || "Service starts at {time}").replace("{time}", settings.serviceStartTime || PASSENGER_BUS_START_TIME)}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── TRACKING VIEW ── */}
        <div className={`absolute inset-0 z-20 pointer-events-none transition-all duration-500 ${currentView === "tracking" ? "opacity-100" : "opacity-0"}`}>
          {activeRoute && targetStop ? (
            <>
              {/* Top bar: back + route info */}
              <div className="absolute top-0 w-full z-40 pt-safe px-4 pb-6 pointer-events-auto"
                style={{ background: "linear-gradient(to bottom, rgba(9,9,11,0.92) 0%, transparent 100%)" }}>
                <div className="flex items-center gap-4 max-w-lg mx-auto pt-6">
                  <button
                    onClick={() => setCurrentView("home")}
                    className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-90 hover:opacity-90 shadow-sm cursor-pointer"
                    style={{ backgroundColor: "var(--surface-3)", border: "1px solid var(--border-subtle)" }}
                    aria-label="Back to home"
                    onPointerDown={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-4)")}
                    onPointerUp={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-3)")}
                    onPointerLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-3)")}
                  >
                    <ArrowLeft className="w-5 h-5" style={{ color: "var(--text-secondary)" }} />
                  </button>
                  {activeSessionId && !isBoarded ? (
                    <div className="flex-1 min-w-0 pr-4">
                      <PassengerBoardingView 
                        sessionId={activeSessionId}
                        route={activeRoute}
                        userId={user?.uid || "anonymous"}
                        userName={user?.displayName || "Rider"}
                        onBoarded={() => setIsBoarded(true)}
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
                <div className="absolute top-20 right-4 z-50 animate-scale-in pointer-events-auto">
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
                    sessionId={activeBuses.find(b => b.routeId === activeRoute.id)?.sessionId || ""}
                    currentUserRole="passenger"
                    currentUserId={user?.uid || "anonymous"}
                    currentUserName={user?.displayName || "Rider"}
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
                  setEndedMessage(false);
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
        <div className={`absolute inset-0 z-30 flex flex-col transition-all duration-500 ${currentView === "profile" ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-8 pointer-events-none"}`}>
          <AccountTab />
        </div>
      </div>

      {showFeedbackModal && (
        <FeedbackModal
          userId={user?.uid || "anonymous"}
          userName={user?.displayName || "Rider"}
          busId={feedbackBusId}
          driverId={feedbackDriverId}
          onClose={() => setShowFeedbackModal(false)}
        />
      )}

      {/* Bottom Navigation — Fixed Transit Tab Bar */}
      <div className="absolute bottom-0 inset-x-0 z-[100] pb-safe pointer-events-none flex justify-center">
        <nav className="w-full pointer-events-auto flex items-center justify-around px-2 py-2.5 rounded-t-[24px]"
          style={{
            background: "rgba(22, 22, 26, 0.95)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderTop: "1px solid rgba(255, 255, 255, 0.15)",
          }}>
          <button
            onClick={() => {
              if (currentView === "tracking" || currentView === "home") {
                setCurrentView(currentView === "tracking" ? "home" : activeRoute ? "tracking" : "home");
              } else {
                setCurrentView("home");
              }
            }}
            className="flex flex-col items-center justify-center h-[60px] w-[140px] rounded-[20px] transition-all duration-300 relative group active:scale-95 gap-1.5"
            style={{
              background: (currentView === "home" || currentView === "tracking") ? "rgba(255,255,255,0.08)" : "transparent"
            }}
          >
            <MapIcon className="w-[22px] h-[22px] transition-colors" strokeWidth={2.5} style={{
              color: (currentView === "home" || currentView === "tracking") ? "var(--text-primary)" : "var(--text-tertiary)"
            }} />
            <span className="text-[13px] font-bold transition-colors leading-none" style={{
              color: (currentView === "home" || currentView === "tracking") ? "var(--text-primary)" : "var(--text-tertiary)"
            }}>
              Routes
            </span>
          </button>

          <button
            onClick={() => setCurrentView("profile")}
            className="flex flex-col items-center justify-center h-[60px] w-[140px] rounded-[20px] transition-all duration-300 relative group active:scale-95 gap-1.5"
            style={{
              background: currentView === "profile" ? "rgba(255,255,255,0.08)" : "transparent"
            }}
          >
            <User className="w-[22px] h-[22px] transition-colors" strokeWidth={2.5} style={{
              color: currentView === "profile" ? "var(--text-primary)" : "var(--text-tertiary)"
            }} />
            <span className="text-[13px] font-bold transition-colors leading-none" style={{
              color: currentView === "profile" ? "var(--text-primary)" : "var(--text-tertiary)"
            }}>
              Profile
            </span>
          </button>
        </nav>
      </div>
    </div>
  );
}
