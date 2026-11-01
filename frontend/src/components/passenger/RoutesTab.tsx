"use client";

import { useState, type CSSProperties } from "react";
import { AlertCircle, Bus, ChevronDown, Loader2 } from "lucide-react";
import { usePassengerRouteConfig } from "@/hooks/usePassengerRouteConfig";
import { useRoutes } from "@/hooks/useRoutes";
import { useBuses, type BusData } from "@/hooks/useBuses";
import { useRouteUsage } from "@/hooks/useRouteUsage";
import {
  buildPassengerRouteSchedules,
  formatStopTime,
  type PassengerRouteSchedule,
} from "@/lib/passengerRouteSchedule";
import { PASSENGER_NAV_HEIGHT_PX } from "./passengerFrame";

/**
 * Passenger "Routes" tab: every route with its stops, the times an admin
 * configured, and the buses assigned to it. The most-ridden route (backend
 * counts in `settings/routeUsage`) comes first.
 */
/**
 * Maroon accent scoped to this tab; the rest of the app keeps `--accent`.
 * The base shade is for the rail, dots, border and icon tiles. Text and the
 * focus ring use the lighter tint, which keeps 5:1 contrast on `--surface-3`
 * where the base shade only reaches about 2.7:1.
 */
const ROUTES_THEME = {
  background: "var(--surface-0)",
  "--routes-accent": "#B0303F",
  "--routes-accent-text": "#E06A78",
} as CSSProperties;

export default function RoutesTab() {
  const { retry: retryRoutes } = useRoutes();
  const { retry: retryBuses } = useBuses();
  // Remounting the body re-opens the schedule listener after a read failure;
  // the shared routes listener has its own retry.
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="flex-1 overflow-y-auto overscroll-contain flex flex-col pt-safe px-5" style={ROUTES_THEME}>
      <div
        className="w-full max-w-lg mx-auto space-y-6 mt-10"
        style={{ paddingBottom: `calc(${PASSENGER_NAV_HEIGHT_PX + 47}px + var(--safe-area-bottom))` }}
      >
        <div className="text-center">
          <h1 className="text-[32px] font-black tracking-tight mb-2 leading-none" style={{ color: "var(--text-primary)" }}>
            Routes
          </h1>
          <p className="text-[15px] font-medium mt-2" style={{ color: "var(--text-secondary)" }}>
            Stops and scheduled times for each route.
          </p>
        </div>
        <RouteSchedules
          key={attempt}
          onRetry={() => {
            retryRoutes();
            retryBuses();
            setAttempt(value => value + 1);
          }}
        />
      </div>
    </div>
  );
}

function RouteSchedules({ onRetry }: { onRetry: () => void }) {
  const { config, loading: configLoading, error: configError } = usePassengerRouteConfig();
  const { routes, loading: routesLoading, error: routesError } = useRoutes();
  const { buses, loading: busesLoading, error: busesError } = useBuses();
  // Usage only orders the list; without it routes keep the admin's order.
  const { usage, loading: usageLoading } = useRouteUsage();
  const error = configError || routesError;

  if (error) {
    return (
      <div
        className="flex items-start gap-3 rounded-xl border border-red-400/20 bg-zinc-950 px-4 py-3 text-sm text-red-300 shadow-lg"
        role="alert"
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="flex-1">
          <p className="font-semibold">Route schedules could not be loaded.</p>
          <p className="mt-0.5 text-xs text-red-300/70">{error}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  // Wait for the ranking and bus details too, so cards do not jump or fill in late.
  if (configLoading || usageLoading || (routesLoading && routes.length === 0) || (busesLoading && buses.length === 0 && !busesError)) {
    return (
      <div className="flex items-center justify-center gap-2 py-12" role="status">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" style={{ color: "var(--text-tertiary)" }} />
        <p className="text-[13px] font-medium" style={{ color: "var(--text-tertiary)" }}>Loading routes…</p>
      </div>
    );
  }

  const schedules = buildPassengerRouteSchedules(config, routes, usage);
  if (schedules.length === 0) {
    return (
      <div className="rounded-xl p-8 text-center flex flex-col items-center justify-center gap-2"
        style={{ background: "var(--surface-2)", border: "1px dashed var(--border-default)" }}>
        <p className="text-[13px] font-medium" style={{ color: "var(--text-tertiary)" }}>
          No routes yet
        </p>
        <p className="text-[12px]" style={{ color: "var(--text-ghost)" }}>
          Routes will appear here once an administrator adds them.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {schedules.map(schedule => (
        <RouteScheduleCard
          key={schedule.routeId}
          schedule={schedule}
          buses={busesError ? null : busesForRoute(buses, schedule.routeId)}
          defaultOpen={schedules.length === 1}
        />
      ))}
    </div>
  );
}

/** Buses assigned to a route (including the legacy single assignment), by bus number. */
function busesForRoute(buses: readonly BusData[], routeId: string): BusData[] {
  return buses
    .filter(bus => (Array.isArray(bus.assignedRoutes) && bus.assignedRoutes.includes(routeId)) || bus.assignedRouteId === routeId)
    .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true, sensitivity: "base" }));
}

