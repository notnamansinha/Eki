"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Map as GoogleMap, AdvancedMarker, useMap,
} from "@vis.gl/react-google-maps";
import { ref, onValue, update, remove } from "firebase/database";
import { onAuthStateChanged } from "firebase/auth";
import { rtdb, auth } from "@/lib/firebase";
import { useBuses } from "@/hooks/useBuses";
import { useDrivers } from "@/hooks/useDrivers";
import { useRoutes } from "@/hooks/useRoutes";
import { MAP_OPTIONS, MAPS_MAP_ID, DEFAULT_CENTER } from "@/config/maps";
import {
  Activity, Navigation, Clock, MapPin, AlertTriangle,
  TrendingUp, X, ChevronDown, ChevronUp,
  Sliders, Wifi, WifiOff, Loader2, Radio, Target,
} from "lucide-react";

/* ── Types ─────────────────────────────────────────────────────────────────── */
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
  tripState?: "pre_departure" | "in_service" | "completed" | "maintenance";
  currentStopIndex?: number;
  delayMinutes?: number;
  lowAccuracy?: boolean;
}

/* ── Config ─────────────────────────────────────────────────────────────────── */
const TRIP_STATE: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  pre_departure: { label: "At Depot",   color: "text-white/40",    bg: "bg-white/5",        dot: "bg-white/30" },
  in_service:    { label: "In Service", color: "text-emerald-400", bg: "bg-emerald-500/10", dot: "bg-emerald-400" },
  completed:     { label: "Completed",  color: "text-blue-400",    bg: "bg-blue-500/10",    dot: "bg-blue-400" },
  maintenance:   { label: "GPS Lost",   color: "text-amber-400",   bg: "bg-amber-500/10",   dot: "bg-amber-400" },
};
const MOTION_STATE: Record<string, { label: string; color: string }> = {
  moving:    { label: "Moving",  color: "text-emerald-400" },
  stopped:   { label: "Stopped", color: "text-amber-400" },
  uncertain: { label: "No GPS",  color: "text-red-400" },
};

function timeSince(t?: string | number): string {
  if (!t) return "—";
  const ms = typeof t === "number" ? Date.now() - t : Date.now() - new Date(t).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}
function headingLabel(d?: number): string {
  if (d == null) return "—";
  const dirs = ["N","NE","E","SE","S","SW","W","NW","N"];
  return dirs[Math.round(d / 45) % 8] + ` ${Math.round(d)}°`;
}

/* ── Live bus hook ──────────────────────────────────────────────────────────── */
function useActiveBuses(): ActiveBusEntry[] {
  const [active, setActive] = useState<ActiveBusEntry[]>([]);
  useEffect(() => {
    let unsub: (() => void) | undefined;
    const authUnsub = onAuthStateChanged(auth, (user) => {
      if (user && !unsub) {
        unsub = onValue(ref(rtdb, "activeBuses"), (snap) => {
          const data = snap.val() as Record<string, ActiveBusEntry> | null;
          if (!data) {
            setActive([]);
            return;
          }
          const freshBuses: ActiveBusEntry[] = [];
          Object.entries(data).forEach(([key, bus]) => {
            bus.busId = bus.busId || key.split("_")[0];
            const isFresh = bus.timestamp && (Date.now() - bus.timestamp < 300_000);
            if (isFresh) freshBuses.push(bus);
          });
          setActive(freshBuses);
        }, (err) => console.warn("[RTDB] activeBuses:", err.message));
      }
    });
    return () => { authUnsub(); unsub?.(); };
  }, []);
  return active;
}

/* ── Map centering helper ───────────────────────────────────────────────────── */
function MapCenter({ center }: { center: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (center && map) { map.panTo(center); map.setZoom(15); }
  }, [center, map]);
  return null;
}

