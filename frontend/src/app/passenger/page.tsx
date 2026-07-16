"use client";

import { useState, useEffect, useRef } from "react";
import PassengerMap from "@/components/maps/PassengerMap";
import AccountTab from "@/components/passenger/AccountTab";
import MessagingPanel from "@/components/shared/MessagingPanel";
import FeedbackModal from "@/components/shared/FeedbackModal";
import NextBusCard from "@/components/passenger/NextBusCard";
import { useAuth } from "@/hooks/useAuth";
import { useRoutes } from "@/hooks/useRoutes";
import { MapPinned as MapIcon, CircleUserRound as User, Loader2, SignalHigh as Radio, ArrowLeft } from "lucide-react";
import { rtdb, auth } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import { signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { PASSENGER_BUS_START_TIME } from "@/config/passenger";
import RouteCard from "@/components/passenger/ui/RouteCard";
import { calculateStopEtas } from "@/lib/routeEta";

type ViewState = "home" | "tracking" | "profile";

interface ActiveBusData {
  busId: string;
  routeId: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  deviceState: string;
  tripState: string;
  motionState: string;
  timestamp: number;
  driverId?: string;
  currentStopIndex?: number;
  delayMinutes?: number;
}

export default function PassengerPage() {
  const { user } = useAuth();
  const [currentView, setCurrentView] = useState<ViewState>("home");
  const { routes } = useRoutes();
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [selectedStopId] = useState("");
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

  // Listen to Firebase Realtime Database for active buses after auth resolves.
  useEffect(() => {
    let cancelled = false;
    let unsubscribeBuses: (() => void) | undefined;

    const startBusListener = () => {
      if (cancelled || unsubscribeBuses) return;

      const busesRef = ref(rtdb, "activeBuses");

      unsubscribeBuses = onValue(busesRef, (snapshot) => {
        const data = snapshot.val();
        const newBuses: ActiveBusData[] = [];
        const driverMap = new Map<string, string>();

        if (data) {
          Object.values(data as Record<string, ActiveBusData>).forEach((bus) => {
            // Safety net: discard entries older than 5 minutes (RTDB cleanup lag).
            const isFresh = Date.now() - bus.timestamp < 300_000;
            if (!bus.routeId || !bus.busId || !isFresh) return;

            if (bus.deviceState !== "online" || bus.tripState !== "in_service") return;

            newBuses.push(bus);
            if (bus.driverId) driverMap.set(bus.busId, bus.driverId);
          });
        }

        latestBusDriversRef.current = driverMap;
        setActiveBuses(newBuses);
      });
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        startBusListener();
        return;
      }

      if (auth.currentUser) {
        startBusListener();
        return;
      }

      signInAnonymously(auth)
        .then(() => startBusListener())
        .catch((err) =>
          console.warn("[RTDB Auth] Anonymous sign-in failed:", err.code)
        );
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
      unsubscribeBuses?.();
    };
  }, []);

  const activeRouteIds = Array.from(new Set(activeBuses.map(b => b.routeId)));
  const availableRoutes = routes.filter(r => activeRouteIds.includes(r.id));
  const effectiveRouteId = availableRoutes.some((route) => route.id === selectedRouteId)
    ? selectedRouteId
    : availableRoutes[0]?.id || "";
  const activeRoute = availableRoutes.find(r => r.id === effectiveRouteId);
  const effectiveStopId = activeRoute?.stops?.some((stop) => stop.id === selectedStopId)
    ? selectedStopId
    : activeRoute?.stops?.[activeRoute.stops.length - 1]?.id || "";

  const targetStop = activeRoute?.stops?.find(s => s.id === effectiveStopId) ||
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

  const activeBusOnRoute = activeBuses.find(b => b.routeId === effectiveRouteId);
  const activeBusOnRouteId = activeBusOnRoute?.busId;

  // Compute live ETA for NextBusCard
  const liveEtaMinutes = activeBusOnRoute && targetStop && activeRoute?.stops
    ? calculateStopEtas(activeRoute.stops, activeBusOnRoute).stopEtas[targetStop.id]
    : undefined;

  const busMotionState = (activeBusOnRoute?.motionState || "uncertain") as "moving" | "stopped" | "uncertain";

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
    <div className="flex flex-col text-white overflow-hidden" style={{ height: "100dvh", background: "var(--surface-0)" }}>
      <div className="relative flex-1 flex flex-col overflow-hidden min-h-0">
        
        {/* Map layer — always present */}
        <div className={`absolute inset-0 z-0 transition-opacity duration-500 ${currentView !== "profile" ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          <PassengerMap
            targetStop={targetStop}
            route={activeRoute || null}
          />
          {/* Dim overlay on home view so cards are readable */}
          {currentView === "home" && (
            <div className="absolute inset-0 z-10 animate-fade-in" 
              style={{ background: "rgba(9, 9, 11, 0.65)", backdropFilter: "blur(2px)" }} />
          )}
        </div>

        {/* ── HOME VIEW ── */}
        <div className={`absolute inset-0 z-20 flex flex-col pt-safe transition-all duration-500 ${currentView === "home" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8 pointer-events-none"}`}>
          <div className="px-5 pt-10 pb-4">
            <h1 className="font-extrabold text-3xl tracking-tight mb-1" style={{ color: "var(--text-primary)" }}>
              Where to?
            </h1>
            <p className="text-[13px] font-medium" style={{ color: "var(--text-tertiary)" }}>
              Select a route to start tracking.
            </p>
          </div>
          
          <div className="flex-1 overflow-y-auto px-5 pb-24 space-y-3">
            {availableRoutes.length > 0 ? (
              availableRoutes.map(r => (
                <RouteCard 
                  key={r.id}
                  route={r}
                  isSelected={false}
                  onSelect={handleRouteSelect}
                  activeBusesCount={activeBuses.filter(b => b.routeId === r.id).length}
                />
              ))
            ) : (
              <div className="rounded-xl p-8 text-center" 
                style={{ background: "var(--surface-2)", border: "1px dashed var(--border-default)" }}>
                <p className="text-[13px] font-bold mb-1" style={{ color: "var(--text-tertiary)" }}>
                  No buses running
                </p>
                <p className="text-[12px]" style={{ color: "var(--text-ghost)" }}>
                  Service starts at {PASSENGER_BUS_START_TIME}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── TRACKING VIEW ── */}
        <div className={`absolute inset-0 z-20 pointer-events-none transition-all duration-500 ${currentView === "tracking" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
          {activeRoute && targetStop ? (
            <>
              {/* Top bar: back + route info */}
              <div className="absolute top-0 w-full z-40 pt-safe px-4 pb-6"
                style={{ background: "linear-gradient(to bottom, rgba(9,9,11,0.92) 0%, transparent 100%)" }}>
                <div className="flex items-center gap-3 max-w-lg mx-auto pt-2">
                  <button 
                    onClick={() => setCurrentView("home")}
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors"
                    style={{ background: "var(--surface-3)", border: "1px solid var(--border-subtle)" }}
                    aria-label="Back to home"
                  >
                    <ArrowLeft className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold" style={{ color: "var(--accent)", letterSpacing: "0.05em" }}>
                      Live
                    </p>
                    <p className="font-bold truncate text-[15px]" style={{ color: "var(--text-primary)" }}>
                      {activeRoute.name}
                    </p>
                  </div>
                </div>
              </div>

              {/* Messaging FAB */}
              {activeRouteIds.includes(activeRoute.id) && !isMessagingOpen && (
                <div className="absolute top-20 right-4 z-50 animate-scale-in">
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
                    <Radio className="w-5 h-5" style={{ color: "var(--status-live)" }} />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold text-white px-1"
                        style={{ background: "var(--status-danger)", boxShadow: "0 0 0 2px var(--surface-0)" }}>
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </button>
                </div>
              )}

              {/* NextBusCard — persistent bottom card */}
              {activeBusOnRouteId && (
                <div className="absolute bottom-[80px] inset-x-0 z-40 px-4 pb-2 pointer-events-auto">
                  <NextBusCard
                    routeName={activeRoute.name}
                    targetStopName={targetStop.name}
                    etaMinutes={liveEtaMinutes}
                    motionState={busMotionState}
                    routeColor={activeRoute.color}
                  />
                </div>
              )}

              {/* Messaging Overlay */}
              {isMessagingOpen && (
                <div className="absolute inset-x-0 top-16 bottom-[80px] z-50 animate-slide-up flex flex-col">
                  <MessagingPanel
                    busId={activeBuses.find(b => b.routeId === activeRoute.id)?.busId || ""}
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
                <MapIcon className="w-8 h-8" style={{ color: "var(--status-danger)" }} />
              </div>
              <p className="text-xl font-bold tracking-tight mb-2" style={{ color: "var(--text-primary)" }}>
                Route ended
              </p>
              <p className="text-[13px] mb-6 max-w-xs" style={{ color: "var(--text-tertiary)" }}>
                The bus has reached the terminus.
              </p>
              <div className="flex items-center gap-2 px-5 py-2.5 rounded-xl"
                style={{ background: "var(--status-live-bg)" }}>
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--status-live)" }} />
                <p className="text-[11px] font-bold" style={{ color: "var(--status-live)" }}>
                  Waiting for next bus
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {/* ── PROFILE VIEW ── */}
        <div className={`absolute inset-0 z-30 flex flex-col transition-all duration-500 ${currentView === "profile" ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-8 pointer-events-none"}`}
          style={{ background: "var(--surface-0)" }}>
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

      {/* Bottom Navigation — 2 tabs */}
      <nav className="relative z-[100] shrink-0 pb-safe" style={{ 
        height: "72px", 
        background: "var(--surface-1)", 
        borderTop: "1px solid var(--border-subtle)" 
      }}>
        <div className="flex items-center justify-around px-6 h-full max-w-md mx-auto">
          
          <button
            onClick={() => {
              if (currentView === "tracking" || currentView === "home") {
                setCurrentView(currentView === "tracking" ? "home" : activeRoute ? "tracking" : "home");
              } else {
                setCurrentView("home");
              }
            }}
            className="flex flex-col items-center justify-center py-2 flex-1 rounded-xl transition-all duration-300 relative"
          >
            {(currentView === "home" || currentView === "tracking") && (
              <div className="absolute top-0 w-6 h-0.5 rounded-full" style={{ background: "#84cc16" }} />
            )}
            <MapIcon className="w-5 h-5 mb-1" style={{ 
              color: (currentView === "home" || currentView === "tracking") ? "#84cc16" : "#ffffff" 
            }} />
            <span className="text-[10px] font-bold" style={{ 
              color: (currentView === "home" || currentView === "tracking") ? "#84cc16" : "#ffffff" 
            }}>
              Map
            </span>
          </button>

          <button
            onClick={() => setCurrentView("profile")}
            className="flex flex-col items-center justify-center py-2 flex-1 rounded-xl transition-all duration-300 relative"
          >
            {currentView === "profile" && (
              <div className="absolute top-0 w-6 h-0.5 rounded-full" style={{ background: "#84cc16" }} />
            )}
            <User className="w-5 h-5 mb-1" style={{ 
              color: currentView === "profile" ? "#84cc16" : "#ffffff" 
            }} />
            <span className="text-[10px] font-bold" style={{ 
              color: currentView === "profile" ? "#84cc16" : "#ffffff" 
            }}>
              Profile
            </span>
          </button>
        </div>
      </nav>
    </div>
  );
}
