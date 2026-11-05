"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
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
import { serverNow } from "@/lib/serverClock";
import { apiRequest, acknowledgedField } from "@/lib/apiClient";
import { validateOperatorInput, validateVehicleInput } from "@/lib/adminValidation";
import {
  devicePresence,
  isActiveService,
  rideServiceState,
} from "@/lib/activeBusEntries";

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
    validateResponse: value => acknowledgedField(value, method === "DELETE" ? "deleted" : "saved"),
  });
}

const TRIP_STATE_CONFIG: Record<string, { label: string; color: string; bg: string; Icon: ComponentType<{ className?: string }> }> = {
  not_armed:     { label: "Ride Not Armed", color: "text-ui-quiet", bg: "bg-ui-soft", Icon: Clock },
  direction_pending: { label: "Direction Pending", color: "text-ui-warning", bg: "bg-ui-warning/10", Icon: Clock },
  pre_departure: { label: "Awaiting Stop 1", color: "text-ui-muted", bg: "bg-ui-soft", Icon: Clock },
  in_service:    { label: "In Service",  color: "text-ui-success",  bg: "bg-ui-success/10", Icon: Navigation },
  completed:     { label: "Completed",   color: "text-brand-accent",     bg: "bg-brand-accent/10",    Icon: CheckCircle2 },
};

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-2 bg-ui-danger/10 border border-ui-danger/30 text-ui-danger rounded-xl px-3 py-2 text-xs font-semibold animate-slide-up">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss error" className="shrink-0 hover:text-ui-ink transition-colors">
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
  const { drivers, loading: driversLoading, error: driversError, retry: retryDrivers } = useDrivers();
  const { routes, error: routesError, retry: retryRoutes } = useRoutes();
  const [liveReadFailed, setLiveReadFailed] = useState(false);
  const onLiveReadError = useCallback(() => setLiveReadFailed(true), []);
  const onLiveReadRecovered = useCallback(() => setLiveReadFailed(false), []);
  const activeEntries = useActiveBuses({ onReadError: onLiveReadError, onReadRecovered: onLiveReadRecovered });
  const [, setFreshnessNow] = useState(() => serverNow());

  useEffect(() => {
    const interval = window.setInterval(() => setFreshnessNow(serverNow()), 15_000);
    return () => window.clearInterval(interval);
  }, []);
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
  const onlineBusIds = new Set(
    filteredActiveEntries
      .filter((entry) => devicePresence(entry) === "online")
      .map((entry) => entry.busId),
  );

  // ── Error state ──────────────────────────────────────────────────────────
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [operatorError, setOperatorError] = useState<string | null>(null);
  const operatorErrorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (operatorError) operatorErrorRef.current?.focus();
  }, [operatorError]);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const runSave = async (work: () => Promise<void>) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try { await work(); }
    finally { savingRef.current = false; setSaving(false); }
  };

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
    // PUT is an upsert: registering a taken ID would silently overwrite it.
    const existingVehicleError = busesLoading
      ? "Saved vehicles are still loading. Try again in a moment."
      : buses.some((bus) => bus.id === newBusId.trim())
        ? `Vehicle ID "${newBusId.trim()}" already exists. Edit the saved vehicle instead.`
        : null;
    if (existingVehicleError) {
      setErrorMsg(existingVehicleError);
      return;
    }
    try {
      await runSave(async () => {
        await fleetRequest(`/buses/${encodeURIComponent(newBusId.trim())}`, "PUT", {
          name: newBusName.trim(), assignedRoutes: newBusRoutes,
        });
        setNewBusId(""); setNewBusName(""); setNewBusRoutes([]);
      });
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
      // Close the dialog so the error banner behind its backdrop is visible.
      setConfirmDeleteBusId(null);
      setErrorMsg("Failed to delete Vehicle: " + errorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  };

  const startEditBus = (bus: BusData) => {
    setEditingBusId(bus.id);
    setEditBusName(bus.name);
    // Saving always replaces the legacy single-route field, so carry it into the draft.
    setEditBusRoutes(Array.isArray(bus.assignedRoutes)
      ? bus.assignedRoutes
      : bus.assignedRouteId ? [bus.assignedRouteId] : []);
    setEditingDriverId(null);
  };

  const handleSaveBus = async (id: string) => {
    const validationError = validateVehicleInput(id, editBusName, editBusRoutes);
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }
    try {
      await runSave(async () => {
        await fleetRequest(`/buses/${encodeURIComponent(id)}`, "PUT", {
          name: editBusName.trim(), assignedRoutes: editBusRoutes,
        });
        setEditingBusId(null);
      });
    } catch (error: unknown) { setErrorMsg("Failed to update Vehicle: " + errorMessage(error)); }
  };

  // â”€â”€ Driver CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleAddDriver = async () => {
    const validationError = validateOperatorInput(newDriverId, newDriverName, newDriverAuthUid);
    if (validationError) {
      setOperatorError(validationError);
      operatorErrorRef.current?.focus();
      return;
    }
    // PUT is an upsert: reusing an operator ID would replace (and demote) its account.
    const existingOperatorError = driversLoading
      ? "Saved operators are still loading. Try again in a moment."
      : drivers.some((driver) => driver.id === newDriverId.trim())
        ? `Operator ID "${newDriverId.trim()}" already exists. Edit the saved operator instead.`
        : null;
    if (existingOperatorError) {
      setOperatorError(existingOperatorError);
      operatorErrorRef.current?.focus();
      return;
    }
    setOperatorError(null);
    const authUid = newDriverAuthUid.trim();
    try {
      await runSave(async () => {
        await fleetRequest(`/drivers/${encodeURIComponent(newDriverId.trim())}`, "PUT", {
          name: newDriverName.trim(), authUid, assignedBusId: newDriverBusId || null,
        });
        setNewDriverId(""); setNewDriverName(""); setNewDriverAuthUid(""); setNewDriverBusId("");
      });
    } catch (error: unknown) { setOperatorError("Failed to add Operator: " + errorMessage(error)); }
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
      setConfirmDeleteDriverId(null);
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
      await runSave(async () => {
        await fleetRequest(`/drivers/${encodeURIComponent(id)}`, "PUT", {
          name: editDriverName.trim(), authUid, assignedBusId: editDriverBusId || null,
        });
        setEditingDriverId(null);
      });
    } catch (error: unknown) { setErrorMsg("Failed to update Operator: " + errorMessage(error)); }
  };

  const liveDriverIds = new Set(
    filteredActiveEntries
      .filter(isActiveService)
      .map((entry) => entry.driverId)
      .filter(Boolean),
  );
  const liveDrivers = drivers.filter((d) => liveDriverIds.has(d.id));

  // â”€â”€ Fleet summary stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (busesError || routesError || driversError) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center justify-center gap-3 p-12 text-center text-ui-danger" role="alert">
        <AlertCircle className="size-9" aria-hidden="true" />
        <p className="text-sm font-semibold">Fleet data could not be loaded.</p>
        <p className="text-xs text-ui-danger">{busesError || routesError || driversError}</p>
        <button
          type="button"
          onClick={() => {
            if (busesError) retryBuses();
            if (routesError) retryRoutes();
            if (driversError) retryDrivers();
          }}
          className="mt-1 rounded-lg bg-ui-hover px-4 py-2 text-xs font-semibold text-ui-ink"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col gap-5 p-3 md:p-6 animate-slide-up">

      {liveReadFailed && <ErrorBanner message="Live vehicle updates are unavailable. Check your connection and reload to retry." onDismiss={() => setLiveReadFailed(false)} />}

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
            <div className="w-9 h-9 rounded-xl bg-ui-soft flex items-center justify-center shrink-0">
              <Bus className="w-4 h-4 text-ui-muted" />
            </div>
            <div>
              <h2 className="font-extrabold text-lg tracking-tight">Fleet Vehicles</h2>
              <p className="text-xs text-ui-quiet uppercase tracking-[0.2em] font-bold">Manage Bus IDs</p>
            </div>
          </div>

          {/* Add form */}
          <div className="panel-rc p-6 flex flex-col gap-4">
            <p className="text-xs text-ui-quiet font-bold uppercase tracking-[0.2em]">Register new vehicle</p>
            <input
              value={newBusId} onChange={(e) => setNewBusId(e.target.value)}
              placeholder="Bus ID (e.g. bus_01)"
              aria-label="New vehicle Bus ID"
              className="w-full h-11 bg-brand-dark/60 border border-ui-line rounded-xl px-3 text-sm text-ui-ink focus:border-ui-control outline-none transition-colors placeholder:text-ui-quiet font-semibold"
            />
            <input
              value={newBusName} onChange={(e) => setNewBusName(e.target.value)}
              placeholder="Display Name (e.g. Red Line Express)"
              aria-label="New vehicle display name"
              className="w-full h-11 bg-brand-dark/60 border border-ui-line rounded-xl px-3 text-sm text-ui-ink focus:border-ui-control outline-none transition-colors placeholder:text-ui-quiet font-semibold"
            />
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-ui-quiet uppercase tracking-[0.2em] font-bold">Assign Allowed Routes</span>
                {newBusRoutes.length > 0 && (
                  <span className="text-xs text-ui-muted bg-ui-hover font-bold px-2 py-0.5 rounded-full">
                    {newBusRoutes.length} selected
                  </span>
                )}
              </div>
              <div className="max-h-36 overflow-y-auto bg-brand-dark/60 border border-ui-line rounded-xl p-2 flex flex-col gap-0.5">
                {routes.length === 0
                  ? <p className="text-ui-quiet text-xs text-center py-3 font-semibold">No routes available</p>
                  : routes.map((r) => {
                    const checked = newBusRoutes.includes(r.id);
                    return (
                      <label
                        key={r.id}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${checked ? "bg-ui-hover" : "hover:bg-ui-soft"}`}
                      >
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${checked ? "border-ui-control bg-brand-accent" : "border-ui-control bg-transparent"}`}>
                          {checked && (
                            <Check className="w-2.5 h-2.5 text-ui-on-accent" strokeWidth={2.5} />
                          )}
                        </div>
                        <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleRoute(r.id)} />
                        <span className={`text-sm font-semibold ${checked ? "text-ui-ink" : "text-ui-muted"}`}>{r.name}</span>
                      </label>
                    );
                  })
                }
              </div>
            </div>
            <button
              onClick={handleAddBus}
              aria-label="Add new vehicle"
              disabled={saving}
              className="btn-rc-primary h-11 flex items-center justify-center gap-2 font-semibold uppercase text-xs tracking-widest px-4"
            >
              <Plus className="w-4 h-4" /> {saving ? "Saving…" : "Add Vehicle"}
            </button>
          </div>

          {/* Saved buses */}
          <div className="panel-rc overflow-hidden">
            <button
              onClick={() => setBusListOpen((o) => !o)}
              aria-label={busListOpen ? "Collapse saved vehicles" : "Expand saved vehicles"}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-ui-soft transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-[0.2em] text-ui-muted">Saved Vehicles</span>
                <span className="text-xs bg-ui-hover text-ui-muted font-bold px-2 py-0.5 rounded-full">{buses.length}</span>
              </div>
              {busListOpen ? <ChevronUp className="w-3.5 h-3.5 text-ui-quiet" /> : <ChevronDown className="w-3.5 h-3.5 text-ui-quiet" />}
            </button>
            {busListOpen && (
              <div className="px-3 pb-3 flex flex-col gap-2 border-t border-ui-line">
                {busesLoading
                  ? <p className="text-ui-quiet text-xs text-center py-4 font-semibold">Loading…</p>
                  : buses.length === 0
                  ? <p className="text-ui-quiet text-xs text-center py-4 font-semibold uppercase tracking-widest">No vehicles registered.</p>
                  : buses.map((bus) => {
                    const isOnline = onlineBusIds.has(bus.id);
                    const isEditing = editingBusId === bus.id;
                    const liveEntry = activeEntries.find(e => e.busId === bus.id);
                    const ts = liveEntry
                      ? TRIP_STATE_CONFIG[rideServiceState(liveEntry)]
                      : null;

                    return (
                      <div key={bus.id} className="bg-brand-dark/40 border border-ui-line rounded-2xl overflow-hidden">
                        {/* Card header row */}
                        <div className="p-3.5 flex items-center justify-between gap-2 group">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isOnline ? "bg-ui-success/20" : "bg-ui-soft"}`}>
                              <Bus className={`w-4 h-4 ${isOnline ? "text-ui-success" : "text-ui-quiet"}`} />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="font-semibold text-ui-ink text-sm truncate">{bus.name}</span>
                              <span className="text-xs text-ui-quiet tabular-nums tracking-widest">{bus.id}</span>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {liveEntry && ts ? (
                                  <span className={`text-xs font-bold uppercase tracking-widest flex items-center gap-1 ${ts.color}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full inline-block ${ts.color.replace("text-","bg-")} ${liveEntry?.motionState === "moving" ? "animate-pulse" : ""}`} />
                                    {ts.label}
                                  </span>
                                ) : (
                                  <span className="text-xs text-ui-quiet font-bold uppercase tracking-widest">No live state</span>
                                )}
                                <span className={`text-xs font-bold uppercase tracking-widest ${isOnline ? "text-ui-success" : "text-ui-quiet"}`}>
                                  {isOnline ? "Device online" : liveEntry ? "Device offline / stale" : "Device offline"}
                                </span>
                                {isOnline && liveEntry?.speed != null && (
                                  <span className="text-xs text-ui-quiet tabular-nums">{Math.round(liveEntry.speed)} km/h</span>
                                )}
                                {bus.assignedRoutes && bus.assignedRoutes.length > 0 ? (
                                  <span className="text-xs text-brand-accent font-semibold flex items-center gap-1">
                                    <ArrowRight className="w-2.5 h-2.5" />
                                    {bus.assignedRoutes.length} Route{bus.assignedRoutes.length !== 1 ? "s" : ""}
                                  </span>
                                ) : bus.assignedRouteId ? (
                                  <span className="text-xs text-brand-accent font-semibold flex items-center gap-1">
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
                              className="p-3 rounded-lg text-ui-quiet hover:text-brand-accent hover:bg-brand-accent/10 transition-all"
                            >
                              {isEditing ? <X className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => handleDeleteBus(bus.id)}
                              aria-label={`Delete vehicle ${bus.name}`}
                              className="p-3 rounded-lg text-ui-quiet hover:text-ui-danger hover:bg-ui-danger/10 transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Inline edit panel */}
                        {isEditing && (
                          <div className="border-t border-ui-line px-4 pb-4 pt-3 flex flex-col gap-2.5 bg-brand-dark/30">
                            <p className="text-xs text-brand-accent font-bold uppercase tracking-[0.2em]">Editing Vehicle</p>
                            <input
                              value={editBusName}
                              onChange={(e) => setEditBusName(e.target.value)}
                              placeholder="Display Name"
                              aria-label="Edit vehicle display name"
                              className="w-full h-11 bg-brand-dark/60 border border-ui-line rounded-xl px-3 text-sm text-ui-ink focus:border-brand-accent/60 outline-none transition-colors placeholder:text-ui-quiet font-semibold"
                            />
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-ui-quiet uppercase tracking-[0.2em] font-bold">Assigned Routes</span>
                              <div className="max-h-32 overflow-y-auto bg-brand-dark/60 border border-ui-line rounded-xl p-2 flex flex-col gap-0.5">
                                {routes.length === 0
                                  ? <p className="text-ui-quiet text-xs text-center py-3 font-semibold">No routes available</p>
                                  : routes.map((r) => {
                                    const checked = editBusRoutes.includes(r.id);
                                    return (
                                      <label key={r.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${checked ? "bg-ui-hover" : "hover:bg-ui-soft"}`}>
                                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${checked ? "border-ui-control bg-brand-accent" : "border-ui-control bg-transparent"}`}>
                                          {checked && <Check className="w-2.5 h-2.5 text-ui-on-accent" strokeWidth={2.5} />}
                                        </div>
                                        <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleEditRoute(r.id)} />
                                        <span className={`text-sm font-semibold ${checked ? "text-ui-ink" : "text-ui-muted"}`}>{r.name}</span>
                                      </label>
                                    );
                                  })
                                }
                              </div>
                            </div>
                            <button
                              onClick={() => handleSaveBus(bus.id)}
                              aria-label="Save vehicle changes"
                              disabled={saving}
                              className="btn-rc-primary h-11 flex items-center justify-center gap-2 font-semibold uppercase text-xs tracking-widest px-4"
                            >
                              <Check className="w-4 h-4" /> {saving ? "Saving…" : "Save Changes"}
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
            <div className="w-9 h-9 rounded-xl bg-ui-soft flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-ui-muted" />
            </div>
            <div>
              <h2 className="font-extrabold text-lg tracking-tight">Driver Personnel</h2>
              <p className="text-xs text-ui-quiet uppercase tracking-[0.2em] font-bold">Manage Operator IDs</p>
            </div>
          </div>

          {/* Add form */}
          <div className="panel-rc p-6 flex flex-col gap-4">
            <p className="text-xs text-ui-quiet font-bold uppercase tracking-[0.2em]">Register new operator</p>
            {operatorError && (
              <div ref={operatorErrorRef} id="operator-create-error" role="alert" tabIndex={-1} className="rounded-xl border border-ui-danger/30 bg-ui-danger/10 p-3 text-sm text-ui-danger focus:outline-2 focus:outline-red-300">
                {operatorError}
              </div>
            )}
            <input
              value={newDriverId} onChange={(e) => setNewDriverId(e.target.value)}
              placeholder="Operator ID (e.g. drv_1)"
              aria-label="New operator ID"
              aria-describedby={operatorError ? "operator-create-error" : undefined}
              className="w-full h-11 bg-brand-dark/60 border border-ui-line rounded-xl px-3 text-sm text-ui-ink focus:border-ui-control outline-none transition-colors placeholder:text-ui-quiet font-semibold"
            />
            <input
              value={newDriverName} onChange={(e) => setNewDriverName(e.target.value)}
              placeholder="Display Name (e.g. Ravi Kumar)"
              aria-label="New operator display name"
              aria-describedby={operatorError ? "operator-create-error" : undefined}
              className="w-full h-11 bg-brand-dark/60 border border-ui-line rounded-xl px-3 text-sm text-ui-ink focus:border-ui-control outline-none transition-colors placeholder:text-ui-quiet font-semibold"
            />
            <input
              value={newDriverAuthUid} onChange={(e) => setNewDriverAuthUid(e.target.value)}
              placeholder="Firebase Auth UID"
              aria-label="Firebase Auth UID for new operator"
              aria-describedby={operatorError ? "operator-create-error" : undefined}
              className="w-full h-11 bg-brand-dark/60 border border-ui-line rounded-xl px-3 text-sm text-ui-ink focus:border-ui-control outline-none transition-colors placeholder:text-ui-quiet font-semibold"
            />
            <CustomSelect
              name="new-operator-vehicle"
              value={newDriverBusId}
              onChange={(val) => setNewDriverBusId(val)}
              ariaLabel="Assign vehicle to new operator"
              placeholder="— Assign Vehicle —"
              options={[
                { value: "", label: "— Assign Vehicle —" },
                ...buses.map((b) => ({ value: b.id, label: `${b.name} (${b.id})` })),
              ]}
              style={{ background: "var(--surface-1)", border: "1px solid var(--border-default)" }}
            />
            <button
              onClick={handleAddDriver}
              aria-label="Add new operator"
              disabled={saving}
              className="btn-rc-primary h-11 flex items-center justify-center gap-2 font-semibold uppercase text-xs tracking-widest px-4"
            >
              <Plus className="w-4 h-4" /> {saving ? "Saving…" : "Add Operator"}
            </button>
          </div>

          {/* Saved drivers */}
          <div className="bg-brand-surface/40 border border-ui-line rounded-[1.5rem] overflow-hidden">
            <button
              onClick={() => setDriverListOpen((o) => !o)}
              aria-label={driverListOpen ? "Collapse saved operators" : "Expand saved operators"}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-ui-soft transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-[0.2em] text-ui-muted">Saved Operators</span>
                <span className="text-xs bg-ui-hover text-ui-muted font-bold px-2 py-0.5 rounded-full">{drivers.length}</span>
                {liveDrivers.length > 0 && (
                  <span className="text-xs bg-ui-success/20 text-ui-success font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-ui-success animate-pulse inline-block" />
                    {liveDrivers.length} Live
                  </span>
                )}
              </div>
              {driverListOpen ? <ChevronUp className="w-3.5 h-3.5 text-ui-quiet" /> : <ChevronDown className="w-3.5 h-3.5 text-ui-quiet" />}
            </button>
            {driverListOpen && (
              <div className="px-3 pb-3 flex flex-col gap-2 border-t border-ui-line">
                {driversLoading
                  ? <p className="text-ui-quiet text-xs text-center py-4 font-semibold">Loading…</p>
                  : drivers.length === 0
                  ? <p className="text-ui-quiet text-xs text-center py-4 font-semibold uppercase tracking-widest">No operators registered.</p>
                  : drivers.map((driver) => {
                    const assignedBus = buses.find((b) => b.id === driver.assignedBusId);
                    const isDriving = liveDriverIds.has(driver.id);
                    const isEditing = editingDriverId === driver.id;
                    const liveEntry = activeEntries.find(e => e.driverId === driver.id);
                    const dTs = liveEntry
                      ? TRIP_STATE_CONFIG[rideServiceState(liveEntry)]
                      : null;

                    return (
                      <div
                        key={driver.id}
                        className={`border rounded-2xl overflow-hidden transition-all ${isDriving ? "bg-ui-success/5 border-ui-success/20" : "bg-brand-dark/40 border-ui-line"}`}
                      >
                        {/* Card header row */}
                        <div className="p-3.5 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isDriving ? "bg-ui-success/20" : "bg-ui-soft"}`}>
                              <User className={`w-4 h-4 ${isDriving ? "text-ui-success" : "text-ui-quiet"}`} />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="font-semibold text-ui-ink text-sm truncate">{driver.name}</span>
                              <span className="text-xs text-ui-quiet tabular-nums tracking-widest">{driver.id}</span>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {isDriving && dTs ? (
                                  <span className={`text-xs font-bold uppercase tracking-widest flex items-center gap-1 ${dTs.color}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full inline-block ${dTs.color.replace("text-","bg-")} ${liveEntry?.motionState === "moving" ? "animate-pulse" : ""}`} />
                                    {dTs.label}
                                  </span>
                                ) : (
                                  <span className="text-xs text-ui-quiet font-bold uppercase tracking-widest">Offline</span>
                                )}
                                {isDriving && liveEntry?.speed != null && (
                                  <span className="text-xs text-ui-quiet tabular-nums">{Math.round(liveEntry.speed)} km/h</span>
                                )}
                                {assignedBus && (
                                  <span className="text-xs text-brand-accent font-semibold flex items-center gap-1">
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
                              className="p-3 rounded-lg text-ui-quiet hover:text-brand-accent hover:bg-brand-accent/10 transition-all"
                            >
                              {isEditing ? <X className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => handleDeleteDriver(driver.id)}
                              aria-label={`Delete operator ${driver.name}`}
                              className="p-3 rounded-lg text-ui-quiet hover:text-ui-danger hover:bg-ui-danger/10 transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Inline edit panel */}
                        {isEditing && (
                          <div className="border-t border-ui-line px-4 pb-4 pt-3 flex flex-col gap-2.5 bg-brand-dark/30">
                            <p className="text-xs text-brand-accent font-bold uppercase tracking-[0.2em]">Editing Operator</p>
                            <input
                              value={editDriverName}
                              onChange={(e) => setEditDriverName(e.target.value)}
                              placeholder="Display Name"
                              aria-label="Edit operator display name"
                              className="w-full h-11 bg-brand-dark/60 border border-ui-line rounded-xl px-3 text-sm text-ui-ink focus:border-brand-accent/60 outline-none transition-colors placeholder:text-ui-quiet font-semibold"
                            />
                            <input
                              value={editDriverAuthUid}
                              onChange={(e) => setEditDriverAuthUid(e.target.value)}
                              placeholder="Firebase Auth UID"
                              aria-label="Firebase Auth UID for operator"
                              className="w-full h-11 bg-brand-dark/60 border border-ui-line rounded-xl px-3 text-sm text-ui-ink focus:border-ui-control outline-none transition-colors placeholder:text-ui-quiet font-semibold"
                            />
                            <CustomSelect
                              name="edit-operator-vehicle"
                              value={editDriverBusId}
                              onChange={(val) => setEditDriverBusId(val)}
                              ariaLabel="Edit assigned vehicle"
                              placeholder="— Unassign Vehicle —"
                              options={[
                                { value: "", label: "— Unassign Vehicle —" },
                                ...buses.map((b) => ({ value: b.id, label: `${b.name} (${b.id})` })),
                              ]}
                              style={{ background: "var(--surface-1)", border: "1px solid var(--border-default)" }}
                            />
                            <button
                              onClick={() => handleSaveDriver(driver.id)}
                              aria-label="Save operator changes"
                              disabled={saving}
                              className="h-11 bg-brand-accent text-ui-on-accent rounded-xl font-bold uppercase text-xs tracking-widest shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
                            >
                              <Check className="w-4 h-4" /> {saving ? "Saving…" : "Save Changes"}
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
