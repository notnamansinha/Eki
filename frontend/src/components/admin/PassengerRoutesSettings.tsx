"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Info, Loader2, Route as RouteIcon, Save } from "lucide-react";
import AlertModal from "@/components/ui/AlertModal";
import { useRoutes, type RouteData } from "@/hooks/useRoutes";
import { usePassengerRouteConfig } from "@/hooks/usePassengerRouteConfig";
import {
  passengerStopTimeKey,
  type PassengerStopTimeProblem,
  validatePassengerRouteSchedule,
} from "@/lib/adminValidation";
import { errorMessage } from "@/lib/errors";
import { isValidStopTime, type PassengerRouteApproval, type PassengerRouteConfig } from "@/lib/passengerRouteSchedule";
import { useUnsavedChanges } from "@/lib/unsavedChanges";
import { SectionHeader } from "./SettingsSection";

const FALLBACK_ROUTE_COLOR = "#94a3b8";
const INVALID_BORDER = "var(--status-danger)";

function routeStops(route: RouteData | undefined) {
  return Array.isArray(route?.stops) ? route.stops : [];
}

function routeColor(route: RouteData): string {
  return typeof route.color === "string" && route.color.trim() ? route.color : FALLBACK_ROUTE_COLOR;
}

function stopLabel(stop: { id: string; name?: string; shortName?: string }): string {
  return stop.name || stop.shortName || stop.id;
}

/**
 * Hours with optional minutes, as typed or pasted: "8", "830", "0830", "8:30" or
 * "8.30", then optional ":ss" seconds ("09:45:00"), then an optional 12-hour
 * suffix in any case, with or without a space: "am", "pm", "a.m.", "p.m.", "a" or "p".
 */
const TYPED_STOP_TIME = /^(\d{1,2})(?:[:.]?(\d{2})(?::(\d{2}))?)?(?:\s*([ap])\.?(?:m\.?)?)?$/i;

/**
 * Tidy a typed stop time into the stored 24-hour "HH:mm": "830", "0830", "8:30"
 * and "8.30" become "08:30", "8" becomes "08:00", and a pasted "09:45:00" drops its
 * zero seconds. A 12-hour suffix keeps the time of day, so a pasted "9:45 pm"
 * becomes "21:45", "12:30 am" becomes "00:30" and "12 pm" becomes "12:00"; with a
 * suffix the hour must be 1-12. Text that isn't a whole minute of the day
 * ("25:00", "13:00 pm", "0:30 am", "09:45:30", "ab") comes back trimmed but
 * otherwise as typed, so it is flagged rather than guessed at.
 */
