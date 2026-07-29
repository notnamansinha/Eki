"use client";

import { useState, useEffect, useCallback } from "react";
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
import { auth } from "@/lib/firebaseAuth";
import { rtdb } from "@/lib/firebaseDatabase";
import { ref, onValue } from "firebase/database";
import { useRTDBResume } from "@/hooks/useRTDBResume";

const DriverMap = dynamic(() => import("@/components/maps/DriverMap"), {
  ssr: false,
  loading: () => <div className="h-full bg-[var(--surface-0)]" role="status" aria-label="Loading map" />,
});

type Tab = "map" | "profile";

export default function DriverPage() {
  const { resumeGeneration } = useRTDBResume();
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
  const [currentStopIndex, setCurrentStopIndex] = useState(0);
  const [tripState, setTripState] = useState<"pre_departure" | "in_service">("pre_departure");
  const [lifecycleError, setLifecycleError] = useState("");
  const [isLifecyclePending, setIsLifecyclePending] = useState(false);

  const handleStartTracking = useCallback(async () => {
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

    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
    if (!backendUrl) {
      setLifecycleError("Shift service is not configured.");
      return;
    }
    setLifecycleError("");
    setIsLifecyclePending(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const routeId = selectedRouteIds[0];
      const response = await fetch(`${backendUrl}/api/shifts/start`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ busId, routeId }),
      });
      const result = await response.json() as { sessionId?: string; error?: string };
      if (!response.ok || !result.sessionId) {
        throw new Error(result.error || "Unable to start shift.");
      }
      setCurrentStopIndex(0);
      setActiveSessionIds({ [routeId]: result.sessionId });
      setIsTracking(true);
    } catch (error) {
      setLifecycleError(error instanceof Error ? error.message : "Unable to start shift.");
    } finally {
      setIsLifecyclePending(false);
    }
  }, [busId, buses, selectedRouteIds, driverId, drivers]);

  // Backend-authoritative live shift listener. It also restores an active
  // session after refresh/background eviction.
  useEffect(() => {
    if (!busId || selectedRouteIds.length !== 1) return;

    if (!auth.currentUser) return;

    const busRef = ref(rtdb, `activeBuses/${busId}_${selectedRouteIds[0]}`);
    const unsubscribe = onValue(busRef, (snapshot) => {
        const data = snapshot.val();
        if (data && Number.isFinite(data.lat) && Number.isFinite(data.lng)) {
          setDriverLocation({
            lat: data.lat,
            lng: data.lng,
            heading: data.heading || 0,
            speed: data.speed || 0,
          });
        }
        if (
          data?.driverId === driverId &&
          data?.status === "active" &&
          typeof data?.sessionId === "string"
        ) {
          setActiveSessionIds({ [selectedRouteIds[0]]: data.sessionId });
          setCurrentStopIndex(Number.isInteger(data.currentStopIndex) ? data.currentStopIndex : 0);
          setTripState(data.tripState === "in_service" ? "in_service" : "pre_departure");
          setIsTracking(true);
        } else {
          setIsTracking(false);
          setActiveSessionIds({});
          setCurrentStopIndex(0);
          setTripState("pre_departure");
        }
      }, (error) => {
        console.warn("[RTDB] activeBuses read failed in GNSS listener:", error.message);
      });

    return () => {
      unsubscribe();
    };
  }, [busId, driverId, selectedRouteIds, resumeGeneration]);

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
              <>
                <DriverMap
                  key={`${activeRoute.id}-${isTracking ? "tracking" : "preview"}`}
                  route={activeRoute}
                  driverLocation={driverLocation}
                  busId={busId}
                  isTracking={isTracking}
                  selectedRouteIds={selectedRouteIds}
                  currentStopIndex={currentStopIndex}
                  tripState={tripState}
                />
                {(lifecycleError || isLifecyclePending) && (
                  <p className="absolute bottom-3 left-4 right-4 z-50 px-3 py-2 rounded-lg text-xs" role="status" style={{ background: "var(--surface-2)", color: lifecycleError ? "var(--status-danger)" : "var(--text-secondary)" }}>
                    {lifecycleError || "Updating shift…"}
                  </p>
                )}
              </>
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
                onStartTracking={handleStartTracking}
                isSocketConnected={true}
              />
            </div>
          )}
        </div>

        <div className={`absolute inset-0 z-10 flex flex-col transition-opacity duration-300 ${activeTab === "profile" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
          style={{ background: "var(--surface-0)" }}>
          <DriverProfileTab driverId={driverId || "UNASSIGNED"} busId={busId || "UNASSIGNED"} isTracking={isTracking} />
        </div>

        {/* Back Button FAB */}
        {activeTab === "map" && !isTracking && (
          <div className="absolute top-4 left-4 z-50">
            <button
              onClick={() => router.back()}
              className="w-11 h-11 rounded-xl flex items-center justify-center transition-all active:scale-95"
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
              className="w-11 h-11 rounded-xl flex items-center justify-center transition-all active:scale-95 relative"
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
