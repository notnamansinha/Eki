"use client";

import { useState, type ComponentType } from "react";
import { useBuses, BusData } from "@/hooks/useBuses";
import { useDrivers, DriverData } from "@/hooks/useDrivers";
import { useRoutes } from "@/hooks/useRoutes";
import { useActiveBuses } from "@/hooks/useActiveBuses";
import { auth } from "@/lib/firebaseAuth";
import {
  Bus, User, Trash2, Plus, ArrowRight,
  ChevronDown, ChevronUp, Pencil, Check, X, AlertCircle,
  Navigation, Clock, CheckCircle2,
} from "lucide-react";
import CustomSelect from "@/components/ui/CustomSelect";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { errorMessage } from "@/lib/errors";
import { apiRequest } from "@/lib/apiClient";
import { validateOperatorInput, validateVehicleInput } from "@/lib/adminValidation";

async function fleetRequest(path: string, method: "PUT" | "DELETE", body?: object) {
  if (!auth.currentUser) throw new Error("Fleet service is not configured.");
  const token = await auth.currentUser.getIdToken();
  await apiRequest(`/api/fleet${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    fallbackError: "Fleet operation failed.",
  });
}

const TRIP_STATE_CONFIG: Record<string, { label: string; color: string; bg: string; Icon: ComponentType<{ className?: string }> }> = {
  pre_departure: { label: "Awaiting Stop 1", color: "text-white/50", bg: "bg-white/5", Icon: Clock },
  in_service:    { label: "In Service",  color: "text-emerald-400",  bg: "bg-emerald-500/10", Icon: Navigation },
  completed:     { label: "Completed",   color: "text-blue-400",     bg: "bg-blue-500/10",    Icon: CheckCircle2 },
};

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
interface Props {
  mode?: "fleet" | "personnel" | "combined";
}

export default function FleetManagementPanel({ mode = "combined" }: Props) {
  const {
    buses,
    loading: busesLoading,
    error: busesError,
    retry: retryBuses,
  } = useBuses();
  const { drivers, loading: driversLoading } = useDrivers();
  const { routes, error: routesError, retry: retryRoutes } = useRoutes();
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

  // ── Error state ──────────────────────────────────────────────────────────
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Modal confirmation states ──────────────────────────────────────────────
  const [confirmDeleteBusId, setConfirmDeleteBusId] = useState<string | null>(null);
  const [confirmDeleteDriverId, setConfirmDeleteDriverId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ── Bus CRUD ─────────────────────────────────────────────────────────────
  const [newBusId, setNewBusId] = useState("");
  const [newBusName, setNewBusName] = useState("");
  const [newBusRoutes, setNewBusRoutes] = useState<string[]>([]);
  const [busListOpen, setBusListOpen] = useState(true);

  // ── Bus inline edit ──────────────────────────────────────────────────────
  const [editingBusId, setEditingBusId] = useState<string | null>(null);
  const [editBusName, setEditBusName] = useState("");
  const [editBusRoutes, setEditBusRoutes] = useState<string[]>([]);

  // ── Driver add form ──────────────────────────────────────────────────────
  const [newDriverId, setNewDriverId] = useState("");
  const [newDriverName, setNewDriverName] = useState("");
  const [newDriverAuthUid, setNewDriverAuthUid] = useState("");
  const [newDriverBusId, setNewDriverBusId] = useState("");
  const [driverListOpen, setDriverListOpen] = useState(true);

  // ── Driver inline edit ───────────────────────────────────────────────────
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [editDriverName, setEditDriverName] = useState("");
  const [editDriverAuthUid, setEditDriverAuthUid] = useState("");
  const [editDriverBusId, setEditDriverBusId] = useState("");

  // ── Route togglers ───────────────────────────────────────────────────────
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
    const validationError = validateVehicleInput(newBusId, newBusName, newBusRoutes);
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }
    try {
      await fleetRequest(`/buses/${encodeURIComponent(newBusId.trim())}`, "PUT", {
        name: newBusName.trim(),
        assignedRoutes: newBusRoutes,
      });
      setNewBusId(""); setNewBusName(""); setNewBusRoutes([]);
    } catch (error: unknown) { setErrorMsg("Failed to add Vehicle: " + errorMessage(error)); }
  };

  const handleDeleteBus = (id: string) => {
    setConfirmDeleteBusId(id);
  };

  const confirmDeleteBus = async () => {
    if (!confirmDeleteBusId) return;
    const id = confirmDeleteBusId;
    setIsDeleting(true);
    try {
      await fleetRequest(`/buses/${encodeURIComponent(id)}`, "DELETE");
      setConfirmDeleteBusId(null);
    } catch (error: unknown) {
      setErrorMsg("Failed to delete Vehicle: " + errorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  };

  const startEditBus = (bus: BusData) => {
    setEditingBusId(bus.id);
    setEditBusName(bus.name);
    setEditBusRoutes(bus.assignedRoutes ?? []);
    setEditingDriverId(null);
  };

  const handleSaveBus = async (id: string) => {
    const validationError = validateVehicleInput(id, editBusName, editBusRoutes);
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }
    try {
      await fleetRequest(`/buses/${encodeURIComponent(id)}`, "PUT", {
        name: editBusName.trim(),
        assignedRoutes: editBusRoutes,
      });
      setEditingBusId(null);
    } catch (error: unknown) { setErrorMsg("Failed to update Vehicle: " + errorMessage(error)); }
  };

  // â”€â”€ Driver CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleAddDriver = async () => {
    const validationError = validateOperatorInput(newDriverId, newDriverName, newDriverAuthUid);
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }
    const authUid = newDriverAuthUid.trim();
    try {
      await fleetRequest(`/drivers/${encodeURIComponent(newDriverId.trim())}`, "PUT", {
        name: newDriverName.trim(),
        authUid,
        assignedBusId: newDriverBusId || null,
      });
      setNewDriverId(""); setNewDriverName(""); setNewDriverAuthUid(""); setNewDriverBusId("");
    } catch (error: unknown) { setErrorMsg("Failed to add Operator: " + errorMessage(error)); }
  };

  const handleDeleteDriver = (id: string) => {
    setConfirmDeleteDriverId(id);
  };

  const confirmDeleteDriver = async () => {
    if (!confirmDeleteDriverId) return;
    const id = confirmDeleteDriverId;
    setIsDeleting(true);
    try {
      await fleetRequest(`/drivers/${encodeURIComponent(id)}`, "DELETE");
      setConfirmDeleteDriverId(null);
    } catch (error: unknown) {
      setErrorMsg("Failed to delete Operator: " + errorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  };

  const startEditDriver = (driver: DriverData) => {
    setEditingDriverId(driver.id);
    setEditDriverName(driver.name);
    setEditDriverAuthUid(driver.authUid ?? "");
    setEditDriverBusId(driver.assignedBusId ?? "");
    setEditingBusId(null);
  };

  const handleSaveDriver = async (id: string) => {
    const validationError = validateOperatorInput(id, editDriverName, editDriverAuthUid);
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }
    const authUid = editDriverAuthUid.trim();
    try {
      await fleetRequest(`/drivers/${encodeURIComponent(id)}`, "PUT", {
        name: editDriverName.trim(),
        authUid,
        assignedBusId: editDriverBusId || null,
      });
      setEditingDriverId(null);
    } catch (error: unknown) { setErrorMsg("Failed to update Operator: " + errorMessage(error)); }
  };

  const liveDriverIds = new Set(filteredActiveEntries.map((e) => e.driverId).filter(Boolean));
  const liveDrivers = drivers.filter((d) => liveDriverIds.has(d.id));

  // â”€â”€ Fleet summary stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (busesError || routesError) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center justify-center gap-3 p-12 text-center text-red-300" role="alert">
        <AlertCircle className="size-9" aria-hidden="true" />
        <p className="text-sm font-semibold">Fleet data could not be loaded.</p>
        <p className="text-xs text-red-300/70">{busesError || routesError}</p>
        <button
          type="button"
          onClick={() => {
            if (busesError) retryBuses();
            if (routesError) retryRoutes();
          }}
          className="mt-1 rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col gap-5 p-3 md:p-6 animate-slide-up">

      {/* â”€â”€ Global error banner â”€â”€ */}
      {errorMsg && (
        <ErrorBanner message={errorMsg} onDismiss={() => setErrorMsg(null)} />
      )}


      {/* â•â• FLEET COMMAND CENTER — always visible, driven by live Firebase data â•â• */}

      {/* â•â• CONDITIONAL TABS: Vehicles OR Drivers â•â• */}
      <div className="flex flex-col gap-5 w-full max-w-3xl mx-auto">

        {/* â”€â”€ FLEET VEHICLES â”€â”€ */}
        {(mode === "fleet" || mode === "combined") && (
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

        </div>
        )}

        {/* â”€â”€ DRIVER PERSONNEL â”€â”€ */}
        {(mode === "personnel" || mode === "combined") && (
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
            <CustomSelect
              value={newDriverBusId}
              onChange={(val) => setNewDriverBusId(val)}
              ariaLabel="Assign vehicle to new operator"
              placeholder="— Assign Vehicle —"
              options={[
                { value: "", label: "— Assign Vehicle —" },
                ...buses.map((b) => ({ value: b.id, label: `${b.name} (${b.id})` })),
              ]}
              style={{ background: "rgba(10, 12, 20, 0.6)", border: "1px solid rgba(255, 255, 255, 0.1)" }}
            />
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
                            <CustomSelect
                              value={editDriverBusId}
                              onChange={(val) => setEditDriverBusId(val)}
                              ariaLabel="Edit assigned vehicle"
                              placeholder="— Unassign Vehicle —"
                              options={[
                                { value: "", label: "— Unassign Vehicle —" },
                                ...buses.map((b) => ({ value: b.id, label: `${b.name} (${b.id})` })),
                              ]}
                              style={{ background: "rgba(10, 12, 20, 0.6)", border: "1px solid rgba(255, 255, 255, 0.1)" }}
                            />
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

      {/* In-app confirm modals */}
      <ConfirmModal
        isOpen={Boolean(confirmDeleteBusId)}
        title="Delete Vehicle?"
        description={`Are you sure you want to delete vehicle "${confirmDeleteBusId}"? This action cannot be undone.`}
        confirmText="Delete Vehicle"
        cancelText="Cancel"
        variant="danger"
        loading={isDeleting}
        onConfirm={confirmDeleteBus}
        onCancel={() => setConfirmDeleteBusId(null)}
      />

      <ConfirmModal
        isOpen={Boolean(confirmDeleteDriverId)}
        title="Delete Operator?"
        description={`Are you sure you want to delete operator "${confirmDeleteDriverId}"? This action cannot be undone.`}
        confirmText="Delete Operator"
        cancelText="Cancel"
        variant="danger"
        loading={isDeleting}
        onConfirm={confirmDeleteDriver}
        onCancel={() => setConfirmDeleteDriverId(null)}
      />
    </div>
  );
}
