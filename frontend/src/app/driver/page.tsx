"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import TransmitterControls from "@/components/driver/TransmitterControls";
import DriverMap from "@/components/maps/DriverMap";
import DriverProfileTab from "@/components/driver/DriverProfileTab";
import MessagingPanel from "@/components/shared/MessagingPanel";
import { useAuth } from "@/hooks/useAuth";
import { useRoutes } from "@/hooks/useRoutes";
import { useDrivers } from "@/hooks/useDrivers";
import { useBuses } from "@/hooks/useBuses";
import { Navigation, User, Radio, ArrowLeft } from "lucide-react";
import { rtdb } from "@/lib/firebase";
import { ref, update, remove, onDisconnect, serverTimestamp, onValue } from "firebase/database";

type Tab = "map" | "profile";

export default function DriverPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { routes } = useRoutes();
  const { drivers } = useDrivers();
  const { buses } = useBuses();
  const [driverId, setDriverId] = useState("");
  const [selectedBusId, setSelectedBusId] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("driverId");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setDriverId(saved);
  }, []);

  useEffect(() => {
    if (driverId) localStorage.setItem("driverId", driverId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedBusId("");
  }, [driverId]);

  const activeDriver = drivers.find(d => d.id === driverId);
  const busId = selectedBusId || activeDriver?.assignedBusId || "";

  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([]);
  const [isTracking, setIsTracking] = useState(false);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number; heading: number } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("map");
  const [isMessagingOpen, setIsMessagingOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const busIdRef = useRef("");
  const routeIdsRef = useRef<string[]>([]);
  const currentStopIndexRef = useRef<number>(0);
  const delayMinutesRef = useRef<number>(0);

  const handleStopIndexChange = useCallback((index: number) => {
    currentStopIndexRef.current = index;
  }, []);

  useEffect(() => { busIdRef.current = busId; }, [busId]);
  useEffect(() => { routeIdsRef.current = selectedRouteIds; }, [selectedRouteIds]);

  useEffect(() => {
    if (routes.length > 0 && selectedRouteIds.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedRouteIds([routes[0].id]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes]);

  // Also keep a dummy socketRef for DriverMap compatibility (DriverMap accepts it but we won't use it for tracking)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const socketRef = useRef<any>(null);

  const activeRoute = routes.find(r => selectedRouteIds.includes(r.id)) || routes.find(r => r.id === selectedRouteIds[0]);

  const handleStartTracking = useCallback(() => {
    if (!busId || selectedRouteIds.length === 0) return;
    setIsTracking(true);

    // Write initial shift metadata (e.g., actual driver ID), ESP32 hardware will provide location
    const currentBusId = busId;
    const currentRouteIds = selectedRouteIds;
    
    const payload = {
      driverId: driverId || user?.uid || "driver",
      status: "active",
      currentStopIndex: currentStopIndexRef.current,
      delayMinutes: delayMinutesRef.current,
    };

    currentRouteIds.forEach(routeId => {
      const busRef = ref(rtdb, `activeBuses/${currentBusId}_${routeId}`);
      update(busRef, { ...payload, routeId }).catch(err =>
        console.error("[RTDB] Write failed:", err)
      );
    });
  }, [busId, selectedRouteIds, driverId, user?.uid]);

  // Pure GNSS listener (read-only mode for driver location)
  useEffect(() => {
    if (!busId || !isTracking) return;

    const busRef = ref(rtdb, `activeBuses/${busId}_${selectedRouteIds[0]}`);
    const unsubscribe = onValue(busRef, (snapshot) => {
      const data = snapshot.val();
      if (data && data.lat && data.lng) {
        setDriverLocation({
          lat: data.lat,
          lng: data.lng,
          heading: data.heading || 0,
        });
      }
    });
    // Correct Modular SDK cleanup — off() with a callback is Compat SDK syntax
    return () => unsubscribe();
  }, [busId, selectedRouteIds, isTracking]);

  const handleStopTracking = useCallback(() => {
    const currentBusId = busIdRef.current;
    const currentRouteIds = routeIdsRef.current;
    setIsTracking(false);
    setDriverLocation(null);

    // Mark bus as offline (ESP32 will continue sending GPS but status can be overridden here)
    currentRouteIds.forEach(routeId => {
      const busRef = ref(rtdb, `activeBuses/${currentBusId}_${routeId}`);
      update(busRef, { status: "offline", driverId: "hw_device" }).catch(console.error);
    });

    // Clean up messages
    const messagesRef = ref(rtdb, `messages/${currentBusId}`);
    remove(messagesRef).catch(console.error);
  }, []);

  const handleRouteUpdate = useCallback((routeIds: string[]) => {
    // Called when driver changes route mid-trip — just update local refs; next tick will write new RTDB entries
    routeIdsRef.current = routeIds;
  }, []);

  const handleOpenMessaging = () => {
    setIsMessagingOpen(true);
    setUnreadCount(0);
  };

  return (
    <div className="flex flex-col bg-brand-dark text-white overflow-hidden" style={{ height: "100dvh" }}>
      <div className="relative flex-1 flex flex-col overflow-hidden min-h-0">

        <div className={`absolute inset-0 z-0 flex flex-col ${activeTab === "map" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
          <div className="flex-1 relative z-0 min-h-0">
            {activeRoute && (
              <DriverMap
                route={activeRoute}
                driverLocation={driverLocation}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                socketRef={socketRef as any}
                busId={busId}
                onEndShift={handleStopTracking}
                isTracking={isTracking}
                selectedRouteIds={selectedRouteIds}
                onStopIndexChange={handleStopIndexChange}
              />
            )}
          </div>

          {!isTracking && (
            <div className="shrink-0 z-10 w-full">
              <TransmitterControls
                busId={busId}
                driverId={driverId}
                setDriverId={setDriverId}
                buses={buses}
                setSelectedBusId={setSelectedBusId}
                drivers={drivers}
                selectedRouteIds={selectedRouteIds}
                setSelectedRouteIds={setSelectedRouteIds}
                isTracking={isTracking}
                onStartTracking={handleStartTracking}
                onStopTracking={handleStopTracking}
                onRouteUpdate={handleRouteUpdate}
                isSocketConnected={true}
              />
            </div>
          )}
        </div>

        <div className={`absolute inset-0 z-10 flex flex-col bg-brand-dark transition-opacity duration-300 ${activeTab === "profile" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
          <DriverProfileTab driverId={driverId || "UNASSIGNED"} busId={busId || "UNASSIGNED"} onStopTracking={handleStopTracking} isTracking={isTracking} />
        </div>

        {/* Back Button FAB — top left, only shown when not tracking */}
        {activeTab === "map" && !isTracking && (
          <div className="absolute top-4 left-4 z-50">
            <button
              onClick={() => router.back()}
              className="w-12 h-12 rounded-full bg-brand-surface/90 backdrop-blur-xl border border-white/10 text-white flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-all"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5 text-white/70" />
            </button>
          </div>
        )}

        {/* Messaging FAB — top right */}
        {activeTab === "map" && !isMessagingOpen && (
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

        {/* Messaging Overlay */}
        {isMessagingOpen && (
          <div className="absolute inset-x-0 bottom-0 top-0 z-50 animate-slide-up">
            <MessagingPanel
              busId={busId}
              currentUserRole="driver"
              currentUserId={user?.uid || driverId || "operator"}
              currentUserName={user?.displayName || "Operator"}
              isOverlay={true}
              onClose={() => setIsMessagingOpen(false)}
              onUnreadCountChange={setUnreadCount}
            />
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <nav className="relative z-50 shrink-0 bg-brand-surface/80 border-t border-white/5 backdrop-blur-2xl pb-safe" style={{ height: "64px" }}>
        <div className="flex items-center justify-around px-4 h-full max-w-md mx-auto">
          <button
            onClick={() => setActiveTab("map")}
            className={`flex flex-col items-center justify-center py-2 flex-1 rounded-2xl transition-all duration-300 ${
              activeTab === "map" ? "text-white bg-white/5 transform scale-105" : "text-white/30 hover:text-white/60"
            }`}
          >
            <Navigation className={`w-5 h-5 mb-1 ${activeTab === "map" ? "text-white" : "opacity-40"}`} />
            <span className="text-[9px] font-black tracking-[0.15em] uppercase">Drive View</span>
          </button>

          <button
            onClick={() => setActiveTab("profile")}
            className={`flex flex-col items-center justify-center py-2 flex-1 rounded-2xl transition-all duration-300 ${
              activeTab === "profile" ? "text-white bg-white/5 transform scale-105" : "text-white/30 hover:text-white/60"
            }`}
          >
            <User className={`w-5 h-5 mb-1 ${activeTab === "profile" ? "text-white" : "opacity-40"}`} />
            <span className="text-[9px] font-black tracking-[0.15em] uppercase">Profile</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
