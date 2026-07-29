"use client";

import { useState, useEffect, type ComponentType } from "react";
import { useBuses, BusData } from "@/hooks/useBuses";
import { useDrivers, DriverData } from "@/hooks/useDrivers";
import { useRoutes, type RouteData } from "@/hooks/useRoutes";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { auth } from "@/lib/firebaseAuth";
import { db } from "@/lib/firebaseFirestore";
import { subscribeLiveBuses } from "@/lib/liveBusStore";
import {
  Bus, User, Trash2, Plus, ArrowRight,
  ChevronDown, ChevronUp, Pencil, Check, X, AlertCircle,
  Navigation, Gauge, MapPin, Clock, Radio, Activity, BarChart2,
  TrendingUp, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { errorMessage } from "@/lib/errors";

async function fleetRequest(path: string, method: "PUT" | "DELETE", body?: object) {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
  if (!backendUrl || !auth.currentUser) throw new Error("Fleet service is not configured.");
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`${backendUrl}/api/fleet${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error || "Fleet operation failed.");
}

// â”€â”€ Live bus tracking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface ActiveBusEntry {
  busId: string;
  driverId?: string;
  routeId?: string;
  lat?: number;
  lng?: number;
  speed?: number;
  heading?: number;
  timestamp?: number;
  deviceState?: "online" | "offline";
  motionState?: "moving" | "stopped" | "uncertain";
  tripState?: "pre_departure" | "in_service" | "completed";
  currentStopIndex?: number;
}

// â”€â”€ Completed trip analytics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface CompletedTrip {
  id: string;
  busId: string;
  driverId: string;
  routeId?: string;
  completedAt: string;
  stopCount: number;
  stopNames: string[];
}

function useActiveBuses(): ActiveBusEntry[] {
  const [active, setActive] = useState<ActiveBusEntry[]>([]);
  useEffect(() => {
    const unsubscribe = subscribeLiveBuses((snapshot) => {
      const data = snapshot as Record<string, ActiveBusEntry> | null;
      setActive(data ? Object.values(data) : []);
    }, (error) => {
      console.warn("[RTDB] activeBuses read failed:", error.message);
    });
    return unsubscribe;
  }, []);
  return active;
}

function useRecentTrips(count = 10): CompletedTrip[] {
  const [trips, setTrips] = useState<CompletedTrip[]>([]);
  useEffect(() => {
    const q = query(
      collection(db, "completed_trips"),
      orderBy("completedAt", "desc"),
      limit(count)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setTrips(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<CompletedTrip, "id">) })));
      },
      (error) => {
        console.warn("[Fleet] Completed trip history read failed:", error.message);
        setTrips([]);
      },
    );
    return () => unsub();
  }, [count]);
  return trips;
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function timeSince(isoStr?: string | number): string {
  if (!isoStr) return "—";
  const ms = typeof isoStr === "number" ? Date.now() - isoStr : Date.now() - new Date(isoStr).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

function headingLabel(deg?: number): string {
  if (deg == null) return "—";
  const dirs = ["N","NE","E","SE","S","SW","W","NW","N"];
  return dirs[Math.round(deg / 45) % 8] + ` ${Math.round(deg)}°`;
}

const TRIP_STATE_CONFIG: Record<string, { label: string; color: string; bg: string; Icon: ComponentType<{ className?: string }> }> = {
  pre_departure: { label: "Awaiting Stop 1", color: "text-white/50", bg: "bg-white/5", Icon: Clock },
  in_service:    { label: "In Service",  color: "text-emerald-400",  bg: "bg-emerald-500/10", Icon: Navigation    },
  completed:     { label: "Completed",   color: "text-blue-400",     bg: "bg-blue-500/10",    Icon: CheckCircle2  },
};

const MOTION_STATE_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  moving:    { label: "Moving",   color: "text-emerald-400", dot: "bg-emerald-400" },
  stopped:   { label: "Stopped",  color: "text-amber-400",   dot: "bg-amber-400"   },
  uncertain: { label: "No GPS",   color: "text-red-400",     dot: "bg-red-400"     },
};

// â”€â”€ Inline error banner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl px-3 py-2 text-xs font-semibold animate-slide-up">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss error" className="shrink-0 hover:text-white transition-colors">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// â”€â”€ Expanded live bus detail card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function LiveBusCard({ entry, buses, routes, drivers }: {
  entry: ActiveBusEntry;
  buses: BusData[];
  routes: RouteData[];
  drivers: DriverData[];
}) {
  const [expanded, setExpanded] = useState(false);
  const bus = buses.find(b => b.id === entry.busId);
  const route = routes.find(r => r.id === entry.routeId);
  const driver = drivers.find(d => d.id === entry.driverId);
  const ts = TRIP_STATE_CONFIG[entry.tripState ?? "pre_departure"] ?? TRIP_STATE_CONFIG.pre_departure;
  const ms = MOTION_STATE_CONFIG[entry.motionState ?? "uncertain"] ?? MOTION_STATE_CONFIG.uncertain;
  const TsIcon = ts.Icon;
  const stopsTotal = route?.stops?.length ?? 0;
  const stopIdx = (entry.currentStopIndex ?? 0) + 1;
  const nextStop = route?.stops?.[entry.currentStopIndex ?? 0];
  const followingStop = route?.stops?.[(entry.currentStopIndex ?? 0) + 1];

  return (
    <div className="bg-brand-surface border border-border-thin rounded-md overflow-hidden transition-colors hover:border-white/30">
      {/* Compact header */}
      <button
        onClick={() => setExpanded(o => !o)}
        aria-label={`${expanded ? "Collapse" : "Expand"} details for bus ${bus?.name ?? entry.busId}`}
        className="w-full p-3.5 flex items-center justify-between gap-3 hover:bg-white/3 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Trip state icon */}
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${ts.bg}`}>
            <TsIcon className={`w-4 h-4 ${ts.color}`} />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white text-sm truncate">
                {bus?.name ?? entry.busId}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className={`text-[9px] font-black uppercase tracking-widest flex items-center gap-1 ${ts.color}`}>
                <TsIcon className="w-2.5 h-2.5" />
                {ts.label}
              </span>
              <span className={`text-[9px] font-semibold flex items-center gap-1 ${ms.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full inline-block ${ms.dot} ${entry.motionState === "moving" ? "animate-pulse" : ""}`} />
                {ms.label}
              </span>
              {entry.speed != null && (
                <span className="text-[9px] text-white/30 tabular-nums">{Math.round(entry.speed)} km/h</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {route && stopsTotal > 0 && (
            <span className="text-[9px] text-white/30 tabular-nums hidden sm:block">
              {stopIdx}/{stopsTotal} stops
            </span>
          )}
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-white/30" /> : <ChevronDown className="w-3.5 h-3.5 text-white/30" />}
        </div>
      </button>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="border-t border-white/5 p-4 flex flex-col gap-3">

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { icon: Gauge,      label: "Speed",    value: entry.speed != null ? `${Math.round(entry.speed)} km/h` : "—" },
              { icon: Navigation, label: "Heading",  value: headingLabel(entry.heading) },
              { icon: MapPin,     label: "Position", value: entry.lat != null ? `${entry.lat.toFixed(4)}, ${entry.lng?.toFixed(4)}` : "—" },
              { icon: Clock,      label: "Last Seen",value: timeSince(entry.timestamp) },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="bg-white/3 border border-white/5 rounded-xl p-2.5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <Icon className="w-3 h-3 text-white/25" />
                  <span className="text-[8px] font-black uppercase tracking-wider text-white/30">{label}</span>
                </div>
                <span className="text-xs font-semibold text-white tabular-nums truncate">{value}</span>
              </div>
            ))}
          </div>

          {/* Route progress bar */}
          {route && stopsTotal > 0 && entry.tripState === "in_service" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-wider text-white/30">Route Progress</span>
                <span className="text-[9px] tabular-nums text-white/50">{stopIdx} of {stopsTotal} stops</span>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-700"
                  style={{ width: `${Math.round((stopIdx / stopsTotal) * 100)}%` }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-0.5">
                {nextStop && (
                  <div className="flex flex-col">
                    <span className="text-[8px] text-white/25 uppercase font-black tracking-wider">Next Stop</span>
                    <span className="text-[10px] font-semibold text-white truncate">{nextStop.name}</span>
                  </div>
                )}
                {followingStop && (
                  <div className="flex flex-col">
                    <span className="text-[8px] text-white/25 uppercase font-black tracking-wider">Following Stop</span>
                    <span className="text-[10px] font-semibold text-white/60 truncate">{followingStop.name}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Driver + Route identifiers */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[8px] font-black uppercase tracking-wider text-white/30">Driver</span>
              <span className="text-[10px] font-semibold text-white truncate">{driver?.name ?? entry.driverId ?? "—"}</span>
              <span className="text-[9px] tabular-nums text-white/20">{entry.driverId}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[8px] font-black uppercase tracking-wider text-white/30">Route</span>
              <span className="text-[10px] font-semibold text-white truncate">{route?.name ?? entry.routeId ?? "—"}</span>
              <span className="text-[9px] tabular-nums text-white/20">{entry.routeId}</span>
            </div>
          </div>

          {/* Bus ID */}
          <div className="flex items-center gap-2 border-t border-white/5 pt-2.5 mt-0.5">
            <Radio className="w-3 h-3 text-white/20" />
            <span className="text-[9px] text-white/25 font-black uppercase tracking-wider">Bus ID</span>
            <span className="text-[9px] tabular-nums text-white/50 ml-auto">{entry.busId}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// â”€â”€ Recent trips analytics section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function RecentTripsPanel({ routes, buses, drivers }: { routes: RouteData[]; buses: BusData[]; drivers: DriverData[] }) {
  const trips = useRecentTrips(10);
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-brand-surface/40 border border-white/5 rounded-[1.5rem] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={open ? "Collapse recent trips" : "Expand recent trips"}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-blue-400/70" />
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">Route Analytics</span>
          {trips.length > 0 && (
            <span className="text-[9px] bg-blue-500/20 text-blue-400 font-black px-2 py-0.5 rounded-full">
              {trips.length} trips
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-white/20" /> : <ChevronDown className="w-3.5 h-3.5 text-white/20" />}
      </button>

      {open && (
        <div className="border-t border-white/5 px-3 pb-3 flex flex-col gap-2">
          {trips.length === 0 ? (
            <p className="text-white/20 text-xs text-center py-6 font-semibold uppercase tracking-widest">No completed trips yet.</p>
          ) : (
            trips.map(trip => {
              const bus = buses.find(b => b.id === trip.busId);
              const route = routes.find(r => r.id === trip.routeId);
              const driver = drivers.find(d => d.id === trip.driverId);
              return (
                <div key={trip.id} className="bg-brand-dark/40 border border-white/5 rounded-xl p-3 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">{route?.name ?? trip.routeId ?? "Unknown Route"}</span>
                    <span className="text-[9px] text-white/30 tabular-nums">{timeSince(trip.completedAt)}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[9px] text-white/50 flex items-center gap-1">
                      <Bus className="w-2.5 h-2.5" />{bus?.name ?? trip.busId}
                    </span>
                    <span className="text-[9px] text-white/50 flex items-center gap-1">
                      <User className="w-2.5 h-2.5" />{driver?.name ?? trip.driverId}
                    </span>
                    <span className="text-[9px] text-white/50 flex items-center gap-1">
                      <MapPin className="w-2.5 h-2.5" />{trip.stopCount} stops
                    </span>
                    <span className="text-[9px] bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded font-black uppercase tracking-wider flex items-center gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5" />Completed
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  mode?: "fleet" | "personnel" | "routes";
}

export default function FleetManagementPanel({ mode = "fleet" }: Props) {
  const { buses, loading: busesLoading } = useBuses();
  const { drivers, loading: driversLoading } = useDrivers();
  const { routes } = useRoutes();
  const activeEntries = useActiveBuses();
  // Only show buses that are registered in the Firestore `buses` collection.
  // This acts as a defense-in-depth guard: even if RTDB cleanup is delayed
  // or a stale entry exists, deleted buses will never render in the UI.
  //
  // IMPORTANT: only apply the filter once `busesLoading` is false.
  // On initial render `buses` is [] (Firestore hasn't responded yet), so
  // filtering immediately would produce an empty Set and wipe out all stats.
  const registeredBusIds = new Set(buses.map((b) => b.id));
  const filteredActiveEntries = busesLoading
    ? activeEntries                                          // buses not ready yet — show all
    : activeEntries.filter((e) => registeredBusIds.has(e.busId)); // buses loaded — filter to registered only
  const activeBusIds = new Set(filteredActiveEntries.map((e) => e.busId));

  // â”€â”€ Error state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // â”€â”€ Bus add form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [newBusId, setNewBusId] = useState("");
  const [newBusName, setNewBusName] = useState("");
  const [newBusRoutes, setNewBusRoutes] = useState<string[]>([]);
  const [busListOpen, setBusListOpen] = useState(true);

  // â”€â”€ Bus inline edit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [editingBusId, setEditingBusId] = useState<string | null>(null);
  const [editBusName, setEditBusName] = useState("");
  const [editBusRoutes, setEditBusRoutes] = useState<string[]>([]);

  // â”€â”€ Driver add form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [newDriverId, setNewDriverId] = useState("");
  const [newDriverName, setNewDriverName] = useState("");
  const [newDriverAuthUid, setNewDriverAuthUid] = useState("");
  const [newDriverBusId, setNewDriverBusId] = useState("");
  const [driverListOpen, setDriverListOpen] = useState(true);

  // â”€â”€ Driver inline edit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [editDriverName, setEditDriverName] = useState("");
  const [editDriverAuthUid, setEditDriverAuthUid] = useState("");
  const [editDriverBusId, setEditDriverBusId] = useState("");

  // â”€â”€ Route togglers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const toggleRoute = (id: string) =>
    setNewBusRoutes((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );

  const toggleEditRoute = (id: string) =>
    setEditBusRoutes((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );

  // â”€â”€ Bus CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleAddBus = async () => {
    if (!newBusId || !newBusName) return;
    try {
      await fleetRequest(`/buses/${encodeURIComponent(newBusId)}`, "PUT", {
        name: newBusName,
        assignedRoutes: newBusRoutes,
      });
      setNewBusId(""); setNewBusName(""); setNewBusRoutes([]);
    } catch (error: unknown) { setErrorMsg("Failed to add Vehicle: " + errorMessage(error)); }
  };

  const handleDeleteBus = async (id: string) => {
    if (!confirm("Delete this vehicle? This cannot be undone.")) return;
    try {
      await fleetRequest(`/buses/${encodeURIComponent(id)}`, "DELETE");
    } catch (error: unknown) {
      setErrorMsg("Failed to delete Vehicle: " + errorMessage(error));
    }
  };

  const startEditBus = (bus: BusData) => {
    setEditingBusId(bus.id);
    setEditBusName(bus.name);
    setEditBusRoutes(bus.assignedRoutes ?? []);
    setEditingDriverId(null);
  };

  const handleSaveBus = async (id: string) => {
    try {
      await fleetRequest(`/buses/${encodeURIComponent(id)}`, "PUT", {
        name: editBusName,
        assignedRoutes: editBusRoutes,
      });
      setEditingBusId(null);
    } catch (error: unknown) { setErrorMsg("Failed to update Vehicle: " + errorMessage(error)); }
  };

  // â”€â”€ Driver CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleAddDriver = async () => {
    const authUid = newDriverAuthUid.trim();
    if (!newDriverId || !newDriverName || !authUid) {
      setErrorMsg("Operator ID, name, and Firebase Auth UID are required.");
      return;
    }
    try {
      await fleetRequest(`/drivers/${encodeURIComponent(newDriverId)}`, "PUT", {
        name: newDriverName,
        authUid,
        assignedBusId: newDriverBusId || null,
      });
      setNewDriverId(""); setNewDriverName(""); setNewDriverAuthUid(""); setNewDriverBusId("");
    } catch (error: unknown) { setErrorMsg("Failed to add Operator: " + errorMessage(error)); }
  };

  const handleDeleteDriver = async (id: string) => {
    if (!confirm("Delete this operator? This cannot be undone.")) return;
    try { await fleetRequest(`/drivers/${encodeURIComponent(id)}`, "DELETE"); }
    catch (error: unknown) { setErrorMsg("Failed to delete Operator: " + errorMessage(error)); }
  };

  const startEditDriver = (driver: DriverData) => {
    setEditingDriverId(driver.id);
    setEditDriverName(driver.name);
    setEditDriverAuthUid(driver.authUid ?? "");
    setEditDriverBusId(driver.assignedBusId ?? "");
    setEditingBusId(null);
  };

  const handleSaveDriver = async (id: string) => {
    const authUid = editDriverAuthUid.trim();
    if (!authUid) {
      setErrorMsg("Firebase Auth UID is required for every operator.");
      return;
    }
    try {
      await fleetRequest(`/drivers/${encodeURIComponent(id)}`, "PUT", {
        name: editDriverName,
        authUid,
        assignedBusId: editDriverBusId || null,
      });
      setEditingDriverId(null);
    } catch (error: unknown) { setErrorMsg("Failed to update Operator: " + errorMessage(error)); }
  };

  const liveDriverIds = new Set(filteredActiveEntries.map((e) => e.driverId).filter(Boolean));
  const liveDrivers = drivers.filter((d) => liveDriverIds.has(d.id));

  // â”€â”€ Fleet summary stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const inServiceCount  = filteredActiveEntries.filter(e => e.tripState === "in_service").length;
  const awaitingStartCount = filteredActiveEntries.filter(e => e.tripState === "pre_departure").length;
  const gpsLostCount    = filteredActiveEntries.filter(e => e.deviceState === "offline" || e.motionState === "uncertain").length;
  const movingCount     = filteredActiveEntries.filter(e => e.motionState === "moving").length;

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col gap-5 p-3 md:p-6 animate-slide-up">

      {/* â”€â”€ Global error banner â”€â”€ */}
      {errorMsg && (
        <ErrorBanner message={errorMsg} onDismiss={() => setErrorMsg(null)} />
      )}


      {/* â•â• FLEET COMMAND CENTER — always visible, driven by live Firebase data â•â• */}
      <div className="flex flex-col gap-3">
        {/* Fleet summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { icon: Activity,     label: "In Service",  value: inServiceCount,  color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
            { icon: TrendingUp,   label: "Moving",      value: movingCount,     color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20"    },
            { icon: Clock,        label: "Awaiting Start", value: awaitingStartCount, color: "text-white/50", bg: "bg-white/5", border: "border-white/10" },
            { icon: AlertTriangle,label: "GPS Issues",  value: gpsLostCount,    color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20"   },
          ].map(({ icon: Icon, label, value, color, bg, border }) => (
            <div key={label} className={`${bg} border ${border} rounded-2xl p-3 flex flex-col gap-1.5`}>
              <div className="flex items-center gap-1.5">
                <Icon className={`w-3.5 h-3.5 ${color}`} />
                <span className={`text-[9px] font-black uppercase tracking-wider ${color}`}>{label}</span>
              </div>
              <span className={`text-2xl font-black ${color}`}>{value}</span>
            </div>
          ))}
        </div>

        {/* Live bus cards */}
        <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-2xl p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full shrink-0 ${filteredActiveEntries.length > 0 ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
            <span className={`text-[10px] font-black uppercase tracking-[0.25em] ${filteredActiveEntries.length > 0 ? "text-emerald-400" : "text-white/30"}`}>
              Live Tracking — {busesLoading ? "…" : `${filteredActiveEntries.length} Bus${filteredActiveEntries.length !== 1 ? "es" : ""} Online`}
            </span>
          </div>
          {filteredActiveEntries.length > 0 ? (
            filteredActiveEntries.map(entry => (
              <LiveBusCard
                key={entry.busId}
                entry={entry}
                buses={buses}
                routes={routes}
                drivers={drivers}
              />
            ))
          ) : (
            <p className="text-white/20 text-xs text-center py-4 font-semibold uppercase tracking-widest">
              {busesLoading ? "Loading…" : "No buses currently active"}
            </p>
          )}
        </div>
      </div>


      {/* â•â• CONDITIONAL TABS: Vehicles OR Drivers â•â• */}
      <div className="flex flex-col gap-5 w-full max-w-3xl mx-auto">

        {/* â”€â”€ FLEET VEHICLES â”€â”€ */}
        {mode === "fleet" && (
          <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
              <Bus className="w-4 h-4 text-white/50" />
            </div>
            <div>
              <h2 className="font-extrabold text-lg tracking-tight">Fleet Vehicles</h2>
              <p className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-black">Manage Bus IDs</p>
            </div>
          </div>

          {/* Add form */}
          <div className="panel-rc p-6 flex flex-col gap-4">
            <p className="text-[9px] text-white/20 font-black uppercase tracking-[0.2em]">Register new vehicle</p>
            <input
              value={newBusId} onChange={(e) => setNewBusId(e.target.value)}
              placeholder="Bus ID (e.g. bus_01)"
              aria-label="New vehicle Bus ID"
              className="w-full h-11 bg-brand-dark/60 border border-white/10 rounded-xl px-3 text-sm text-white focus:border-white/40 outline-none transition-colors placeholder:text-white/20 font-semibold"
            />
            <input
              value={newBusName} onChange={(e) => setNewBusName(e.target.value)}
              placeholder="Display Name (e.g. Red Line Express)"
              aria-label="New vehicle display name"
              className="w-full h-11 bg-brand-dark/60 border border-white/10 rounded-xl px-3 text-sm text-white focus:border-white/40 outline-none transition-colors placeholder:text-white/20 font-semibold"
            />
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-white/30 uppercase tracking-[0.2em] font-black">Assign Allowed Routes</span>
                {newBusRoutes.length > 0 && (
                  <span className="text-[9px] text-white/50 bg-white/10 font-black px-2 py-0.5 rounded-full">
                    {newBusRoutes.length} selected
                  </span>
                )}
              </div>
              <div className="max-h-36 overflow-y-auto bg-brand-dark/60 border border-white/10 rounded-xl p-2 flex flex-col gap-0.5">
                {routes.length === 0
                  ? <p className="text-white/20 text-[10px] text-center py-3 font-semibold">No routes available</p>
                  : routes.map((r) => {
                    const checked = newBusRoutes.includes(r.id);
                    return (
                      <label
                        key={r.id}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${checked ? "bg-white/10" : "hover:bg-white/5"}`}
                      >
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${checked ? "border-white bg-white" : "border-white/20 bg-transparent"}`}>
                          {checked && (
                            <Check className="w-2.5 h-2.5 text-brand-dark" strokeWidth={2.5} />
                          )}
                        </div>
                        <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleRoute(r.id)} />
                        <span className={`text-sm font-semibold ${checked ? "text-white" : "text-white/50"}`}>{r.name}</span>
                      </label>
                    );
                  })
                }
              </div>
            </div>
            <button
              onClick={handleAddBus}
              aria-label="Add new vehicle"
              className="btn-rc-primary h-11 flex items-center justify-center gap-2 font-semibold uppercase text-[11px] tracking-widest px-4"
            >
              <Plus className="w-4 h-4" /> Add Vehicle
            </button>
          </div>

          {/* Saved buses */}
          <div className="panel-rc overflow-hidden">
            <button
              onClick={() => setBusListOpen((o) => !o)}
              aria-label={busListOpen ? "Collapse saved vehicles" : "Expand saved vehicles"}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">Saved Vehicles</span>
                <span className="text-[9px] bg-white/10 text-white/50 font-black px-2 py-0.5 rounded-full">{buses.length}</span>
              </div>
              {busListOpen ? <ChevronUp className="w-3.5 h-3.5 text-white/20" /> : <ChevronDown className="w-3.5 h-3.5 text-white/20" />}
            </button>
            {busListOpen && (
              <div className="px-3 pb-3 flex flex-col gap-2 border-t border-white/5">
                {busesLoading
                  ? <p className="text-white/20 text-xs text-center py-4 font-semibold">Loading…</p>
                  : buses.length === 0
                  ? <p className="text-white/20 text-xs text-center py-4 font-semibold uppercase tracking-widest">No vehicles registered.</p>
                  : buses.map((bus) => {
                    const isOnline = activeBusIds.has(bus.id);
                    const isEditing = editingBusId === bus.id;
                    const liveEntry = activeEntries.find(e => e.busId === bus.id);
                    const ts = liveEntry ? TRIP_STATE_CONFIG[liveEntry.tripState ?? "pre_departure"] : null;

                    return (
                      <div key={bus.id} className="bg-brand-dark/40 border border-white/5 rounded-2xl overflow-hidden">
                        {/* Card header row */}
                        <div className="p-3.5 flex items-center justify-between gap-2 group">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isOnline ? "bg-emerald-500/20" : "bg-white/5"}`}>
                              <Bus className={`w-4 h-4 ${isOnline ? "text-emerald-400" : "text-white/30"}`} />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="font-semibold text-white text-sm truncate">{bus.name}</span>
                              <span className="text-[10px] text-white/30 tabular-nums tracking-widest">{bus.id}</span>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {isOnline && ts ? (
                                  <span className={`text-[9px] font-black uppercase tracking-widest flex items-center gap-1 ${ts.color}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full inline-block ${ts.color.replace("text-","bg-")} ${liveEntry?.motionState === "moving" ? "animate-pulse" : ""}`} />
                                    {ts.label}
                                  </span>
                                ) : (
                                  <span className="text-[9px] text-white/20 font-black uppercase tracking-widest">Offline</span>
                                )}
                                {isOnline && liveEntry?.speed != null && (
                                  <span className="text-[9px] text-white/30 tabular-nums">{Math.round(liveEntry.speed)} km/h</span>
                                )}
                                {bus.assignedRoutes && bus.assignedRoutes.length > 0 ? (
                                  <span className="text-[9px] text-blue-400 font-semibold flex items-center gap-1">
                                    <ArrowRight className="w-2.5 h-2.5" />
                                    {bus.assignedRoutes.length} Route{bus.assignedRoutes.length !== 1 ? "s" : ""}
                                  </span>
                                ) : bus.assignedRouteId ? (
                                  <span className="text-[9px] text-blue-400 font-semibold flex items-center gap-1">
                                    <ArrowRight className="w-2.5 h-2.5" />
                                    {routes.find(r => r.id === bus.assignedRouteId)?.name || bus.assignedRouteId}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => isEditing ? setEditingBusId(null) : startEditBus(bus)}
                              aria-label={isEditing ? "Cancel editing vehicle" : `Edit vehicle ${bus.name}`}
                              className="p-3 rounded-lg text-white/20 hover:text-blue-400 hover:bg-blue-500/10 transition-all"
                            >
                              {isEditing ? <X className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => handleDeleteBus(bus.id)}
                              aria-label={`Delete vehicle ${bus.name}`}
                              className="p-3 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Inline edit panel */}
                        {isEditing && (
                          <div className="border-t border-white/5 px-4 pb-4 pt-3 flex flex-col gap-2.5 bg-brand-dark/30">
                            <p className="text-[9px] text-blue-400 font-black uppercase tracking-[0.2em]">Editing Vehicle</p>
                            <input
                              value={editBusName}
                              onChange={(e) => setEditBusName(e.target.value)}
                              placeholder="Display Name"
                              aria-label="Edit vehicle display name"
                              className="w-full h-11 bg-brand-dark/60 border border-white/10 rounded-xl px-3 text-sm text-white focus:border-blue-400/60 outline-none transition-colors placeholder:text-white/20 font-semibold"
                            />
                            <div className="flex flex-col gap-1">
                              <span className="text-[9px] text-white/30 uppercase tracking-[0.2em] font-black">Assigned Routes</span>
                              <div className="max-h-32 overflow-y-auto bg-brand-dark/60 border border-white/10 rounded-xl p-2 flex flex-col gap-0.5">
                                {routes.length === 0
                                  ? <p className="text-white/20 text-[10px] text-center py-3 font-semibold">No routes available</p>
                                  : routes.map((r) => {
                                    const checked = editBusRoutes.includes(r.id);
                                    return (
                                      <label key={r.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${checked ? "bg-white/10" : "hover:bg-white/5"}`}>
                                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${checked ? "border-white bg-white" : "border-white/20 bg-transparent"}`}>
                                          {checked && <Check className="w-2.5 h-2.5 text-brand-dark" strokeWidth={2.5} />}
                                        </div>
                                        <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleEditRoute(r.id)} />
                                        <span className={`text-sm font-semibold ${checked ? "text-white" : "text-white/50"}`}>{r.name}</span>
                                      </label>
                                    );
                                  })
                                }
                              </div>
                            </div>
                            <button
                              onClick={() => handleSaveBus(bus.id)}
                              aria-label="Save vehicle changes"
                              className="btn-rc-primary h-11 flex items-center justify-center gap-2 font-semibold uppercase text-[11px] tracking-widest px-4"
                            >
                              <Check className="w-4 h-4" /> Save Changes
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Analytics */}
          <RecentTripsPanel routes={routes} buses={buses} drivers={drivers} />
        </div>
        )}

        {/* â”€â”€ DRIVER PERSONNEL â”€â”€ */}
        {mode === "personnel" && (
          <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-white/50" />
            </div>
            <div>
              <h2 className="font-extrabold text-lg tracking-tight">Driver Personnel</h2>
              <p className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-black">Manage Operator IDs</p>
            </div>
          </div>

          {/* Add form */}
          <div className="panel-rc p-6 flex flex-col gap-4">
            <p className="text-[9px] text-white/20 font-black uppercase tracking-[0.2em]">Register new operator</p>
            <input
              value={newDriverId} onChange={(e) => setNewDriverId(e.target.value)}
              placeholder="Operator ID (e.g. drv_1)"
              aria-label="New operator ID"
              className="w-full h-11 bg-brand-dark/60 border border-white/10 rounded-xl px-3 text-sm text-white focus:border-white/40 outline-none transition-colors placeholder:text-white/20 font-semibold"
            />
            <input
              value={newDriverName} onChange={(e) => setNewDriverName(e.target.value)}
              placeholder="Display Name (e.g. Ravi Kumar)"
              aria-label="New operator display name"
              className="w-full h-11 bg-brand-dark/60 border border-white/10 rounded-xl px-3 text-sm text-white focus:border-white/40 outline-none transition-colors placeholder:text-white/20 font-semibold"
            />
            <input
              value={newDriverAuthUid} onChange={(e) => setNewDriverAuthUid(e.target.value)}
              placeholder="Firebase Auth UID"
              aria-label="Firebase Auth UID for new operator"
              className="w-full h-11 bg-brand-dark/60 border border-white/10 rounded-xl px-3 text-sm text-white focus:border-white/40 outline-none transition-colors placeholder:text-white/20 font-semibold"
            />
            <div className="relative">
              <select
                value={newDriverBusId} onChange={(e) => setNewDriverBusId(e.target.value)}
                aria-label="Assign vehicle to new operator"
                className="w-full h-11 bg-brand-dark/60 border border-white/10 rounded-xl px-3 pr-8 text-sm text-white focus:border-white/40 outline-none transition-colors font-semibold appearance-none cursor-pointer"
              >
                <option value="" className="bg-[#1a1c29]">— Assign Vehicle —</option>
                {buses.map((b) => <option key={b.id} value={b.id} className="bg-[#1a1c29]">{b.name} ({b.id})</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
            </div>
            <button
              onClick={handleAddDriver}
              aria-label="Add new operator"
              className="btn-rc-primary h-11 flex items-center justify-center gap-2 font-semibold uppercase text-[11px] tracking-widest px-4"
            >
              <Plus className="w-4 h-4" /> Add Operator
            </button>
          </div>

          {/* Saved drivers */}
          <div className="bg-brand-surface/40 border border-white/5 rounded-[1.5rem] overflow-hidden">
            <button
              onClick={() => setDriverListOpen((o) => !o)}
              aria-label={driverListOpen ? "Collapse saved operators" : "Expand saved operators"}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">Saved Operators</span>
                <span className="text-[9px] bg-white/10 text-white/50 font-black px-2 py-0.5 rounded-full">{drivers.length}</span>
                {liveDrivers.length > 0 && (
                  <span className="text-[9px] bg-emerald-500/20 text-emerald-400 font-black px-2 py-0.5 rounded-full flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                    {liveDrivers.length} Live
                  </span>
                )}
              </div>
              {driverListOpen ? <ChevronUp className="w-3.5 h-3.5 text-white/20" /> : <ChevronDown className="w-3.5 h-3.5 text-white/20" />}
            </button>
            {driverListOpen && (
              <div className="px-3 pb-3 flex flex-col gap-2 border-t border-white/5">
                {driversLoading
                  ? <p className="text-white/20 text-xs text-center py-4 font-semibold">Loading…</p>
                  : drivers.length === 0
                  ? <p className="text-white/20 text-xs text-center py-4 font-semibold uppercase tracking-widest">No operators registered.</p>
                  : drivers.map((driver) => {
                    const assignedBus = buses.find((b) => b.id === driver.assignedBusId);
                    const isDriving = liveDriverIds.has(driver.id);
                    const isEditing = editingDriverId === driver.id;
                    const liveEntry = activeEntries.find(e => e.driverId === driver.id);
                    const dTs = liveEntry ? TRIP_STATE_CONFIG[liveEntry.tripState ?? "pre_departure"] : null;

                    return (
                      <div
                        key={driver.id}
                        className={`border rounded-2xl overflow-hidden transition-all ${isDriving ? "bg-emerald-500/5 border-emerald-500/20" : "bg-brand-dark/40 border-white/5"}`}
                      >
                        {/* Card header row */}
                        <div className="p-3.5 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isDriving ? "bg-emerald-500/20" : "bg-white/5"}`}>
                              <User className={`w-4 h-4 ${isDriving ? "text-emerald-400" : "text-white/30"}`} />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="font-semibold text-white text-sm truncate">{driver.name}</span>
                              <span className="text-[10px] text-white/30 tabular-nums tracking-widest">{driver.id}</span>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {isDriving && dTs ? (
                                  <span className={`text-[9px] font-black uppercase tracking-widest flex items-center gap-1 ${dTs.color}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full inline-block ${dTs.color.replace("text-","bg-")} ${liveEntry?.motionState === "moving" ? "animate-pulse" : ""}`} />
                                    {dTs.label}
                                  </span>
                                ) : (
                                  <span className="text-[9px] text-white/20 font-black uppercase tracking-widest">Offline</span>
                                )}
                                {isDriving && liveEntry?.speed != null && (
                                  <span className="text-[9px] text-white/30 tabular-nums">{Math.round(liveEntry.speed)} km/h</span>
                                )}
                                {assignedBus && (
                                  <span className="text-[9px] text-blue-400 font-semibold flex items-center gap-1">
                                    <ArrowRight className="w-2.5 h-2.5" /> {assignedBus.name}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => isEditing ? setEditingDriverId(null) : startEditDriver(driver)}
                              aria-label={isEditing ? "Cancel editing operator" : `Edit operator ${driver.name}`}
                              className="p-3 rounded-lg text-white/20 hover:text-blue-400 hover:bg-blue-500/10 transition-all"
                            >
                              {isEditing ? <X className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => handleDeleteDriver(driver.id)}
                              aria-label={`Delete operator ${driver.name}`}
                              className="p-3 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Inline edit panel */}
                        {isEditing && (
                          <div className="border-t border-white/5 px-4 pb-4 pt-3 flex flex-col gap-2.5 bg-brand-dark/30">
                            <p className="text-[9px] text-blue-400 font-black uppercase tracking-[0.2em]">Editing Operator</p>
                            <input
                              value={editDriverName}
                              onChange={(e) => setEditDriverName(e.target.value)}
                              placeholder="Display Name"
                              aria-label="Edit operator display name"
                              className="w-full h-11 bg-brand-dark/60 border border-white/10 rounded-xl px-3 text-sm text-white focus:border-blue-400/60 outline-none transition-colors placeholder:text-white/20 font-semibold"
                            />
                            <input
                              value={editDriverAuthUid}
                              onChange={(e) => setEditDriverAuthUid(e.target.value)}
                              placeholder="Firebase Auth UID"
                              aria-label="Firebase Auth UID for operator"
                              className="w-full h-11 bg-brand-dark/60 border border-white/10 rounded-xl px-3 text-sm text-white focus:border-white/40 outline-none transition-colors placeholder:text-white/20 font-semibold"
                            />
                            <div className="relative">
                              <select
                                value={editDriverBusId}
                                onChange={(e) => setEditDriverBusId(e.target.value)}
                                aria-label="Edit assigned vehicle"
                                className="w-full h-11 bg-brand-dark/60 border border-white/10 rounded-xl px-3 pr-8 text-sm text-white focus:border-blue-400/60 outline-none transition-colors font-semibold appearance-none cursor-pointer"
                              >
                                <option value="" className="bg-[#1a1c29]">— Unassign Vehicle —</option>
                                {buses.map((b) => <option key={b.id} value={b.id} className="bg-[#1a1c29]">{b.name} ({b.id})</option>)}
                              </select>
                              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
                            </div>
                            <button
                              onClick={() => handleSaveDriver(driver.id)}
                              aria-label="Save operator changes"
                              className="h-11 bg-blue-500 text-white rounded-xl font-black uppercase text-xs tracking-widest shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
                            >
                              <Check className="w-4 h-4" /> Save Changes
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