function normaliseStopTime(typed: string): string {
  const text = typed.trim();
  const match = TYPED_STOP_TIME.exec(text);
  if (!match) return text;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  const seconds = Number(match[3] ?? "0");
  const meridiem = match[4]?.toLowerCase();
  if (minutes > 59 || seconds !== 0) return text;
  if (meridiem) {
    if (hours < 1 || hours > 12) return text;
    hours = (hours % 12) + (meridiem === "p" ? 12 : 0);
  } else if (hours > 23) {
    return text;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normaliseApprovals(approvals: readonly PassengerRouteApproval[]): PassengerRouteApproval[] {
  return approvals.map(({ routeId, stopTimes }) => ({
    routeId,
    stopTimes: Object.fromEntries(Object.entries(stopTimes).map(([stopId, time]) => [stopId, normaliseStopTime(time)])),
  }));
}

/** `passengerStopTimeKey` → the entered text, for every time that isn't "HH:mm". */
function invalidStopTimes(approvals: readonly PassengerRouteApproval[]): Map<string, string> {
  const invalid = new Map<string, string>();
  for (const { routeId, stopTimes } of approvals) {
    for (const [stopId, time] of Object.entries(stopTimes)) {
      if (time !== "" && !isValidStopTime(time)) invalid.set(passengerStopTimeKey(routeId, stopId), time);
    }
  }
  return invalid;
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

/**
 * Order-sensitive for routes, order-insensitive for stop times; times compare as
 * they will be saved ("0830" matches "08:30") and blank times count as unset.
 */
function scheduleKey(approvals: readonly PassengerRouteApproval[]): string {
  return JSON.stringify(approvals.map(approval => [
    approval.routeId,
    Object.entries(approval.stopTimes)
      .map(([stopId, time]) => [stopId, normaliseStopTime(time)])
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
  // Text that isn't a time, flagged when the admin leaves the field and shown until they change it.
  const [flaggedTimes, setFlaggedTimes] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectOnMouseUpRef = useRef(false);
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

  /** Leaving a time field tidies what was typed into "HH:mm" and flags text that still isn't a time. */
  const commitStopTime = (routeId: string, stopId: string, typed: string) => {
    const time = normaliseStopTime(typed);
    if (time !== typed) setStopTime(routeId, stopId, time);
    const key = passengerStopTimeKey(routeId, stopId);
    const invalid = time !== "" && !isValidStopTime(time);
    setFlaggedTimes(previous => {
      if (invalid ? previous.get(key) === time : !previous.has(key)) return previous;
      const next = new Map(previous);
      if (invalid) next.set(key, time);
      else next.delete(key);
      return next;
    });
  };

  const handleSave = async () => {
    // Tidy a field that is still being typed in, exactly as leaving it would.
    const schedule = normaliseApprovals(current);
    if (draft) edit(schedule);
    const validationError = validatePassengerRouteSchedule({ routes: schedule }, routes);
    if (validationError) {
      setFlaggedTimes(invalidStopTimes(schedule));
      setShowErrors(true);
      setAlertMessage(validationError);
      return;
    }
    const payload = buildPayload(schedule, routesById);
    const configAtSave = config;
    setSaving(true);
    try {
      await saveConfig(payload);
      setAwaitingEcho({ payload, configAtSave });
      setDraft(null);
      setShowErrors(false);
      setFlaggedTimes(new Map());
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
      <div className="flex items-center justify-center py-10 gap-3 text-ui-quiet">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm font-medium">Loading passenger routes…</span>
      </div>
    );
  } else if (configError) {
    // Editing an empty fallback would overwrite the stored approvals on save.
    body = (
      <div className="flex flex-col items-center justify-center py-8 gap-2 text-center text-ui-danger" role="alert">
        <span className="text-sm font-semibold">{configError}</span>
        <span className="text-xs text-ui-danger">Editing is unavailable until the current passenger routes load. Check your connection or admin access.</span>
      </div>
    );
  } else if (routesError) {
    body = (
      <div className="flex flex-col items-center justify-center py-8 gap-2 text-center text-ui-danger" role="alert">
        <AlertCircle className="size-6" aria-hidden="true" />
        <span className="text-sm font-semibold">{routesError}</span>
        <span className="text-xs text-ui-danger">Routes are needed to choose what passengers see.</span>
        <button
          type="button"
          onClick={retryRoutes}
          className="mt-1 min-h-11 rounded-lg bg-ui-hover px-4 py-2 text-xs font-semibold text-ui-ink"
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
          <div className="flex items-start gap-1.5 bg-ui-warning/10 border border-ui-warning/20 rounded-lg px-3 py-2 text-xs text-ui-warning" role="note">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>
              {removedRouteCount === 1
                ? "1 previously published route was deleted and will be removed when you save."
                : `${removedRouteCount} previously published routes were deleted and will be removed when you save.`}
            </span>
          </div>
        )}

        {sortedRoutes.length === 0 ? (
          <p className="text-sm text-ui-quiet">No routes exist yet. Create a route on the Routes page first.</p>
        ) : (
          <fieldset className="flex flex-col gap-2 min-w-0" disabled={saving}>
            <legend className="text-sm font-semibold text-ui-ink mb-1.5">Routes shown to passengers</legend>
            <p className="text-xs text-ui-quiet -mt-0.5 mb-1">
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
                      className={`flex items-center gap-3 min-h-11 px-3 py-2 rounded-xl border cursor-pointer transition-colors ${checked ? "border-ui-control bg-ui-soft" : "border-ui-line hover:bg-ui-paper"}`}
                    >
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={checked}
                        onChange={event => toggleRoute(route.id, event.target.checked)}
                        className="w-4 h-4 shrink-0 accent-emerald-500"
                      />
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: routeColor(route) }} aria-hidden="true" />
                      <span className="text-sm font-semibold text-ui-ink min-w-0 break-words flex-1">{route.name || route.id}</span>
                      <span className="text-xs text-ui-quiet shrink-0">{stopCount === 1 ? "1 stop" : `${stopCount} stops`}</span>
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
              className="rounded-xl border border-ui-line border-l-4 bg-ui-soft p-4 flex flex-col gap-3 min-w-0"
              style={{ borderLeftColor: color }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} aria-hidden="true" />
                <h3 id={headingId} className="font-bold text-ui-ink text-sm min-w-0 break-words">{routeName}</h3>
                <span className="text-xs text-ui-quiet ml-auto shrink-0">Stop times</span>
              </div>
              {stops.length === 0 ? (
                <p className="text-xs text-ui-quiet">This route has no stops yet.</p>
              ) : (
                <ol className="flex flex-col">
                  {stops.map((stop, index) => {
                    const name = stopLabel(stop);
                    const inputId = `${baseId}-time-${idPart(route.id)}-${idPart(stop.id)}`;
                    const errorId = `${inputId}-error`;
                    const time = approval.stopTimes[stop.id] ?? "";
                    // Blank times are flagged after a save attempt; other text once it is flagged, until it changes.
                    const problem: PassengerStopTimeProblem | undefined = time === ""
                      ? (showErrors ? "missing" : undefined)
                      : flaggedTimes.get(passengerStopTimeKey(route.id, stop.id)) === time ? "invalid" : undefined;
                    return (
                      <li
                        key={stop.id}
                        className="flex flex-col gap-2 py-2.5 border-t border-ui-line first:border-t-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                      >
                        <div className="flex items-center gap-3 min-w-0 sm:min-h-11">
                          <span
                            className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 text-ui-ink"
                            style={{ backgroundColor: color }}
                            aria-hidden="true"
                          >
                            {index + 1}
                          </span>
                          <span className="text-sm text-ui-ink font-medium min-w-0 break-words">{name}</span>
                        </div>
                        <div className="flex flex-col gap-1 pl-9 sm:pl-0 sm:w-40 sm:shrink-0">
                          <input
                            id={inputId}
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            placeholder="HH:MM"
                            disabled={saving}
                            value={time}
                            onChange={event => setStopTime(route.id, stop.id, event.target.value)}
                            onBlur={event => commitStopTime(route.id, stop.id, event.currentTarget.value)}
                            // Clicking in selects the whole time so typing replaces it; WebKit
                            // would otherwise drop the selection on that click's mouseup.
                            onMouseDown={event => { selectOnMouseUpRef.current = document.activeElement !== event.currentTarget; }}
                            onFocus={event => event.currentTarget.select()}
                            onMouseUp={event => {
                              if (!selectOnMouseUpRef.current) return;
                              selectOnMouseUpRef.current = false;
                              event.preventDefault();
                            }}
                            aria-label={`Time for ${name} on ${routeName}`}
                            aria-invalid={problem ? true : undefined}
                            aria-describedby={problem ? errorId : undefined}
                            className="input-rc h-11"
                            style={problem ? { borderColor: INVALID_BORDER } : undefined}
                          />
                          {problem && (
                            <p id={errorId} className="text-xs text-ui-danger">
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
            className="min-h-11 w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-accent text-ui-on-accent font-bold text-sm hover:bg-ui-accent-hover transition-colors shadow-lg disabled:opacity-50"
          >
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              : saved
              ? <><span className="text-ui-success">✓</span> Saved!</>
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
    <div className="bg-ui-paper border border-ui-line rounded-2xl p-5 flex flex-col gap-5 min-w-0">
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
