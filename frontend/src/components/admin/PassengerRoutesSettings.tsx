"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Info, Loader2, Route as RouteIcon, Save } from "lucide-react";
import AlertModal from "@/components/ui/AlertModal";
import { useRoutes, type RouteData } from "@/hooks/useRoutes";
import { usePassengerRouteConfig } from "@/hooks/usePassengerRouteConfig";
import {
  findPassengerStopTimeProblems,
  passengerStopTimeKey,
  type PassengerStopTimeProblem,
  validatePassengerRouteSchedule,
} from "@/lib/adminValidation";
import { errorMessage } from "@/lib/errors";
import type { PassengerRouteApproval, PassengerRouteConfig } from "@/lib/passengerRouteSchedule";
import { useUnsavedChanges } from "@/lib/unsavedChanges";
import { SectionHeader } from "./SettingsSection";

const FALLBACK_ROUTE_COLOR = "#94a3b8";
const INVALID_BORDER = "rgba(248, 113, 113, 0.75)";

function routeStops(route: RouteData | undefined) {
  return Array.isArray(route?.stops) ? route.stops : [];
}

function routeColor(route: RouteData): string {
  return typeof route.color === "string" && route.color.trim() ? route.color : FALLBACK_ROUTE_COLOR;
}

function stopLabel(stop: { id: string; name?: string; shortName?: string }): string {
  return stop.name || stop.shortName || stop.id;
}

/** Keep only approvals for routes that still exist, and times for their current stops. */
function sanitizeApprovals(
  approvals: readonly PassengerRouteApproval[],
  routesById: ReadonlyMap<string, RouteData>,
): PassengerRouteApproval[] {
  const result: PassengerRouteApproval[] = [];
  for (const approval of approvals) {
    const route = routesById.get(approval.routeId);
    if (!route) continue;
    const stopTimes: Record<string, string> = {};
    for (const stop of routeStops(route)) {
      const time = approval.stopTimes[stop.id];
      if (typeof time === "string" && time !== "") stopTimes[stop.id] = time;
    }
    result.push({ routeId: approval.routeId, stopTimes });
  }
  return result;
}

/** Order-sensitive for routes, order-insensitive for stop times; blank times count as unset. */
function scheduleKey(approvals: readonly PassengerRouteApproval[]): string {
  return JSON.stringify(approvals.map(approval => [
    approval.routeId,
    Object.entries(approval.stopTimes)
      .filter(([, time]) => time !== "")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]));
}

/** Full-replace payload: each route's times for exactly its current stop IDs. */
function buildPayload(
  approvals: readonly PassengerRouteApproval[],
  routesById: ReadonlyMap<string, RouteData>,
): PassengerRouteConfig {
  return {
    routes: approvals.map(approval => {
      const stopTimes: Record<string, string> = {};
      for (const stop of routeStops(routesById.get(approval.routeId))) {
        stopTimes[stop.id] = approval.stopTimes[stop.id] ?? "";
      }
      return { routeId: approval.routeId, stopTimes };
    }),
  };
}

/** DOM-safe, injective encoding so every route+stop pair gets a unique id. */
function idPart(value: string): string {
  return value.replace(/[^A-Za-z0-9-]/g, char => `_${char.charCodeAt(0).toString(16)}_`);
}

