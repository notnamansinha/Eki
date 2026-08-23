"use client";

import { useBuses } from "@/hooks/useBuses";
import { useCollection } from "@/hooks/useCollection";
import { useDrivers } from "@/hooks/useDrivers";
import { useRoutes } from "@/hooks/useRoutes";
import {
  ARRIVAL_STOP_UNAVAILABLE,
  RIDE_HISTORY_DELETE_WARNING,
  canDeleteRideHistory,
  dedupeStopRecords,
  destinationReachedAt,
  mergeRideHistorySessions,
  resolveArrivalStopName,
  rideHistoryDeletionTransition,
  timestampDate,
  type RideStopRecord,
  type TimestampValue,
  type RideHistoryDeletionAction,
  type RideHistoryDeletionState,
} from "@/lib/rideHistory";
import { auth } from "@/lib/firebaseAuth";
import { apiRequest } from "@/lib/apiClient";
import { errorMessage } from "@/lib/errors";
import { Bus, Loader2, MapPin, Trash2, User, Users, AlertCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { directionLabel, normalizeRideDirection } from "@/lib/rideDirection";

interface PassengerRecord {
  userId: string;
  userName: string;
  boardingStopId: string;
  alightingStopId: string | null;
  joinedAt: TimestampValue;
}

interface RideSession {
  id: string;
  busId: string;
  driverId: string;
  routeId: string;
  armedAt?: TimestampValue;
  startTime?: TimestampValue;
  endTime?: TimestampValue;
  status: "pending" | "armed" | "active" | "completed" | "failed" | "interrupted";
  passengers?: PassengerRecord[] | Record<string, PassengerRecord>;
  path?: { lat: number; lng: number; timestamp: TimestampValue }[];
  stopsReached?: RideStopRecord[] | Record<string, RideStopRecord>;
  direction?: "forward" | "reverse";
  originStopId?: string | null;
  destinationStopId?: string | null;
}

const SERVICE_TIME_ZONE =
  process.env.NEXT_PUBLIC_SERVICE_TIME_ZONE || "Asia/Kolkata";

const STATUS_CONFIG: Record<
  RideSession["status"],
  { label: string; className: string }
> = {
  pending: { label: "Not started", className: "bg-white/10 text-white/60" },
  armed: { label: "Ready", className: "bg-sky-500/20 text-sky-300" },
  active: { label: "In progress", className: "bg-green-500/20 text-green-400" },
  completed: { label: "Completed", className: "bg-white/10 text-white/60" },
  failed: { label: "Failed", className: "bg-red-500/20 text-red-300" },
  interrupted: { label: "Ended early", className: "bg-amber-500/15 text-amber-300" },
};

function passengerRecords(passengers: RideSession["passengers"]): PassengerRecord[] {
  if (!passengers) return [];
  return Array.isArray(passengers) ? passengers : Object.values(passengers);
}

function stopRecords(stops: RideSession["stopsReached"]): RideStopRecord[] {
  if (!stops) return [];
  return dedupeStopRecords(Array.isArray(stops) ? stops : Object.values(stops));
}

function formatServiceDate(value: TimestampValue): string {
  const date = timestampDate(value);
  return date
    ? new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: SERVICE_TIME_ZONE,
      }).format(date)
    : "Date not recorded";
}

function formatServiceTime(value: TimestampValue): string {
  const date = timestampDate(value);
  return date
    ? new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: SERVICE_TIME_ZONE,
      }).format(date)
    : "Not recorded";
}

async function deleteRideHistoryRequest(sessionId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Ride history service is unavailable.");
  }
  const token = await currentUser.getIdToken();
  await apiRequest(
    `/api/shifts/${encodeURIComponent(sessionId)}/history`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      fallbackError: "Unable to delete ride history.",
    },
  );
}