/**
 * First and last configured times in stop order. The am/pm is written once
 * when both share it ("7:30 – 8:05 am"), which keeps the summary on one line
 * on a 320 px phone; otherwise both carry it ("11:50 am – 12:10 pm").
 */
function serviceWindow(schedule: PassengerRouteSchedule): string | null {
  const times = schedule.stops.flatMap(stop => (stop.time ? [stop.time] : []));
  if (times.length === 0) return null;
  const first = formatStopTime(times[0]);
  if (times.length === 1) return first;
  const last = formatStopTime(times[times.length - 1]);
  const [firstClock, firstPeriod] = first.split(" ");
  return firstPeriod === last.split(" ")[1] ? `${firstClock} – ${last}` : `${first} – ${last}`;
}

/**
 * One collapsible card per route, sized for phones: the name, direction and
 * summary share one column beside a round chevron, so a collapsed card stays
 * three short lines even at 320 px. The whole header toggles the panel.
 */
function RouteScheduleCard({ schedule, buses, defaultOpen }: {
  schedule: PassengerRouteSchedule;
  /** null when bus details could not be read. */
  buses: BusData[] | null;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const headingId = `passenger-route-schedule-${schedule.routeId}`;
  const panelId = `${headingId}-stops`;
  const stopCount = schedule.stops.length;
  const first = schedule.stops[0];
  const last = schedule.stops[stopCount - 1];
  const timeWindow = serviceWindow(schedule);
  return (
    <section
      aria-labelledby={headingId}
      data-route-schedule={schedule.routeId}
      data-open={open}
      className="overflow-hidden rounded-[20px] border"
      style={{
        background: "var(--surface-3)",
        borderColor: "var(--border-subtle)",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
      }}
    >
      <div className="relative px-4 py-3.5">
        {/* Stretched toggle: the whole header is the tap target while the
            heading stays a plain heading for screen-reader navigation. */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${schedule.name} schedule`}
          onClick={() => setOpen(value => !value)}
          className="absolute inset-0 z-10 rounded-t-[20px] transition-colors active:bg-white/[0.03] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--routes-accent-text)]"
        />
        <div className="pointer-events-none flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: schedule.color || "var(--text-tertiary)" }}
              />
              <h2
                id={headingId}
                className="min-w-0 break-words text-[19px] font-black leading-tight tracking-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {schedule.name}
              </h2>
            </div>
            <p
              data-route-direction={stopCount > 1 ? "" : undefined}
              className="mt-1 break-words text-[13.5px] font-bold leading-snug"
              style={{ color: "var(--text-secondary)" }}
            >
              {stopCount > 1 ? (
                <>
                  {first.name}
                  <span aria-hidden="true" className="mx-1 opacity-60">&rarr;</span>
                  <span className="sr-only"> to </span>
                  {last.name}
                </>
              ) : stopCount === 1 ? first.name : "No stops listed yet"}
            </p>
            {/* Each separator travels with the item after it, so a wrap never
                leaves a dangling dot at the end of a line. */}
            <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11.5px] font-black" style={{ color: "var(--text-tertiary)" }}>
              <span className="whitespace-nowrap">{stopCount === 1 ? "1 stop" : `${stopCount} stops`}</span>
              <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                <span aria-hidden="true" className="self-center text-[10px] opacity-30">&bull;</span>
                <span className="text-white">{timeWindow ?? "Times not set"}</span>
              </span>
              {schedule.completedRides !== null && (
                <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                  <span aria-hidden="true" className="self-center text-[10px] opacity-30">&bull;</span>
                  <span data-ride-count>
                    {schedule.completedRides === 1 ? "1 ride" : `${schedule.completedRides.toLocaleString("en-IN")} rides`}
                  </span>
                </span>
              )}
            </div>
          </div>
          <span
            aria-hidden="true"
            data-toggle-chevron
            className="flex size-9 shrink-0 items-center justify-center"
            style={{ color: "var(--routes-accent-text)" }}
          >
            <ChevronDown
              className={`size-5 transition-transform duration-300 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
              strokeWidth={3}
            />
          </span>
        </div>
      </div>

      {/* grid-rows 0fr → 1fr animates the drop-down to the content's height. */}
      <div
        id={panelId}
        inert={!open}
        aria-hidden={!open}
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
            <RouteBuses routeName={schedule.name} buses={buses} />
            {stopCount === 0 ? (
              <p className="px-4 py-5 text-center text-[13px]" style={{ color: "var(--text-ghost)" }}>
                No stops listed for this route yet
              </p>
            ) : (
              <ol aria-label={`${schedule.name} stops`} className="pt-1.5 pb-2">
                {schedule.stops.map((stop, index) => {
                  const isFirst = index === 0;
                  const isLast = index === stopCount - 1;
                  return (
                    <li key={stop.id} className="flex min-h-12 items-stretch gap-3.5 px-4">
                      {/* Rail: each row draws the halves of the line that meet its dot,
                          so the line starts at the first stop and ends at the last. */}
                      <span aria-hidden="true" data-rail className="relative w-3.5 shrink-0">
                        {!isFirst && (
                          <span className="absolute left-1/2 top-0 h-1/2 w-[3px] -translate-x-1/2" style={{ background: "var(--routes-accent)" }} />
                        )}
                        {!isLast && (
                          <span className="absolute left-1/2 bottom-0 h-1/2 w-[3px] -translate-x-1/2" style={{ background: "var(--routes-accent)" }} />
                        )}
                        <span
                          data-rail-dot
                          className="absolute left-1/2 top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                          style={{
                            background: isFirst || isLast ? "var(--routes-accent)" : "var(--surface-3)",
                            border: "3px solid var(--routes-accent)",
                          }}
                        />
                      </span>
                      <div className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5">
                        <p
                          className={`min-w-0 flex-1 break-words text-[14.5px] leading-snug ${isFirst || isLast ? "font-black" : "font-bold"}`}
                          style={{ color: isFirst || isLast ? "var(--text-primary)" : "var(--text-secondary)" }}
                        >
                          {stop.name}
                        </p>
                        <span className="sr-only">, </span>
                        {stop.time ? (
                          <p data-stop-time className="shrink-0 text-[13px] font-black tabular-nums" style={{ color: "var(--status-live)" }}>
                            {formatStopTime(stop.time)}
                          </p>
                        ) : (
                          <p data-stop-time className="shrink-0 text-[11.5px] font-bold" style={{ color: "var(--text-ghost)" }}>
                            Time not set
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * One line per bus on the route, "bus number - bus name" ("bus_03 - Campus
 * Hopper"), or just the number when the bus has no name.
 */
function RouteBuses({ routeName, buses }: { routeName: string; buses: BusData[] | null }) {
  const busIcon = <Bus aria-hidden="true" className="size-4 shrink-0" style={{ color: "var(--routes-accent-text)" }} />;
  if (buses === null || buses.length === 0) {
    return (
      <p className="flex items-center gap-2 px-4 pt-3.5 pb-1 text-[13px]" style={{ color: "var(--text-ghost)" }}>
        {busIcon}
        {buses === null ? "Bus details could not be loaded." : "No bus assigned to this route yet"}
      </p>
    );
  }
  return (
    <ul aria-label={`${routeName} buses`} className="flex flex-col gap-1.5 px-4 pt-3.5 pb-1">
      {buses.map(bus => (
        <li key={bus.id} className="flex items-start gap-2 text-[13.5px] leading-snug">
          <span className="mt-px">{busIcon}</span>
          <span className="min-w-0 break-words">
            <span className="font-black" style={{ color: "var(--text-primary)" }}>{bus.id}</span>
            {bus.name && <span className="font-bold" style={{ color: "var(--text-secondary)" }}> - {bus.name}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
