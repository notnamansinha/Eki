"use client";

import { useState, useEffect, useRef } from "react";
import PassengerMap from "@/components/maps/PassengerMap";
import AccountTab from "@/components/passenger/AccountTab";
import MessagingPanel from "@/components/shared/MessagingPanel";
import FeedbackModal from "@/components/shared/FeedbackModal";
import { useAuth } from "@/hooks/useAuth";
import { useRoutes } from "@/hooks/useRoutes";
import { Map as MapIcon, User, Loader2, Radio } from "lucide-react";
import { rtdb } from "@/lib/firebase";
import { ref, onValue, off } from "firebase/database";
import { buzzController } from "@/lib/audioUtils";

type Tab = "map" | "account";

interface ActiveBusData {
  busId: string;
  routeId: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  status: string;
  timestamp: number;
}

export default function PassengerPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("map");
  const { routes } = useRoutes();
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [selectedStopId, setSelectedStopId] = useState("");
  const [activeBuses, setActiveBuses] = useState<{busId: string, routeId: string}[]>([]);
  const [isMessagingOpen, setIsMessagingOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackBusId, setFeedbackBusId] = useState("");
  const [feedbackDriverId, setFeedbackDriverId] = useState("");
  const trackingBusIdRef = useRef<string | null>(null);
  const trackingDriverIdRef = useRef<string | null>(null);
  const latestBusDriversRef = useRef<Map<string, string>>(new Map());

  // Listen to Firebase Realtime Database for active buses
  useEffect(() => {
    const busesRef = ref(rtdb, "activeBuses");

    const handleSnapshot = onValue(busesRef, (snapshot) => {
      const data = snapshot.val();
      const newBuses: {busId: string, routeId: string}[] = [];
      const driverMap = new Map<string, string>();
      if (data) {
        Object.values(data as Record<string, ActiveBusData & { driverId?: string }>).forEach((bus) => {
          const isFresh = Date.now() - bus.timestamp < 300000; 
          if (bus.routeId && bus.busId && bus.status === "active" && isFresh) {
            newBuses.push({ busId: bus.busId, routeId: bus.routeId });
            if (bus.driverId) {
              driverMap.set(bus.busId, bus.driverId);
            }
          }
        });
      }
      latestBusDriversRef.current = driverMap;
      setActiveBuses(newBuses);
    });

    return () => off(busesRef, "value", handleSnapshot);
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

  const activeBusOnRoute = activeBuses.find(b => b.routeId === selectedRouteId)?.busId;

  useEffect(() => {
    let timerId: NodeJS.Timeout;

    if (activeBusOnRoute) {
      trackingBusIdRef.current = activeBusOnRoute;
      trackingDriverIdRef.current = latestBusDriversRef.current.get(activeBusOnRoute) || null;
    } else if (trackingBusIdRef.current) {
      const finishedBusId = trackingBusIdRef.current;
      const finishedDriverId = trackingDriverIdRef.current;
      timerId = setTimeout(() => {
         setFeedbackBusId(finishedBusId);
         setFeedbackDriverId(finishedDriverId || "");
         setShowFeedbackModal(true);
         trackingBusIdRef.current = null;
         trackingDriverIdRef.current = null;
      }, 10000);
    }

    return () => {
      if (timerId) clearTimeout(timerId);
    };
  }, [activeBusOnRoute]);

  const handleOpenMessaging = () => {
    setIsMessagingOpen(true);
    setUnreadCount(0);
  };

  return (
    <div className="flex flex-col bg-brand-dark text-white overflow-hidden" style={{ height: "100dvh" }}>
      <div className="relative flex-1 flex flex-col overflow-hidden min-h-0">
        <div className={`absolute inset-0 z-0 ${activeTab === "map" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
          {activeRoute && targetStop ? (
            <>
              {/* Route Selector */}
              <div className="absolute top-0 w-full z-40 bg-gradient-to-b from-brand-dark/95 to-transparent pt-safe px-4 pb-10 flex flex-col gap-2.5">
                <div className="relative w-full max-w-lg mx-auto">
                  <select
                    value={selectedRouteId}
                    onChange={(e) => {
                      setSelectedRouteId(e.target.value);
                      buzzController.unlock();
                    }}
                    className="w-full h-13 backdrop-blur-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-2xl px-5 text-white text-[13px] focus:outline-none focus:ring-2 focus:ring-white/20 shadow-2xl appearance-none font-bold tracking-tight transition-all cursor-pointer"
                    style={{ height: "52px" }}
                  >
                    {availableRoutes.map((r) => (
                      <option key={r.id} value={r.id} className="bg-[#1a1c29] text-white">Route: {r.name}</option>
                    ))}
                  </select>
                  <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-white/30">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </div>
                </div>

                {activeRoute?.stops && activeRoute.stops.length > 0 && (
                  <div className="relative w-full max-w-lg mx-auto">
                    <select
                      value={selectedStopId}
                      onChange={(e) => {
                        setSelectedStopId(e.target.value);
                        buzzController.unlock();
                      }}
                      className="w-full h-11 bg-black/90 hover:bg-black border border-white/15 rounded-2xl px-5 text-white text-[12px] focus:outline-none focus:ring-2 focus:ring-white/40 shadow-2xl appearance-none font-bold tracking-tight transition-all cursor-pointer"
                    >
                      {activeRoute.stops.map((s) => (
                        <option key={s.id} value={s.id} className="bg-black text-white">Alight at: {s.name}</option>
                      ))}
                    </select>
                    <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-white/30">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </div>
                  </div>
                )}
              </div>

              {/* Messaging FAB — TOP RIGHT */}
              {activeRouteIds.includes(activeRoute.id) && !isMessagingOpen && (
                <div className="absolute top-4 right-4 z-50">
                  <button 
                    onClick={handleOpenMessaging}
                    className="w-12 h-12 rounded-full bg-brand-surface/90 backdrop-blur-xl border border-white/10 text-white flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-all relative"
                    aria-label="Open live comms"
                  >
                    <Radio className="w-5 h-5 text-emerald-400" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-red-500 rounded-full flex items-center justify-center text-[10px] font-black text-white px-1 shadow-lg border border-brand-dark">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </button>
                </div>
              )}

              {/* Messaging Overlay — bottom raised above RouteTimelineSheet on mobile */}
              {isMessagingOpen && (
                <div className="absolute inset-x-0 top-24 bottom-[128px] sm:bottom-0 z-50 animate-slide-up flex flex-col">
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

              <PassengerMap
                targetStop={targetStop}
                route={activeRoute}
              />
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-brand-dark px-10 text-center">
              <Loader2 className="w-10 h-10 text-white/20 animate-spin mb-6" />
              <p className="text-white/40 text-sm font-bold uppercase tracking-[0.2em]">Waiting for a driver to go live…</p>
              <p className="text-white/20 text-xs mt-2">Updates automatically when a driver goes online</p>
            </div>
          )}
        </div>

        {/* Account View */}
        <div className={`absolute inset-0 z-10 flex flex-col bg-brand-dark transition-opacity duration-300 ${activeTab === "account" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
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

      {/* Bottom Navigation */}
      <nav className="relative z-50 shrink-0 bg-brand-surface/80 border-t border-white/5 backdrop-blur-2xl pb-safe" style={{ height: "64px" }}>
        <div className="flex items-center justify-around px-4 h-full max-w-md mx-auto">
          <button
            onClick={() => setActiveTab("map")}
            className={`flex flex-col items-center justify-center py-2 flex-1 rounded-2xl transition-all duration-300 ${
              activeTab === "map" ? "text-white bg-white/5 transform scale-105" : "text-white/30 hover:text-white/60"
            }`}
          >
            <MapIcon className={`w-5 h-5 mb-1 ${activeTab === "map" ? "text-white" : "opacity-40"}`} />
            <span className="text-[9px] font-black tracking-[0.15em] uppercase">Live Map</span>
          </button>

          <button
            onClick={() => setActiveTab("account")}
            className={`flex flex-col items-center justify-center py-2 flex-1 rounded-2xl transition-all duration-300 ${
              activeTab === "account" ? "text-white bg-white/5 transform scale-105" : "text-white/30 hover:text-white/60"
            }`}
          >
            <User className={`w-5 h-5 mb-1 ${activeTab === "account" ? "text-white" : "opacity-40"}`} />
            <span className="text-[9px] font-black tracking-[0.15em] uppercase">Account</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
