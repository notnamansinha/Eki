"use client";

import { useState, useEffect } from "react";
import { useBuses, BusData } from "@/hooks/useBuses";
import { useDrivers, DriverData } from "@/hooks/useDrivers";
import { useRoutes } from "@/hooks/useRoutes";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { db, rtdb } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import {
  Bus, User, Trash2, Plus, ArrowRight,
  ChevronDown, ChevronUp, Wifi, Pencil, Check, X, AlertCircle,
} from "lucide-react";

// ── Live bus tracking ─────────────────────────────────────────────────────────
interface ActiveBusEntry {
  busId: string;
  driverId?: string;
  routeId?: string;
  lat?: number;
  lng?: number;
  speed?: number;
}

function useActiveBuses(): ActiveBusEntry[] {
  const [active, setActive] = useState<ActiveBusEntry[]>([]);
  useEffect(() => {
    const r = ref(rtdb, "activeBuses");
    const unsub = onValue(r, (snap) => {
      const data = snap.val() as Record<string, ActiveBusEntry> | null;
      setActive(data ? Object.values(data) : []);
    });
    return () => unsub();
  }, []);
  return active;
}

// ── Inline error banner ───────────────────────────────────────────────────────
function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl px-3 py-2 text-xs font-bold animate-slide-up">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss error" className="shrink-0 hover:text-white transition-colors">
        <X className="w-3.5 h-3.5" />
      </button>
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
  const activeBusIds = new Set(activeEntries.map((e) => e.busId));

  // ── Error state ───────────────────────────────────────────────────────────
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Bus add form ──────────────────────────────────────────────────────────
  const [newBusId, setNewBusId] = useState("");
  const [newBusName, setNewBusName] = useState("");
  const [newBusRoutes, setNewBusRoutes] = useState<string[]>([]);
  const [busListOpen, setBusListOpen] = useState(true);

  // ── Bus inline edit ───────────────────────────────────────────────────────
  const [editingBusId, setEditingBusId] = useState<string | null>(null);
  const [editBusName, setEditBusName] = useState("");
  const [editBusRoutes, setEditBusRoutes] = useState<string[]>([]);

  // ── Driver add form ───────────────────────────────────────────────────────
  const [newDriverId, setNewDriverId] = useState("");
  const [newDriverName, setNewDriverName] = useState("");
  const [newDriverBusId, setNewDriverBusId] = useState("");
  const [driverListOpen, setDriverListOpen] = useState(true);

  // ── Driver inline edit ────────────────────────────────────────────────────
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [editDriverName, setEditDriverName] = useState("");
  const [editDriverBusId, setEditDriverBusId] = useState("");

  // ── Route togglers ────────────────────────────────────────────────────────
  const toggleRoute = (id: string) =>
    setNewBusRoutes((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );

  const toggleEditRoute = (id: string) =>
    setEditBusRoutes((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );

  // ── Bus CRUD ──────────────────────────────────────────────────────────────
  const handleAddBus = async () => {
    if (!newBusId || !newBusName) return;
    try {
      await setDoc(doc(db, "buses", newBusId), {
        id: newBusId,
        name: newBusName,
        assignedRoutes: newBusRoutes,
      } as BusData);
      setNewBusId(""); setNewBusName(""); setNewBusRoutes([]);
    } catch (e: any) { setErrorMsg("Failed to add Vehicle: " + e.message); }
  };

  const handleDeleteBus = async (id: string) => {
    if (!confirm("Delete this vehicle? This cannot be undone.")) return;
    try { await deleteDoc(doc(db, "buses", id)); }
    catch (e: any) { setErrorMsg("Failed to delete Vehicle: " + e.message); }
  };

  const startEditBus = (bus: BusData) => {
    setEditingBusId(bus.id);
    setEditBusName(bus.name);
    setEditBusRoutes(bus.assignedRoutes ?? []);
    setEditingDriverId(null); // close any open driver editor
  };

  const handleSaveBus = async (id: string) => {
    try {
      await setDoc(doc(db, "buses", id), {
        id,
        name: editBusName,
        assignedRoutes: editBusRoutes,
      } as BusData);
      setEditingBusId(null);
    } catch (e: any) { setErrorMsg("Failed to update Vehicle: " + e.message); }
  };

  // ── Driver CRUD ───────────────────────────────────────────────────────────
  const handleAddDriver = async () => {
    if (!newDriverId || !newDriverName) return;
    try {
      await setDoc(doc(db, "drivers", newDriverId), {
        id: newDriverId,
        name: newDriverName,
        assignedBusId: newDriverBusId || null,
      } as DriverData);
      setNewDriverId(""); setNewDriverName(""); setNewDriverBusId("");
    } catch (e: any) { setErrorMsg("Failed to add Operator: " + e.message); }
  };

  const handleDeleteDriver = async (id: string) => {
    if (!confirm("Delete this operator? This cannot be undone.")) return;
    try { await deleteDoc(doc(db, "drivers", id)); }
    catch (e: any) { setErrorMsg("Failed to delete Operator: " + e.message); }
  };

  const startEditDriver = (driver: DriverData) => {
    setEditingDriverId(driver.id);
    setEditDriverName(driver.name);
    setEditDriverBusId(driver.assignedBusId ?? "");
    setEditingBusId(null); // close any open bus editor
  };

  const handleSaveDriver = async (id: string) => {
    try {
      await setDoc(doc(db, "drivers", id), {
        id,
        name: editDriverName,
        assignedBusId: editDriverBusId || null,
      } as DriverData);
      setEditingDriverId(null);
    } catch (e: any) { setErrorMsg("Failed to update Operator: " + e.message); }
  };

  // Live drivers = drivers whose ID appears in the active tracking feed
  const liveDriverIds = new Set(activeEntries.map((e) => e.driverId).filter(Boolean));
  const liveDrivers = drivers.filter((d) => liveDriverIds.has(d.id));

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col gap-5 p-3 md:p-6 animate-slide-up">

      {/* ── Global error banner ── */}
      {errorMsg && (
        <ErrorBanner message={errorMsg} onDismiss={() => setErrorMsg(null)} />
      )}

      {/* ══ LIVE NOW banner (only when someone is online) ══ */}
      {liveDrivers.length > 0 && (
        <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-400">
              Live Now — {liveDrivers.length} Driver{liveDrivers.length !== 1 ? "s" : ""} Online
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {liveDrivers.map((d) => {
              const entry = activeEntries.find((e) => e.driverId === d.id);
              if (!entry) return null;
              const bus = buses.find((b) => b.id === entry.busId);
              const route = routes.find((r) => r.id === entry.routeId);
              return (
                <div
                  key={d.id}
                  className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2"
                >
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                    <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-white leading-tight">{d.name}</span>
                    <span className="text-[9px] text-emerald-400/70 font-mono">
                      {bus?.name || entry.busId}
                      {route ? ` · ${route.name}` : ""}
                      {entry.speed != null ? ` · ${Math.round(entry.speed)} km/h` : ""}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══ CONDITIONAL TABS: Vehicles OR Drivers ══ */}
      <div className="flex flex-col gap-5 w-full max-w-3xl mx-auto">

        {/* ── FLEET VEHICLES ── */}
        {mode === "fleet" && (
          <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
              <Bus className="w-4 h-4 text-white/40" />
            </div>
            <div>
              <h2 className="font-bold text-lg tracking-tight" style={{ fontFamily: "Outfit" }}>Fleet Vehicles</h2>
              <p className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-black">Manage Hardware IDs</p>
            </div>
          </div>

          {/* Add form */}
          <div className="bg-brand-surface/40 border border-white/5 rounded-[1.5rem] p-4 flex flex-col gap-2.5">
            <p className="text-[9px] text-white/20 font-black uppercase tracking-[0.2em]">Register new vehicle</p>
            <input
              value={newBusId} onChange={(e) => setNewBusId(e.target.value)}
              placeholder="Hardware ID (e.g. BRTS-101)"
              aria-label="New vehicle hardware ID"
              className="w-full h-10 bg-brand-dark/60 border border-white/10 rounded-xl px-3 text-sm text-white focus:border-white/40 outline-none transition-colors placeholder:text-white/20 font-bold"
            />
            <input
              value={newBusName} onChange={(e) => setNewBusName(e.target.value)}
              placeholder="Display Name (e.g. Red Line Express)"
              aria-label="New vehicle display name"
              className="w-full h-10 bg-brand-dark/60 border border-white/10 rounded-xl px-3 text-sm text-white focus:border-white/40 outline-none transition-colors placeholder:text-white/20 font-bold"
            />
            {/* ── Multi-select route checkboxes ── */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-white/30 uppercase tracking-[0.2em] font-black">
                  Assign Allowed Routes
                </span>
                {newBusRoutes.length > 0 && (
                  <span className="text-[9px] text-white/40 bg-white/10 font-black px-2 py-0.5 rounded-full">
                    {newBusRoutes.length} selected
                  </span>
                )}
              </div>
              <div className="max-h-36 overflow-y-auto bg-brand-dark/60 border border-white/10 rounded-xl p-2 flex flex-col gap-0.5">
                {routes.length === 0
                  ? <p className="text-white/20 text-[10px] text-center py-3 font-bold">No routes available</p>
                  : routes.map((r) => {
                    const checked = newBusRoutes.includes(r.id);
                    return (
                      <label
                        key={r.id}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${checked ? "bg-white/10" : "hover:bg-white/5"}`}
                      >
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${checked ? "border-white bg-white" : "border-white/20 bg-transparent"}`}>
                          {checked && (
                            <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-brand-dark" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M2 6l3 3 5-5" />
                            </svg>
                          )}
                        </div>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={() => toggleRoute(r.id)}
                        />
                        <span className={`text-sm font-bold ${checked ? "text-white" : "text-white/50"}`}>{r.name}</span>
                      </label>
                    );
                  })
                }
              </div>
            </div>
            <button
              onClick={handleAddBus}
              aria-label="Add new vehicle"
              className="h-10 bg-white text-brand-dark rounded-xl font-black uppercase text-xs tracking-widest shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add Vehicle
            </button>
          </div>

          {/* Saved buses */}
          <div className="bg-brand-surface/40 border border-white/5 rounded-[1.5rem] overflow-hidden">
            <button
              onClick={() => setBusListOpen((o) => !o)}
              aria-label={busListOpen ? "Collapse saved vehicles" : "Expand saved vehicles"}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Saved Vehicles</span>
                <span className="text-[9px] bg-white/10 text-white/40 font-black px-2 py-0.5 rounded-full">{buses.length}</span>
              </div>
              {busListOpen ? <ChevronUp className="w-3.5 h-3.5 text-white/20" /> : <ChevronDown className="w-3.5 h-3.5 text-white/20" />}
            </button>
            {busListOpen && (
              <div className="px-3 pb-3 flex flex-col gap-2 border-t border-white/5">
                {busesLoading
                  ? <p className="text-white/20 text-xs text-center py-4 font-bold">Loading…</p>
                  : buses.length === 0
                  ? <p className="text-white/20 text-xs text-center py-4 font-bold uppercase tracking-widest">No vehicles registered.</p>
                  : buses.map((bus) => {
                    const isOnline = activeBusIds.has(bus.id);
                    const isEditing = editingBusId === bus.id;

                    return (
                      <div key={bus.id} className="bg-brand-dark/40 border border-white/5 rounded-2xl overflow-hidden">
                        {/* Card header row */}
                        <div className="p-3.5 flex items-center justify-between gap-2 group">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isOnline ? "bg-emerald-500/20" : "bg-white/5"}`}>
                              <Bus className={`w-4 h-4 ${isOnline ? "text-emerald-400" : "text-white/30"}`} />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="font-bold text-white text-sm truncate">{bus.name}</span>
                              <span className="text-[10px] text-white/30 font-mono tracking-widest">{bus.id}</span>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {isOnline && (
                                  <span className="text-[9px] text-emerald-400 font-black uppercase tracking-widest flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" /> Online
                                  </span>
                                )}
                                {bus.assignedRoutes && bus.assignedRoutes.length > 0 ? (
                                  <span className="text-[9px] text-blue-400 font-bold flex items-center gap-1">
                                    <ArrowRight className="w-2.5 h-2.5" />
                                    {bus.assignedRoutes.length} Route{bus.assignedRoutes.length !== 1 ? "s" : ""}
                                  </span>
                                ) : (bus as any).assignedRouteId ? (
                                  <span className="text-[9px] text-blue-400 font-bold flex items-center gap-1">
                                    <ArrowRight className="w-2.5 h-2.5" />
                                    {routes.find(r => r.id === (bus as any).assignedRouteId)?.name || (bus as any).assignedRouteId}
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
                              className="w-full h-10 bg-brand-dark/60 border border-white/10 rounded-xl px-3 text-sm text-white focus:border-blue-400/60 outline-none transition-colors placeholder:text-white/20 font-bold"
                            />
                            <div className="flex flex-col gap-1">
                              <span className="text-[9px] text-white/30 uppercase tracking-[0.2em] font-black">Assigned Routes</span>
                              <div className="max-h-32 overflow-y-auto bg-brand-dark/60 border border-white/10 rounded-xl p-2 flex flex-col gap-0.5">
                                {routes.length === 0
                                  ? <p className="text-white/20 text-[10px] text-center py-3 font-bold">No routes available</p>
                                  : routes.map((r) => {
                                    const checked = editBusRoutes.includes(r.id);
                                    return (
                                      <label key={r.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${checked ? "bg-white/10" : "hover:bg-white/5"}`}>
                                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${checked ? "border-white bg-white" : "border-white/20 bg-transparent"}`}>
                                          {checked && <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-brand-dark" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M2 6l3 3 5-5" /></svg>}
                                        </div>
                                        <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleEditRoute(r.id)} />
                                        <span className={`text-sm font-bold ${checked ? "text-white" : "text-white/50"}`}>{r.name}</span>
                                      </label>
                                    );
                                  })
                                }
                              </div>
                            </div>
                            <button
                              onClick={() => handleSaveBus(bus.id)}
                              aria-label="Save vehicle changes"
                              className="h-9 bg-blue-500 text-white rounded-xl font-black uppercase text-xs tracking-widest shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
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

        {/* ── DRIVER PERSONNEL ── */}
        {mode === "personnel" && (
          <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-white/40" />
            </div>
            <div>
              <h2 className="font-bold text-lg tracking-tight" style={{ fontFamily: "Outfit" }}>Driver Personnel</h2>
              <p className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-black">Manage Operator IDs</p>
            </div>
          </div>

          {/* Add form */}
          <div className="bg-brand-surface/40 border border-white/5 rounded-[1.5rem] p-4 flex flex-col gap-2.5">
            <p className="text-[9px] text-white/20 font-black uppercase tracking-[0.2em]">Register new operator</p>
            <input
              value={newDriverId} onChange={(e) => setNewDriverId(e.target.value)}
              placeholder="Operator ID (e.g. drv_1)"
              aria-label="New operator ID"
              className="w-full h-10 bg-brand-dark/60 border border-white/10 rounded-xl px-3 text-sm text-white focus:border-white/40 outline-none transition-colors placeholder:text-white/20 font-bold"
            />
            <input
              value={newDriverName} onChange={(e) => setNewDriverName(e.target.value)}
              placeholder="Display Name (e.g. Ravi Kumar)"
              aria-label="New operator display name"
              className="w-full h-10 bg-brand-dark/60 border border-white/10 rounded-xl px-3 text-sm text-white focus:border-white/40 outline-none transition-colors placeholder:text-white/20 font-bold"
            />
            <div className="relative">
              <select
                value={newDriverBusId} onChange={(e) => setNewDriverBusId(e.target.value)}
                aria-label="Assign vehicle to new operator"
                className="w-full h-10 bg-brand-dark/60 border border-white/10 rounded-xl px-3 pr-8 text-sm text-white focus:border-white/40 outline-none transition-colors font-bold appearance-none cursor-pointer"
              >
                <option value="" className="bg-[#1a1c29]">— Assign Vehicle —</option>
                {buses.map((b) => <option key={b.id} value={b.id} className="bg-[#1a1c29]">{b.name} ({b.id})</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
            </div>
            <button
              onClick={handleAddDriver}
              aria-label="Add new operator"
              className="h-10 bg-white text-brand-dark rounded-xl font-black uppercase text-xs tracking-widest shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
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
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Saved Operators</span>
                <span className="text-[9px] bg-white/10 text-white/40 font-black px-2 py-0.5 rounded-full">{drivers.length}</span>
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
                  ? <p className="text-white/20 text-xs text-center py-4 font-bold">Loading…</p>
                  : drivers.length === 0
                  ? <p className="text-white/20 text-xs text-center py-4 font-bold uppercase tracking-widest">No operators registered.</p>
                  : drivers.map((driver) => {
                    const assignedBus = buses.find((b) => b.id === driver.assignedBusId);
                    const isDriving = liveDriverIds.has(driver.id);
                    const isEditing = editingDriverId === driver.id;

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
                              <span className="font-bold text-white text-sm truncate">{driver.name}</span>
                              <span className="text-[10px] text-white/30 font-mono tracking-widest">{driver.id}</span>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {isDriving ? (
                                  <span className="text-[9px] text-emerald-400 font-black uppercase tracking-widest flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                                    Online · Driving
                                  </span>
                                ) : (
                                  <span className="text-[9px] text-white/20 font-black uppercase tracking-widest">Offline</span>
                                )}
                                {assignedBus && (
                                  <span className="text-[9px] text-blue-400 font-bold flex items-center gap-1">
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
                              className="w-full h-10 bg-brand-dark/60 border border-white/10 rounded-xl px-3 text-sm text-white focus:border-blue-400/60 outline-none transition-colors placeholder:text-white/20 font-bold"
                            />
                            <div className="relative">
                              <select
                                value={editDriverBusId}
                                onChange={(e) => setEditDriverBusId(e.target.value)}
                                aria-label="Edit assigned vehicle"
                                className="w-full h-10 bg-brand-dark/60 border border-white/10 rounded-xl px-3 pr-8 text-sm text-white focus:border-blue-400/60 outline-none transition-colors font-bold appearance-none cursor-pointer"
                              >
                                <option value="" className="bg-[#1a1c29]">— Unassign Vehicle —</option>
                                {buses.map((b) => <option key={b.id} value={b.id} className="bg-[#1a1c29]">{b.name} ({b.id})</option>)}
                              </select>
                              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
                            </div>
                            <button
                              onClick={() => handleSaveDriver(driver.id)}
                              aria-label="Save operator changes"
                              className="h-9 bg-blue-500 text-white rounded-xl font-black uppercase text-xs tracking-widest shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
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
