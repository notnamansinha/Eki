"use client";

import { useState, useEffect, useRef, useMemo } from "react";
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
import { signInAnonymously } from "firebase/auth";
import { PASSENGER_BUS_START_TIME } from "@/config/passenger";
import RouteCard from "@/components/passenger/ui/RouteCard";
import { getDistanceMeters } from "@/lib/mapUtils";

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

  // Listen to Firebase Realtime Database for active buses.
  // signInAnonymously ensures auth != null, required by RTDB security rules.
  // Visibility is now driven purely by tripState (computed by the backend trip
  // state machine). The old frontend departure-detection hack is gone.
  useEffect(() => {
    signInAnonymously(auth).catch((err) =>
      console.warn("[RTDB Auth] Anonymous sign-in failed:", err.code)
    );

    const busesRef = ref(rtdb, "activeBuses");

    const unsubscribe = onValue(busesRef, (snapshot) => {
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

    return () => unsubscribe();
  }, []);

  const activeRouteIds = Array.from(new Set(activeBuses.map(b => b.routeId)));
  const activeRouteIdsStr = activeRouteIds.sort().join(',');

  useEffect(() => {
    const currentAvailable = routes.filter(r => activeRouteIds.includes(r.id));
    if (currentAvailable.length > 0) {
      if (!selectedRouteId || !currentAvailable.some(r => r.id === selectedRouteId)) {
        setSelectedRouteId(currentAvailable[0].id);
      }
    } else if (currentAvailable.length === 0 && selectedRouteId) {
      setSelectedRouteId("");
    }
  }, [activeRouteIdsStr, routes.length, selectedRouteId]);

  const availableRoutes = routes.filter(r => activeRouteIds.includes(r.id));
  const activeRoute = availableRoutes.find(r => r.id === selectedRouteId);

  useEffect(() => {
    if (activeRoute && activeRoute.stops && activeRoute.stops.length > 0) {
      if (!selectedStopId || !activeRoute.stops.some(s => s.id === selectedStopId)) {
        setSelectedStopId(activeRoute.stops[activeRoute.stops.length - 1].id);
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

  // Compute live ETA for NextBusCard
  const liveEtaMinutes = useMemo(() => {
    if (!activeBusOnRoute || !targetStop || !activeRoute?.stops) return undefined;
    const busSpeedKmh = activeBusOnRoute.speed > 0 ? activeBusOnRoute.speed : 15;
    const mPerMin = (busSpeedKmh * 1000) / 60;
    const dist = getDistanceMeters(
      { lat: activeBusOnRoute.lat, lng: activeBusOnRoute.lng },
      { lat: targetStop.lat, lng: targetStop.lng }
    ) * 1.3;
    return Math.ceil(dist / mPerMin) + (activeBusOnRoute.delayMinutes || 0);
  }, [activeBusOnRoute?.lat, activeBusOnRoute?.lng, activeBusOnRoute?.speed, activeBusOnRoute?.delayMinutes, targetStop?.lat, targetStop?.lng]);

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
            targetStop={targetStop}
            route={activeRoute || null}
          />
        </div>



        {/* ── HOME VIEW ── */}
        <div className={`absolute inset-0 z-20 flex flex-col pt-safe transition-all duration-500 ${currentView === "home" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8 pointer-events-none"}`}>
          
          {/* Top Left University Logo with Glassmorphism */}
          <div className="absolute top-0 left-0 pt-safe pl-5 mt-4 z-50 pointer-events-none">
            <div className="p-2 rounded-[14px]" style={{
              background: "rgba(18, 18, 20, 0.75)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)"
            }}>
              <img src="/ahduni_logo.webp" alt="University Logo" className="h-10 w-auto object-contain opacity-90 drop-shadow-md" />
            </div>
          </div>

          {/* Top spacer to frame the bus illustration near the top of the screen */}
          <div className="shrink-0" style={{ height: "34vh", minHeight: "250px" }} aria-hidden="true" />

          {/* Unified scrollable container */}
          <div className="flex-1 overflow-y-auto px-5 pb-24">
            
            {/* Unified Glass Panel */}
            <div className="rounded-3xl p-6 flex flex-col"
              style={{
                background: "rgba(18, 18, 20, 0.75)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.15)"
              }}
            >
              {/* Heading Section with Subtle Divider */}
              <div className="text-center pb-6 mb-6" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <h1 className="font-bold text-2xl tracking-tight mb-2" style={{ color: "var(--text-primary)" }}>
                  Where to?
                </h1>
                <p className="text-[13px] font-medium" style={{ color: "var(--text-tertiary)" }}>
                  Select a route to start tracking.
                </p>
              </div>

              {/* Status / Routes Section */}
              <div className="space-y-3">
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

      {/* Bottom Navigation — 2 tabs */}
      <nav className="absolute bottom-0 w-full z-[100] pb-safe" style={{ 
        height: "72px", 
        background: "rgba(9, 9, 11, 0.85)",
        backdropFilter: "blur(12px)",
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
              <div className="absolute top-0 w-6 h-0.5 rounded-full" style={{ background: "var(--accent)" }} />
            )}
            <MapIcon className="w-5 h-5 mb-1" style={{ 
              color: (currentView === "home" || currentView === "tracking") ? "var(--accent)" : "var(--text-ghost)" 
            }} />
            <span className="text-[10px] font-bold" style={{ 
              color: (currentView === "home" || currentView === "tracking") ? "var(--accent)" : "var(--text-ghost)" 
            }}>
              Map
            </span>
          </button>

          <button
            onClick={() => setCurrentView("profile")}
            className="flex flex-col items-center justify-center py-2 flex-1 rounded-xl transition-all duration-300 relative"
          >
            {currentView === "profile" && (
              <div className="absolute top-0 w-6 h-0.5 rounded-full" style={{ background: "var(--text-primary)" }} />
            )}
            <User className="w-5 h-5 mb-1" style={{ 
              color: currentView === "profile" ? "var(--text-primary)" : "var(--text-ghost)" 
            }} />
            <span className="text-[10px] font-bold" style={{ 
              color: currentView === "profile" ? "var(--text-primary)" : "var(--text-ghost)" 
            }}>
              Profile
            </span>
          </button>
        </div>
      </nav>
    </div>
  );
}