export default function RideHistoryPanel() {
  const {
    data: armedSessions,
    loading: armedSessionsLoading,
    error: armedSessionsError,
    retry: retryArmedSessions,
  } = useCollection<RideSession>(
    "ride_sessions",
    {
      maxResults: 100,
      orderByDirection: "desc",
      orderByField: "armedAt",
    },
  );
  const {
    data: startedSessions,
    loading: startedSessionsLoading,
    error: startedSessionsError,
    retry: retryStartedSessions,
  } = useCollection<RideSession>(
    "ride_sessions",
    {
      maxResults: 100,
      orderByDirection: "desc",
      orderByField: "startTime",
    },
  );
  const sessions = useMemo(
    () => mergeRideHistorySessions(armedSessions, startedSessions),
    [armedSessions, startedSessions],
  );
  const sessionsLoading = armedSessionsLoading || startedSessionsLoading;
  const sessionsError = armedSessionsError ?? startedSessionsError;
  const retrySessions = () => {
    retryArmedSessions();
    retryStartedSessions();
  };
  const { buses, loading: busesLoading, error: busesError, retry: retryBuses } = useBuses();
  const { routes, loading: routesLoading, error: routesError, retry: retryRoutes } = useRoutes();
  const { drivers, loading: driversLoading } = useDrivers();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteStates, setDeleteStates] = useState<Record<string, RideHistoryDeletionState>>({});
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const deletionInFlight = useRef(new Set<string>());

  const busNames = useMemo(
    () => new Map(buses.map((bus) => [bus.id, bus.name])),
    [buses],
  );
  const routeNames = useMemo(
    () => new Map(routes.map((route) => [route.id, route.name])),
    [routes],
  );
  const routeStops = useMemo(
    () => new Map(routes.map((route) => [route.id, route.stops])),
    [routes],
  );
  const driverNames = useMemo(
    () => new Map(drivers.map((driver) => [driver.id, driver.name])),
    [drivers],
  );

  const updateDeleteState = (sessionId: string, action: RideHistoryDeletionAction) => {
    setDeleteStates((current) => ({
      ...current,
      [sessionId]: rideHistoryDeletionTransition(current[sessionId] ?? "idle", action),
    }));
  };

  const openDeleteConfirmation = (sessionId: string) => {
    updateDeleteState(sessionId, "open");
    setDeleteErrors((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  };

  const cancelDeleteConfirmation = (sessionId: string) => {
    updateDeleteState(sessionId, "cancel");
    setDeleteErrors((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  };

  const handleDeleteHistory = async (sessionId: string) => {
    if (deletionInFlight.current.has(sessionId)) return;
    deletionInFlight.current.add(sessionId);
    updateDeleteState(sessionId, "confirm");
    setDeleteErrors((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    try {
      await deleteRideHistoryRequest(sessionId);
      updateDeleteState(sessionId, "success");
      setExpandedId(null);
    } catch (error) {
      updateDeleteState(sessionId, "failure");
      setDeleteErrors((current) => ({
        ...current,
        [sessionId]: errorMessage(error),
      }));
    } finally {
      deletionInFlight.current.delete(sessionId);
    }
  };

  if (sessionsLoading || busesLoading || routesLoading || driversLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-8 animate-spin text-brand-accent" />
      </div>
    );
  }

  if (sessionsError || busesError || routesError) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="space-y-2 text-sm text-red-400/80">
          <AlertCircle className="mx-auto size-8 opacity-70" />
          <p>{sessionsError ?? busesError ?? routesError ?? "Could not load ride history."}</p>
          <p className="text-xs text-white/40">Ride history could not be loaded.</p>
          <button
            type="button"
            onClick={() => {
              if (sessionsError) retrySessions();
              if (busesError) retryBuses();
              if (routesError) retryRoutes();
            }}
            className="rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 animate-slide-up sm:p-6">
      <h2 className="mb-4 text-balance text-xl font-bold text-white">Ride History</h2>
      {sessions.length === 0 ? (
        <div className="py-10 text-center text-sm text-white/50">
          No rides recorded yet.
        </div>
      ) : (
        sessions.map((session) => {
          const passengers = passengerRecords(session.passengers);
          const stopsReached = stopRecords(session.stopsReached);
          const status = STATUS_CONFIG[session.status] ?? STATUS_CONFIG.failed;
          const startValue = session.startTime ?? session.armedAt;
          const deleteState = deleteStates[session.id] ?? "idle";

          return (
            <div
              key={session.id}
              className="overflow-hidden rounded-xl border border-white/10 bg-brand-surface transition-all"
            >
              <button
                type="button"
                className="flex w-full cursor-pointer flex-col justify-between gap-4 p-4 text-left hover:bg-white/5 sm:flex-row sm:items-center"
                onClick={() => setExpandedId(expandedId === session.id ? null : session.id)}
                aria-expanded={expandedId === session.id}
                aria-controls={`ride-history-details-${session.id}`}
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${status.className}`}>
                      {status.label}
                    </span>
                    <span className="text-sm font-semibold text-white/80 tabular-nums">
                      {formatServiceDate(startValue)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60 tabular-nums">
                    <span><span className="text-white/40">Started</span> {formatServiceTime(startValue)}</span>
                    {session.status !== "active" && session.status !== "armed" && session.status !== "pending" && (
                      <span>
                        <span className="text-white/40">
                          {session.status === "interrupted" ? "Last recorded" : "Ended"}
                        </span>{" "}
                        {formatServiceTime(session.endTime)}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3" />
                      Route: {routeNames.get(session.routeId) || "Unavailable route"}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3" />
                      Direction: {directionLabel(
                        normalizeRideDirection(session.direction),
                        routeStops.get(session.routeId) ?? [],
                      )}
                    </span>
                    <span className="flex items-center gap-1">
                      <Bus className="size-3" />
                      Bus: {busNames.get(session.busId) || "Unavailable bus"}
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="size-3" />
                      Driver: {driverNames.get(session.driverId) || "Unavailable driver"}
                    </span>
                  </div>
                  {session.status === "interrupted" && (
                    <p className="text-pretty text-xs text-amber-200/70">
                      The ride ended before the final stop was recorded.
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-brand-dark/50 px-3 py-1.5">
                    <Users className="size-4 text-brand-accent" />
                    <span className="text-sm font-bold text-white tabular-nums">{passengers.length}</span>
                  </div>
                </div>
              </button>

              {expandedId === session.id && (
                <div id={`ride-history-details-${session.id}`} className="border-t border-white/10 bg-black/20 px-4 pt-4 pb-4">
                  <h4 className="mb-3 text-xs font-semibold uppercase text-white/50">
                    Passenger Manifest
                  </h4>
                  {passengers.length === 0 ? (
                    <p className="text-pretty text-xs italic text-white/30">No passengers boarded.</p>
                  ) : (
                    <div className="space-y-2">
                      {passengers.map((passenger, index) => {
                        const arrivalStopName = resolveArrivalStopName(
                          passenger.alightingStopId,
                          stopsReached,
                          routeStops.get(session.routeId) ?? [],
                        );
                        const reachedAt = destinationReachedAt(
                          passenger.alightingStopId,
                          passenger.joinedAt,
                          stopsReached,
                        );
                        return (
                          <div
                            key={`${passenger.userId}-${index}`}
                            className="flex flex-col gap-2 rounded border border-white/5 bg-white/5 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                          >
                            <span className="truncate font-medium text-white/90">
                              {passenger.userName || "Unknown passenger"}
                            </span>
                            <div className="flex flex-col text-xs text-white/60 tabular-nums sm:items-end">
                              {arrivalStopName === ARRIVAL_STOP_UNAVAILABLE ? (
                                <span>{ARRIVAL_STOP_UNAVAILABLE}</span>
                              ) : (
                                <span>
                                  <span className="text-white/40">Arrival stop:</span>{" "}
                                  {arrivalStopName}
                                </span>
                              )}
                              <span><span className="text-white/40">Recorded</span> {formatServiceTime(passenger.joinedAt)}</span>
                              {reachedAt === null ? (
                                <span>Destination time not recorded</span>
                              ) : (
                                <span>
                                  <span className="text-white/40">Destination reached</span>{" "}
                                  {formatServiceTime(reachedAt)}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {stopsReached.length > 0 && (
                    <div className="mt-4 border-t border-white/10 pt-4">
                      <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase text-white/50">
                        <MapPin className="size-3" />
                        Route Log
                      </h4>
                      <div className="relative space-y-3 before:absolute before:inset-0 before:ml-[39px] before:h-full before:w-0.5 before:-translate-x-px before:bg-white/10 md:before:mx-auto md:before:translate-x-0">
                        {stopsReached.map((stop) => (
                          <div
                            key={`${stop.stopIndex}-${stop.stopId}`}
                            className="group relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse"
                          >
                            <div className="z-10 ml-7 flex size-6 shrink-0 items-center justify-center rounded-full border border-white/20 bg-brand-dark text-brand-accent shadow md:order-1 md:ml-0 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2">
                              <div className="size-2 rounded-full bg-brand-accent" />
                            </div>
                            <div className="w-[calc(100%-4rem)] rounded border border-white/10 bg-white/5 p-3 md:w-[calc(50%-2.5rem)]">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-bold text-white">
                                  {stop.stopName || "Unnamed stop"}
                                </span>
                                <span className="shrink-0 text-xs text-brand-accent tabular-nums">
                                  {formatServiceTime(stop.timestamp)}
                                </span>
                              </div>
                              <p className="text-xs text-white/50 tabular-nums">Stop {stop.stopIndex + 1}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {canDeleteRideHistory(session.status) && (
                    <div className="mt-4 border-t border-red-500/20 pt-4">
                      {deleteState === "idle" ? (
                        <button
                          type="button"
                          onClick={() => openDeleteConfirmation(session.id)}
                          className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20"
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                          Delete ride history
                        </button>
                      ) : (
                        <div
                          className="rounded-lg border border-red-500/30 bg-red-500/10 p-3"
                          role="alertdialog"
                          aria-labelledby={`delete-history-title-${session.id}`}
                          aria-describedby={`delete-history-warning-${session.id}`}
                        >
                          <h5
                            className="text-balance text-sm font-semibold text-red-200"
                            id={`delete-history-title-${session.id}`}
                          >
                            Permanently delete ride history?
                          </h5>
                          <p
                            className="mt-1 text-pretty text-xs text-red-200/70"
                            id={`delete-history-warning-${session.id}`}
                          >
                            {RIDE_HISTORY_DELETE_WARNING}
                          </p>
                          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <button
                              type="button"
                              onClick={() => cancelDeleteConfirmation(session.id)}
                              disabled={deleteState === "deleting"}
                              className="min-h-10 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteHistory(session.id)}
                              disabled={deleteState === "deleting"}
                              className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-500/40 bg-red-500 px-3 py-2 text-xs font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {deleteState === "deleting" && (
                                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                              )}
                              {deleteState === "deleting" ? "Deleting…" : "Permanently delete"}
                            </button>
                          </div>
                          {deleteErrors[session.id] && (
                            <p className="mt-2 text-pretty text-xs text-red-200" role="alert">
                              {deleteErrors[session.id]}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