export default function PassengerRoutesSettings() {
  const { config, loading: configLoading, error: configError, saveConfig } = usePassengerRouteConfig();
  const { routes, loading: routesLoading, error: routesError, retry: retryRoutes } = useRoutes();
  const [draft, setDraft] = useState<PassengerRouteApproval[] | null>(null);
  // The listener echoes our own save a moment later; show the saved payload until it does.
  const [awaitingEcho, setAwaitingEcho] = useState<{ payload: PassengerRouteConfig; configAtSave: PassengerRouteConfig } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseId = useId();

  const routesById = useMemo(() => new Map(routes.map(route => [route.id, route])), [routes]);
  const sortedRoutes = useMemo(
    () => [...routes].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, undefined, { numeric: true, sensitivity: "base" })),
    [routes],
  );

  const stored = awaitingEcho && awaitingEcho.configAtSave === config ? awaitingEcho.payload : config;
  const baseline = sanitizeApprovals(stored.routes, routesById);
  const removedRouteCount = stored.routes.filter(approval => !routesById.has(approval.routeId)).length;
  const current = draft ? sanitizeApprovals(draft, routesById) : baseline;
  const isDirty = draft !== null && scheduleKey(current) !== scheduleKey(baseline);
  // Dropping deleted routes/stops is also a pending change, even without edits.
  const hasChanges = scheduleKey(current) !== scheduleKey(stored.routes);
  const ready = !configLoading && !routesLoading && !configError && !routesError;
  useUnsavedChanges(ready && isDirty);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const problems: ReadonlyMap<string, PassengerStopTimeProblem> = showErrors
    ? findPassengerStopTimeProblems({ routes: current }, routes)
    : new Map();

  const edit = (next: PassengerRouteApproval[]) => {
    setSaved(false);
    setDraft(next);
  };

  const toggleRoute = (routeId: string, selected: boolean) => {
    if (!selected) {
      edit(current.filter(approval => approval.routeId !== routeId));
      return;
    }
    if (current.some(approval => approval.routeId === routeId)) return;
    // Re-selecting a published route restores its stored times; new routes start blank.
    const storedApproval = stored.routes.find(approval => approval.routeId === routeId);
    const [seeded] = sanitizeApprovals([storedApproval ?? { routeId, stopTimes: {} }], routesById);
    edit([...current, seeded]);
  };

  const setStopTime = (routeId: string, stopId: string, time: string) => {
    edit(current.map(approval => approval.routeId === routeId
      ? { routeId, stopTimes: { ...approval.stopTimes, [stopId]: time } }
      : approval));
  };

  const handleSave = async () => {
    const validationError = validatePassengerRouteSchedule({ routes: current }, routes);
    if (validationError) {
      setShowErrors(true);
      setAlertMessage(validationError);
      return;
    }
    const payload = buildPayload(current, routesById);
    const configAtSave = config;
    setSaving(true);
    try {
      await saveConfig(payload);
      setAwaitingEcho({ payload, configAtSave });
      setDraft(null);
      setShowErrors(false);
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 3000);
    } catch (error: unknown) {
      setAlertMessage("Failed to save passenger routes: " + errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  let body: ReactNode;
  if (configLoading || routesLoading) {
    body = (
      <div className="flex items-center justify-center py-10 gap-3 text-white/30">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm font-medium">Loading passenger routes…</span>
      </div>
    );
  } else if (configError) {
    // Editing an empty fallback would overwrite the stored approvals on save.
    body = (
      <div className="flex flex-col items-center justify-center py-8 gap-2 text-center text-red-300" role="alert">
        <span className="text-sm font-semibold">{configError}</span>
        <span className="text-xs text-red-300/70">Editing is unavailable until the current passenger routes load. Check your connection or admin access.</span>
      </div>
    );
  } else if (routesError) {
    body = (
      <div className="flex flex-col items-center justify-center py-8 gap-2 text-center text-red-300" role="alert">
        <AlertCircle className="size-6" aria-hidden="true" />
        <span className="text-sm font-semibold">{routesError}</span>
        <span className="text-xs text-red-300/70">Routes are needed to choose what passengers see.</span>
        <button
          type="button"
          onClick={retryRoutes}
          className="mt-1 min-h-11 rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white"
        >
          Retry
        </button>
      </div>
    );
  } else {
    const selectedIds = new Set(current.map(approval => approval.routeId));
    body = (
      <>
        {removedRouteCount > 0 && (
          <div className="flex items-start gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-amber-300" role="note">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>
              {removedRouteCount === 1
                ? "1 previously published route was deleted and will be removed when you save."
                : `${removedRouteCount} previously published routes were deleted and will be removed when you save.`}
            </span>
          </div>
        )}

        {sortedRoutes.length === 0 ? (
          <p className="text-sm text-white/40">No routes exist yet. Create a route on the Routes page first.</p>
        ) : (
          <fieldset className="flex flex-col gap-2 min-w-0" disabled={saving}>
            <legend className="text-sm font-semibold text-white/80 mb-1.5">Routes shown to passengers</legend>
            <p className="text-xs text-white/30 -mt-0.5 mb-1">
              Only selected routes appear in the passenger Routes tab. {current.length} selected.
            </p>
            <ul className="flex flex-col gap-1.5">
              {sortedRoutes.map(route => {
                const checkboxId = `${baseId}-route-${idPart(route.id)}`;
                const stopCount = routeStops(route).length;
                const checked = selectedIds.has(route.id);
                return (
                  <li key={route.id}>
                    <label
                      htmlFor={checkboxId}
                      className={`flex items-center gap-3 min-h-11 px-3 py-2 rounded-xl border cursor-pointer transition-colors ${checked ? "border-white/20 bg-white/5" : "border-white/8 hover:bg-white/3"}`}
                    >
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={checked}
                        onChange={event => toggleRoute(route.id, event.target.checked)}
                        className="w-4 h-4 shrink-0 accent-emerald-500"
                      />
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: routeColor(route) }} aria-hidden="true" />
                      <span className="text-sm font-semibold text-white min-w-0 break-words flex-1">{route.name || route.id}</span>
                      <span className="text-xs text-white/40 shrink-0">{stopCount === 1 ? "1 stop" : `${stopCount} stops`}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}

        {current.map(approval => {
          const route = routesById.get(approval.routeId)!;
          const routeName = route.name || route.id;
          const color = routeColor(route);
          const stops = routeStops(route);
          const headingId = `${baseId}-schedule-${idPart(route.id)}`;
          return (
            <section
              key={approval.routeId}
              aria-labelledby={headingId}
              className="rounded-xl border border-white/8 border-l-4 bg-black/20 p-4 flex flex-col gap-3 min-w-0"
              style={{ borderLeftColor: color }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} aria-hidden="true" />
                <h3 id={headingId} className="font-bold text-white text-sm min-w-0 break-words">{routeName}</h3>
                <span className="text-xs text-white/40 ml-auto shrink-0">Stop times</span>
              </div>
              {stops.length === 0 ? (
                <p className="text-xs text-white/40">This route has no stops yet.</p>
              ) : (
                <ol className="flex flex-col">
                  {stops.map((stop, index) => {
                    const name = stopLabel(stop);
                    const inputId = `${baseId}-time-${idPart(route.id)}-${idPart(stop.id)}`;
                    const errorId = `${inputId}-error`;
                    const problem = problems.get(passengerStopTimeKey(route.id, stop.id));
                    return (
                      <li
                        key={stop.id}
                        className="flex flex-col gap-2 py-2.5 border-t border-white/5 first:border-t-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                      >
                        <div className="flex items-center gap-3 min-w-0 sm:min-h-11">
                          <span
                            className="w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 text-white"
                            style={{ backgroundColor: color }}
                            aria-hidden="true"
                          >
                            {index + 1}
                          </span>
                          <span className="text-sm text-white/80 font-medium min-w-0 break-words">{name}</span>
                        </div>
                        <div className="flex flex-col gap-1 pl-9 sm:pl-0 sm:w-40 sm:shrink-0">
                          <input
                            id={inputId}
                            type="time"
                            disabled={saving}
                            value={approval.stopTimes[stop.id] ?? ""}
                            onChange={event => setStopTime(route.id, stop.id, event.target.value)}
                            aria-label={`Time for ${name} on ${routeName}`}
                            aria-invalid={problem ? true : undefined}
                            aria-describedby={problem ? errorId : undefined}
                            className="input-rc h-11 [color-scheme:dark]"
                            style={problem ? { borderColor: INVALID_BORDER } : undefined}
                          />
                          {problem && (
                            <p id={errorId} className="text-xs text-red-300">
                              {problem === "missing" ? "Time required" : "Enter a valid time"}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          );
        })}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !hasChanges}
            aria-describedby="passenger-routes-save-status"
            className="min-h-11 w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white text-[#09090b] font-bold text-sm hover:bg-white/90 transition-colors shadow-lg disabled:opacity-50"
          >
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              : saved
              ? <><span className="text-emerald-600">✓</span> Saved!</>
              : <><Save className="w-4 h-4" /> {hasChanges ? "Save routes" : "No route changes"}</>
            }
          </button>
        </div>
        <p id="passenger-routes-save-status" className="sr-only" role="status" aria-live="polite">
          {saving ? "Saving passenger routes" : saved ? "Passenger routes saved" : hasChanges ? "Unsaved passenger route changes" : "Passenger routes unchanged"}
        </p>
      </>
    );
  }

  return (
    <div className="bg-white/3 border border-white/8 rounded-2xl p-5 flex flex-col gap-5 min-w-0">
      <SectionHeader icon={RouteIcon} title="Passenger Routes" subtitle="Choose which routes passengers can browse and set the time at each stop" />
      {body}
      <AlertModal
        isOpen={Boolean(alertMessage)}
        message={alertMessage || ""}
        onClose={() => setAlertMessage(null)}
      />
    </div>
  );
}