/* ── Override Drawer ────────────────────────────────────────────────────────── */
function OverrideDrawer({
  entry,
  routeName,
  stopCount,
  onClose,
}: {
  entry: ActiveBusEntry;
  routeName: string;
  stopCount: number;
  onClose: () => void;
}) {
  const [lat, setLat] = useState(String(entry.lat ?? ""));
  const [lng, setLng] = useState(String(entry.lng ?? ""));
  const [delay, setDelay] = useState(String(entry.delayMinutes ?? 0));
  const [stopIdx, setStopIdx] = useState(String(entry.currentStopIndex ?? 0));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const rtdbKey = entry.routeId ? `${entry.busId}_${entry.routeId}` : entry.busId;

  const handleSave = async () => {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = { timestamp: Date.now() };
      if (lat && lng) { patch.lat = parseFloat(lat); patch.lng = parseFloat(lng); }
      if (delay !== "") patch.delayMinutes = parseInt(delay, 10);
      if (stopIdx !== "") patch.currentStopIndex = parseInt(stopIdx, 10);
      await update(ref(rtdb, `activeBuses/${rtdbKey}`), patch);
      setMsg("Saved ✓");
      setTimeout(() => setMsg(""), 2000);
    } catch (e: any) { setMsg("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const handleForceOffline = async () => {
    if (!confirm(`Force ${entry.busId} offline? This will remove it from the passenger map.`)) return;
    try {
      await update(ref(rtdb, `activeBuses/${rtdbKey}`), {
        deviceState: "offline",
        tripState: "completed",
        timestamp: Date.now(),
      });
      onClose();
    } catch (e: any) { alert("Error: " + (e as any).message); }
  };

  const handleWipeMessages = async () => {
    if (!confirm(`Clear all messages for ${entry.busId}?`)) return;
    try { await remove(ref(rtdb, `messages/${entry.busId}`)); setMsg("Messages cleared ✓"); setTimeout(() => setMsg(""), 2000); }
    catch (e: any) { setMsg("Error: " + (e as any).message); }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md bg-[#0f0f12] border border-white/10 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden animate-slide-up">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/5">
          <div>
            <p className="text-[10px] text-white/30 uppercase tracking-widest font-black">Live Override</p>
            <p className="font-bold text-white">{entry.busId}</p>
            <p className="text-xs text-white/40">{routeName}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
          {/* Position override */}
          <div className="flex flex-col gap-2">
            <p className="text-[10px] text-white/30 uppercase tracking-widest font-black flex items-center gap-1.5"><MapPin className="w-3 h-3" /> Position Override</p>
            <div className="grid grid-cols-2 gap-2">
              <input value={lat} onChange={e => setLat(e.target.value)} placeholder="Latitude" className="input-rc h-10 text-sm" />
              <input value={lng} onChange={e => setLng(e.target.value)} placeholder="Longitude" className="input-rc h-10 text-sm" />
            </div>
          </div>

          {/* Delay */}
          <div className="flex flex-col gap-2">
            <p className="text-[10px] text-white/30 uppercase tracking-widest font-black flex items-center gap-1.5"><Clock className="w-3 h-3" /> Delay (minutes)</p>
            <input value={delay} onChange={e => setDelay(e.target.value)} type="number" min="0" className="input-rc h-10 text-sm" />
          </div>

          {/* Stop index */}
          {stopCount > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-black flex items-center gap-1.5"><Navigation className="w-3 h-3" /> Stop Index (0–{stopCount - 1})</p>
              <input value={stopIdx} onChange={e => setStopIdx(e.target.value)} type="number" min="0" max={stopCount - 1} className="input-rc h-10 text-sm" />
            </div>
          )}

          {msg && <p className="text-xs text-emerald-400 font-semibold">{msg}</p>}

          {/* Actions */}
          <button onClick={handleSave} disabled={saving} className="btn-rc-primary h-11 flex items-center justify-center gap-2 font-semibold">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
            Apply Override
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={handleForceOffline} className="h-10 flex items-center justify-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-colors">
              <WifiOff className="w-3.5 h-3.5" /> Force Offline
            </button>
            <button onClick={handleWipeMessages} className="h-10 flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-colors">
              <Radio className="w-3.5 h-3.5" /> Wipe Messages
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Live bus map marker ────────────────────────────────────────────────────── */
function BusMarker({ entry, onClick }: { entry: ActiveBusEntry; onClick: () => void }) {
  const ts = TRIP_STATE[entry.tripState ?? "pre_departure"] ?? TRIP_STATE.pre_departure;
  const markerColor =
    entry.tripState === "in_service"
      ? entry.motionState === "moving" ? "#34D399" : "#FBBF24"
      : entry.tripState === "maintenance" ? "#FB923C" : "#94949C";

  if (!entry.lat || !entry.lng) return null;
  return (
    <AdvancedMarker position={{ lat: entry.lat, lng: entry.lng }} onClick={onClick}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer" }} title={`${entry.busId} — ${ts.label}`}>
        <div style={{
          width: 36, height: 36, borderRadius: 18,
          background: markerColor, border: "3px solid #09090b",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: `0 0 0 2px ${markerColor}40, 0 4px 12px rgba(0,0,0,0.5)`,
        }}>
          <Navigation style={{ width: 16, height: 16, color: "#09090b", transform: `rotate(${entry.heading ?? 0}deg)` }} />
        </div>
        <div style={{
          marginTop: 4, padding: "2px 6px", borderRadius: 5,
          background: "rgba(9,9,11,0.9)", border: "1px solid rgba(255,255,255,0.1)",
          color: "white", fontSize: 9, whiteSpace: "nowrap", fontWeight: 700,
          letterSpacing: "0.08em",
        }}>{entry.busId}</div>
      </div>
    </AdvancedMarker>
  );
}

/* ── Fleet card ─────────────────────────────────────────────────────────────── */
function FleetCard({
  entry, buses, routes, drivers,
  onSelect, selected,
}: {
  entry: ActiveBusEntry;
  buses: ReturnType<typeof useBuses>["buses"];
  routes: ReturnType<typeof useRoutes>["routes"];
  drivers: ReturnType<typeof useDrivers>["drivers"];
  onSelect: () => void;
  selected: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const bus = buses.find(b => b.id === entry.busId);
  const route = routes.find(r => r.id === entry.routeId);
  const driver = drivers.find(d => d.id === entry.driverId);
  const ts = TRIP_STATE[entry.tripState ?? "pre_departure"] ?? TRIP_STATE.pre_departure;
  const ms = MOTION_STATE[entry.motionState ?? "uncertain"] ?? MOTION_STATE.uncertain;
  const stopIdx = (entry.currentStopIndex ?? 0) + 1;
  const stopCount = route?.stops?.length ?? 0;

  return (
    <>
      {overrideOpen && (
        <OverrideDrawer
          entry={entry}
          routeName={route?.name ?? entry.routeId ?? "—"}
          stopCount={stopCount}
          onClose={() => setOverrideOpen(false)}
        />
      )}
      <div
        className={`border rounded-xl overflow-hidden transition-all ${
          selected ? "border-brand-accent/40 bg-brand-accent/5" : "border-white/8 bg-white/3 hover:border-white/15"
        }`}
      >
        <button
          onClick={() => { setExpanded(o => !o); onSelect(); }}
          className="w-full p-3 flex items-center gap-3 text-left"
        >
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${ts.bg}`}>
            <span className={`w-2 h-2 rounded-full ${ts.dot} ${entry.motionState === "moving" ? "animate-pulse" : ""}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white text-sm truncate">{bus?.name ?? entry.busId}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className={`text-[9px] font-black uppercase tracking-wider ${ts.color}`}>{ts.label}</span>
              <span className={`text-[9px] font-semibold ${ms.color}`}>{ms.label}</span>
              {entry.speed != null && <span className="text-[9px] text-white/30 tabular-nums">{Math.round(entry.speed)} km/h</span>}
              {(entry.delayMinutes ?? 0) > 0 && (
                <span className="text-[9px] text-amber-400 font-black">+{entry.delayMinutes}m delay</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={e => { e.stopPropagation(); setOverrideOpen(true); }}
              className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-brand-accent/20 hover:text-brand-accent transition-colors"
              title="Override"
            >
              <Sliders className="w-3.5 h-3.5 text-white/40" />
            </button>
            {expanded ? <ChevronUp className="w-3.5 h-3.5 text-white/30" /> : <ChevronDown className="w-3.5 h-3.5 text-white/30" />}
          </div>
        </button>

        {expanded && (
          <div className="border-t border-white/5 p-3 flex flex-col gap-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Speed", value: entry.speed != null ? `${Math.round(entry.speed)} km/h` : "—" },
                { label: "Heading", value: headingLabel(entry.heading) },
                { label: "Last Update", value: timeSince(entry.timestamp) },
                { label: "Stop", value: stopCount > 0 ? `${stopIdx}/${stopCount}` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white/3 border border-white/5 rounded-lg p-2 flex flex-col gap-0.5">
                  <span className="text-[8px] font-black uppercase tracking-wider text-white/25">{label}</span>
                  <span className="text-xs font-semibold text-white tabular-nums">{value}</span>
                </div>
              ))}
            </div>
            {stopCount > 0 && entry.tripState === "in_service" && (
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-[8px] font-black uppercase tracking-wider text-white/25">Route Progress</span>
                  <span className="text-[9px] text-white/30 tabular-nums">{stopIdx}/{stopCount} stops</span>
                </div>
                <div className="h-1 bg-white/5 rounded-full">
                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.round((stopIdx / stopCount) * 100)}%` }} />
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {route?.stops?.[entry.currentStopIndex ?? 0] && (
                    <div>
                      <span className="text-[8px] text-white/25 uppercase font-black">Current Stop</span>
                      <p className="text-[10px] font-semibold text-white truncate">{route.stops[entry.currentStopIndex ?? 0].name}</p>
                    </div>
                  )}
                  {route?.stops?.[(entry.currentStopIndex ?? 0) + 1] && (
                    <div>
                      <span className="text-[8px] text-white/25 uppercase font-black">Next Stop</span>
                      <p className="text-[10px] font-semibold text-white/60 truncate">{route.stops[(entry.currentStopIndex ?? 0) + 1].name}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/5">
              <div>
                <span className="text-[8px] font-black uppercase tracking-wider text-white/25">Driver</span>
                <p className="text-[10px] font-semibold text-white truncate">{driver?.name ?? entry.driverId ?? "—"}</p>
              </div>
              <div>
                <span className="text-[8px] font-black uppercase tracking-wider text-white/25">Route</span>
                <p className="text-[10px] font-semibold text-white truncate">{route?.name ?? entry.routeId ?? "—"}</p>
              </div>
            </div>
            {entry.lat && entry.lng && (
              <p className="text-[9px] text-white/20 tabular-nums">
                {entry.lat.toFixed(5)}, {entry.lng.toFixed(5)}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/* ── Main Dashboard ─────────────────────────────────────────────────────────── */
export default function DashboardPanel() {
  const activeEntries = useActiveBuses();
  const { buses } = useBuses();
  const { drivers } = useDrivers();
  const { routes } = useRoutes();
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);

  const inService  = activeEntries.filter(e => e.tripState === "in_service").length;
  const moving     = activeEntries.filter(e => e.motionState === "moving").length;
  const gpsLost    = activeEntries.filter(e => e.tripState === "maintenance").length;
  const atDepot    = activeEntries.filter(e => e.tripState === "pre_departure").length;

  const handleSelectBus = useCallback((entry: ActiveBusEntry) => {
    setSelectedBusId(prev => prev === entry.busId ? null : entry.busId);
    if (entry.lat && entry.lng) setMapCenter({ lat: entry.lat, lng: entry.lng });
  }, []);

  return (
    <div className="flex flex-col lg:flex-row w-full" style={{ height: "calc(100vh - 88px)" }}>
      {/* ── Map ── */}
      <div className="flex-1 relative min-h-[300px] lg:min-h-0">
        <GoogleMap
          mapId={MAPS_MAP_ID}
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={12}
          style={{ width: "100%", height: "100%" }}
          {...MAP_OPTIONS}
        >
          <MapCenter center={mapCenter} />
          {activeEntries.map(entry => (
            <BusMarker
              key={`${entry.busId}_${entry.routeId}`}
              entry={entry}
              onClick={() => handleSelectBus(entry)}
            />
          ))}
        </GoogleMap>

        {/* Map overlay stats */}
        <div className="absolute top-3 left-3 flex flex-col gap-2 pointer-events-none">
          <div className="flex items-center gap-2 bg-[#09090b]/90 backdrop-blur-sm border border-white/10 rounded-xl px-3 py-2">
            <span className={`w-2 h-2 rounded-full ${activeEntries.length > 0 ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
            <span className="text-[10px] font-black uppercase tracking-widest text-white/70">
              {activeEntries.length} Bus{activeEntries.length !== 1 ? "es" : ""} Live
            </span>
          </div>
        </div>
      </div>

      {/* ── Sidebar ── */}
      <div className="w-full lg:w-[360px] shrink-0 flex flex-col border-t lg:border-t-0 lg:border-l border-white/5 overflow-hidden">
        {/* Stats row */}
        <div className="grid grid-cols-4 border-b border-white/5 shrink-0">
          {[
            { label: "In Service", value: inService,  color: "text-emerald-400", Icon: Activity },
            { label: "Moving",     value: moving,     color: "text-blue-400",    Icon: TrendingUp },
            { label: "At Depot",   value: atDepot,    color: "text-white/40",    Icon: Clock },
            { label: "GPS Lost",   value: gpsLost,    color: "text-amber-400",   Icon: AlertTriangle },
          ].map(({ label, value, color, Icon }) => (
            <div key={label} className="flex flex-col items-center justify-center gap-0.5 py-3 border-r border-white/5 last:border-0">
              <Icon className={`w-3 h-3 ${color}`} />
              <span className={`text-lg font-black tabular-nums ${color}`}>{value}</span>
              <span className="text-[8px] font-black uppercase tracking-wide text-white/25">{label}</span>
            </div>
          ))}
        </div>

        {/* Fleet list */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          <p className="text-[9px] font-black uppercase tracking-[0.25em] text-white/25 px-1">Live Fleet</p>
          {activeEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center opacity-30 gap-2">
              <Wifi className="w-8 h-8" />
              <p className="text-xs font-semibold uppercase tracking-widest">No buses active</p>
            </div>
          ) : (
            activeEntries.map(entry => (
              <FleetCard
                key={`${entry.busId}_${entry.routeId}`}
                entry={entry}
                buses={buses}
                routes={routes}
                drivers={drivers}
                selected={selectedBusId === entry.busId}
                onSelect={() => handleSelectBus(entry)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
