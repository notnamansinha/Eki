"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import TransmitterControls from "@/components/driver/TransmitterControls";
import DriverProfileTab from "@/components/driver/DriverProfileTab";
import MessagingPanel from "@/components/shared/MessagingPanel";
import { useAuth } from "@/hooks/useAuth";
import { useRoutes } from "@/hooks/useRoutes";
import { useDrivers } from "@/hooks/useDrivers";
import { useBuses } from "@/hooks/useBuses";
import { Map, CircleUserRound as User, MessageCircle, ArrowLeft } from "lucide-react";
import { db, rtdb, auth } from "@/lib/firebase";
import { collection, doc, setDoc, updateDoc, arrayUnion, serverTimestamp as firestoreServerTimestamp } from "firebase/firestore";
import { ref, update, onValue } from "firebase/database";

const DriverMap = dynamic(() => import("@/components/maps/DriverMap"), {
  ssr: false,
  loading: () => <div className="h-full bg-[var(--surface-0)]" role="status" aria-label="Loading map" />,
});

type Tab = "map" | "profile";

export default function DriverPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { routes } = useRoutes();
  const { drivers } = useDrivers();
  const { buses } = useBuses();
  const [selectedBusId, setSelectedBusId] = useState("");
  const [activeSessionIds, setActiveSessionIds] = useState<Record<string, string>>({});
  const activeDriver = drivers.find((driver) => driver.authUid === user?.uid);
  const driverId = activeDriver?.id ?? "";
  const busId = selectedBusId || activeDriver?.assignedBusId || "";

  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([]);
  const activeRoute = routes.find(r => selectedRouteIds.includes(r.id)) || routes.find(r => r.id === selectedRouteIds[0]);
  const [isTracking, setIsTracking] = useState(false);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number; heading: number; speed?: number } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("map");
  const [isMessagingOpen, setIsMessagingOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const busIdRef = useRef("");
  const routeIdsRef = useRef<string[]>([]);
  const currentStopIndexRef = useRef<number>(0);
  const delayMinutesRef = useRef<number>(0);
  const driverLocationRef = useRef<{ lat: number; lng: number } | null>(null);


  const handleStopIndexChange = useCallback((index: number, routeIdHint?: string) => {
    currentStopIndexRef.current = index;
    
    // Log the stop reached to Firestore
    const currentSessionId = activeSessionIds[selectedRouteIds[0]];
    if (currentSessionId && activeRoute?.stops?.[index]) {
      updateDoc(doc(db, "ride_sessions", currentSessionId), {
        stopsReached: arrayUnion({
          stopIndex: index,
          stopId: activeRoute.stops[index].id,
          stopName: activeRoute.stops[index].name,
          timestamp: firestoreServerTimestamp()
        })
      }).catch(console.error);
    }

    // Sync stop changes to Passenger Panels instantly via RTDB
    // Use the most specific route IDs available (hint from DriverMap > routeIdsRef > activeRoute)
    const routesToUpdate = routeIdsRef.current.length > 0
      ? routeIdsRef.current
      : routeIdHint
        ? [routeIdHint]
        : activeRoute
          ? [activeRoute.id]
          : [];

    routesToUpdate.forEach(routeId => {
      const activeBusId = busIdRef.current || "test_bus_1";

      const busRef = ref(rtdb, `activeBuses/${activeBusId}_${routeId}`);
      update(busRef, {
        currentStopIndex: index,
        timestamp: Date.now(),
        tripState: "in_service",
      }).catch(console.error);
    });
  }, [activeSessionIds, selectedRouteIds, activeRoute]);

  useEffect(() => { busIdRef.current = busId; }, [busId]);
  useEffect(() => { routeIdsRef.current = selectedRouteIds; }, [selectedRouteIds]);
  useEffect(() => { driverLocationRef.current = driverLocation; }, [driverLocation]);

  const handleStartTracking = useCallback(() => {
    const activeBus = buses.find((bus) => bus.id === busId);
    const assignedRouteIds = activeBus?.assignedRoutes ??
      (activeBus?.assignedRouteId ? [activeBus.assignedRouteId] : []);
    if (!busId || !driverId || !drivers.some(d => d.id === driverId) ||
      selectedRouteIds.length !== 1 || !assignedRouteIds.includes(selectedRouteIds[0])) {
      return;
    }
    if (!auth.currentUser) {
      console.warn("[Driver] Tracking requires the signed-in driver session.");
      return;
    }

    setIsTracking(true);

    const currentBusId = busId;
    const currentRouteIds = selectedRouteIds;
    
    // Generate session IDs for each route being tracked
    const newSessionIds: Record<string, string> = {};
    currentRouteIds.forEach(routeId => {
      newSessionIds[routeId] = doc(collection(db, "ride_sessions")).id;
    });
    setActiveSessionIds(newSessionIds);
    
    const basePayload = {
      busId: currentBusId,
      driverId: driverId || auth.currentUser?.uid || "driver",
      status: "active",
      deviceState: "online",
      tripState: "in_service",
      timestamp: Date.now(),
      currentStopIndex: currentStopIndexRef.current,
      delayMinutes: delayMinutesRef.current,
    };

    const doWrite = () => {
      currentRouteIds.forEach(routeId => {
        const sessionId = newSessionIds[routeId];
        const payload = { ...basePayload, routeId, sessionId };
        
        // 1. RTDB Update
        const busRef = ref(rtdb, `activeBuses/${currentBusId}_${routeId}`);
        update(busRef, payload)
          .catch(err => console.error("[Driver] RTDB write failed:", err.code, err.message));
        
        // 2. Firestore Session Record
        setDoc(doc(db, "ride_sessions", sessionId), {
          id: sessionId,
          busId: currentBusId,
          driverId: driverId || auth.currentUser?.uid || "driver",
          routeId: routeId,
          startTime: Date.now(),
          status: "active",
          passengers: {}
        }).catch(err => console.error("[Driver] Firestore write failed:", err));
      });
    };

    doWrite();
  }, [busId, buses, selectedRouteIds, driverId, drivers]);

  // Pure GNSS listener (read-only mode for driver location)
  useEffect(() => {
    if (!busId || !isTracking) return;

    if (!auth.currentUser) return;

    const busRef = ref(rtdb, `activeBuses/${busId}_${selectedRouteIds[0]}`);
    const unsubscribe = onValue(busRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.lat && data.lng) {
          setDriverLocation({
            lat: data.lat,
            lng: data.lng,
            heading: data.heading || 0,
            speed: data.speed || 0,
          });

        }
      }, (error) => {
        console.warn("[RTDB] activeBuses read failed in GNSS listener:", error.message);
      });

    return () => {
      unsubscribe();
    };
  }, [busId, selectedRouteIds, isTracking]);

  const handleStopTracking = useCallback(() => {
    const currentBusId = busIdRef.current;
    const currentRouteIds = routeIdsRef.current;
    setIsTracking(false);
    setDriverLocation(null);

    currentRouteIds.forEach(routeId => {
      // End RTDB tracking
      const busRef = ref(rtdb, `activeBuses/${currentBusId}_${routeId}`);
      update(busRef, { 
        status: "offline", 
        deviceState: "offline", 
        tripState: "ended",
      }).catch(console.error);

      // End Firestore session
      const sessionId = activeSessionIds[routeId];
      if (sessionId) {
        updateDoc(doc(db, "ride_sessions", sessionId), {
          endTime: Date.now(),
          status: "completed"
        }).catch(console.error);
      }
    });

    setActiveSessionIds({});

    // Optional: Only clear legacy messages if using busId path, but we are using sessionId now.
    // const messagesRef = ref(rtdb, `messages/${currentBusId}`);
    // remove(messagesRef).catch(console.error);
  }, [activeSessionIds]);

  const handleRouteUpdate = useCallback((routeIds: string[]) => {
    routeIdsRef.current = routeIds;
  }, []);

  const handleOpenMessaging = () => {
    setIsMessagingOpen(true);
    setUnreadCount(0);
  };

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: "100dvh", background: "var(--surface-0)", color: "var(--text-primary)" }}>
      <div className="relative flex-1 flex flex-col overflow-hidden min-h-0">

        <div className={`absolute inset-0 z-0 flex flex-col ${activeTab === "map" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
          <div className="flex-1 relative z-0 min-h-0">
            {activeRoute && (
              <DriverMap
                key={`${activeRoute.id}-${isTracking ? "tracking" : "preview"}`}
                route={activeRoute}
                driverLocation={driverLocation}
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
                setDriverId={() => {}}
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

        <div className={`absolute inset-0 z-10 flex flex-col transition-opacity duration-300 ${activeTab === "profile" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
          style={{ background: "var(--surface-0)" }}>
          <DriverProfileTab driverId={driverId || "UNASSIGNED"} busId={busId || "UNASSIGNED"} onStopTracking={handleStopTracking} isTracking={isTracking} />
        </div>

        {/* Back Button FAB */}
        {activeTab === "map" && !isTracking && (
          <div className="absolute top-4 left-4 z-50">
            <button
              onClick={() => router.back()}
              className="w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-95"
              style={{ 
                background: "var(--surface-2)", 
                border: "1px solid var(--border-default)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.3)"
              }}
              aria-label="Go back"
            >
              <ArrowLeft className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />
            </button>
          </div>
        )}

        {/* Messaging FAB */}
        {activeTab === "map" && !isMessagingOpen && (
          <div className="absolute top-4 right-4 z-50">
            <button
              onClick={handleOpenMessaging}
              className="w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-95 relative"
              style={{ 
                background: "var(--surface-2)", 
                border: "1px solid var(--border-default)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.3)"
              }}
              aria-label="Open live comms"
            >
              <MessageCircle className="w-5 h-5" style={{ color: "var(--status-live)" }} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] rounded-full flex items-center justify-center text-[9px] font-semibold text-white px-1"
                  style={{ background: "var(--status-danger)", boxShadow: "0 0 0 2px var(--surface-0)" }}>
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
              key={activeSessionIds[selectedRouteIds[0]] || "no-session"}
              sessionId={activeSessionIds[selectedRouteIds[0]] || ""}
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
      <nav className="relative z-50 shrink-0 pb-safe" style={{ 
        height: "64px", 
        background: "var(--surface-1)", 
        borderTop: "1px solid var(--border-subtle)" 
      }}>
        <div className="flex items-center justify-around px-4 h-full max-w-md mx-auto">
          <button
            onClick={() => setActiveTab("map")}
            className="flex flex-col items-center justify-center py-2 flex-1 rounded-xl transition-all duration-300 relative"
          >
            {activeTab === "map" && (
              <div className="absolute top-0 w-6 h-0.5 rounded-full" style={{ background: "var(--text-primary)" }} />
            )}
            <Map className="w-5 h-5 mb-1" style={{ color: activeTab === "map" ? "var(--text-primary)" : "var(--text-ghost)" }} />
            <span className="text-[9px] font-semibold" style={{ color: activeTab === "map" ? "var(--text-primary)" : "var(--text-ghost)" }}>
              Drive
            </span>
          </button>

          <button
            onClick={() => setActiveTab("profile")}
            className="flex flex-col items-center justify-center py-2 flex-1 rounded-xl transition-all duration-300 relative"
          >
            {activeTab === "profile" && (
              <div className="absolute top-0 w-6 h-0.5 rounded-full" style={{ background: "var(--text-primary)" }} />
            )}
            <User className="w-5 h-5 mb-1" style={{ color: activeTab === "profile" ? "var(--text-primary)" : "var(--text-ghost)" }} />
            <span className="text-[9px] font-semibold" style={{ color: activeTab === "profile" ? "var(--text-primary)" : "var(--text-ghost)" }}>
              Profile
            </span>
          </button>
        </div>
      </nav>
    </div>
  );
}
