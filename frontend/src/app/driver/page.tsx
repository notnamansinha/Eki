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
import { Map, CircleUserRound as User, MessageCircle, ArrowLeft } from "lucide-react";
import { db, rtdb, auth } from "@/lib/firebase";
import { collection, doc, setDoc, updateDoc, arrayUnion } from "firebase/firestore";
import { ref, update, remove, onValue, onDisconnect } from "firebase/database";
import { signInAnonymously } from "firebase/auth";

type Tab = "map" | "profile";

export default function DriverPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { routes } = useRoutes();
  const { drivers } = useDrivers();
  const { buses } = useBuses();
  const [driverId, setDriverId] = useState("");
  const [selectedBusId, setSelectedBusId] = useState("");
  const [activeSessionIds, setActiveSessionIds] = useState<Record<string, string>>({});

  useEffect(() => {
    const saved = localStorage.getItem("driverId");
     
    if (saved) setDriverId(saved);
  }, []);

  useEffect(() => {
    if (driverId) localStorage.setItem("driverId", driverId);
     
    setSelectedBusId("");
  }, [driverId]);

  const activeDriver = drivers.find(d => d.id === driverId);
  const busId = selectedBusId || activeDriver?.assignedBusId || "";

  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([]);
  const activeRoute = routes.find(r => selectedRouteIds.includes(r.id)) || routes.find(r => r.id === selectedRouteIds[0]);
  const [isTracking, setIsTracking] = useState(false);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number; heading: number } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("map");
  const [isMessagingOpen, setIsMessagingOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const busIdRef = useRef("");
  const routeIdsRef = useRef<string[]>([]);
  const currentStopIndexRef = useRef<number>(0);
  const delayMinutesRef = useRef<number>(0);

  const lastLogTimeRef = useRef<number>(0);

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
          timestamp: Date.now()
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
      const stopLat = activeRoute?.stops?.[index]?.lat ?? 23.03;
      const stopLng = activeRoute?.stops?.[index]?.lng ?? 72.55;
      const busRef = ref(rtdb, `activeBuses/${activeBusId}_${routeId}`);
      update(busRef, {
        busId: activeBusId,
        routeId: routeId,
        lat: stopLat,
        lng: stopLng,
        currentStopIndex: index,
        timestamp: Date.now(),
        tripState: "in_service",
        status: "active",
        deviceState: "online"
      }).catch(console.error);
    });
  }, [activeSessionIds, selectedRouteIds, activeRoute]);

  useEffect(() => { busIdRef.current = busId; }, [busId]);
  useEffect(() => { routeIdsRef.current = selectedRouteIds; }, [selectedRouteIds]);

  useEffect(() => {
    if (routes.length > 0 && selectedRouteIds.length === 0) {
       
      setSelectedRouteIds([routes[0].id]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes]);


  const handleStartTracking = useCallback(() => {
    console.log("[Driver] handleStartTracking called", { busId, driverId, selectedRouteIds, driversLen: drivers.length });
    if (!busId || !driverId || !drivers.some(d => d.id === driverId) || selectedRouteIds.length === 0) {
      console.warn("[Driver] Guard prevented start:", { busId, driverId, routeCount: selectedRouteIds.length, driverFound: drivers.some(d => d.id === driverId) });
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
      lat: activeRoute?.stops?.[0]?.lat || 23.03,
      lng: activeRoute?.stops?.[0]?.lng || 72.55,
      speed: 0,
      heading: 0,
      motionState: "stopped",
      currentStopIndex: currentStopIndexRef.current,
      delayMinutes: delayMinutesRef.current,
    };

    console.log("[Driver] Writing to RTDB:", { currentBusId, currentRouteIds, basePayload, currentUser: auth.currentUser?.uid });

    const doWrite = () => {
      currentRouteIds.forEach(routeId => {
        const sessionId = newSessionIds[routeId];
        const payload = { ...basePayload, routeId, sessionId };
        
        // 1. RTDB Update
        const busRef = ref(rtdb, `activeBuses/${currentBusId}_${routeId}`);
        update(busRef, payload)
          .then(() => console.log("[Driver] RTDB write succeeded for", `${currentBusId}_${routeId}`))
          .catch(err => console.error("[Driver] RTDB write FAILED:", err.code, err.message));
        
        // Prevent ghost sessions if the driver forces app close
        onDisconnect(busRef).update({
          status: "offline",
          deviceState: "offline",
          tripState: "ended",
          timestamp: Date.now()
        }).catch(() => {});

        // 2. Firestore Session Record
        setDoc(doc(db, "ride_sessions", sessionId), {
          id: sessionId,
          busId: currentBusId,
          driverId: driverId || auth.currentUser?.uid || "driver",
          routeId: routeId,
          startTime: Date.now(),
          status: "active",
          passengers: []
        }).catch(err => console.error("[Driver] Firestore write failed:", err));
      });
    };

    if (auth.currentUser) {
      doWrite();
    } else {
      // Driver not yet authenticated — sign in anonymously then write
      signInAnonymously(auth)
        .then(doWrite)
        .catch(err => console.error("[Driver] Auth failed before RTDB write:", err.message));
    }
  }, [busId, selectedRouteIds, driverId, user?.uid, activeRoute, drivers]);

  // Pure GNSS listener (read-only mode for driver location)
  useEffect(() => {
    if (!busId || !isTracking) return;

    let unsubscribe: (() => void) | undefined;
    let isMounted = true;

    signInAnonymously(auth).then(() => {
      if (!isMounted) return;
      const busRef = ref(rtdb, `activeBuses/${busId}_${selectedRouteIds[0]}`);
      unsubscribe = onValue(busRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.lat && data.lng) {
          setDriverLocation({
            lat: data.lat,
            lng: data.lng,
            heading: data.heading || 0,
          });

          const now = Date.now();
          if (now - lastLogTimeRef.current > 15000 && data.sessionId) {
            lastLogTimeRef.current = now;
            updateDoc(doc(db, "ride_sessions", data.sessionId), {
              path: arrayUnion({
                lat: data.lat,
                lng: data.lng,
                heading: data.heading || 0,
                speed: data.speed || 0,
                timestamp: now
              })
            }).catch(console.error);
          }
        }
      }, (error) => {
        console.warn("[RTDB] activeBuses read failed in GNSS listener:", error.message);
      });
    }).catch(err => console.warn("[RTDB Auth] GNSS listener sign-in failed:", err.code));

    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [busId, selectedRouteIds, isTracking]);

  // Software mode heartbeat to keep the bus "fresh" in the passenger app
  useEffect(() => {
    if (!isTracking) return;

    const intervalId = setInterval(() => {
      const currentBusId = busIdRef.current;
      const currentRouteIds = routeIdsRef.current;
      
      currentRouteIds.forEach(routeId => {
        if (!currentBusId || !routeId) return;
        const busRef = ref(rtdb, `activeBuses/${currentBusId}_${routeId}`);
        update(busRef, { timestamp: Date.now() }).catch(console.error);
      });
    }, 60000); // 1 minute heartbeat

    return () => clearInterval(intervalId);
  }, [isTracking]);

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
        driverId: "hw_device" 
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
  }, []);

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
                route={activeRoute}
                driverLocation={driverLocation}
                busId={busId}
                onEndShift={handleStopTracking}
                isTracking={isTracking}
                selectedRouteIds={selectedRouteIds}
                onStopIndexChange={handleStopIndexChange}
                onStartTracking={handleStartTracking}
                canStartTracking={!!busId && !!driverId && drivers.some(d => d.id === driverId) && selectedRouteIds.length > 0}
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
