"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AlertCircle, Bus, ChevronDown, Clock, Flag, Loader2, MapPin, Timer } from "lucide-react";
import { usePassengerRouteConfig } from "@/hooks/usePassengerRouteConfig";
import { useRoutes, type RouteStop } from "@/hooks/useRoutes";
import { getDistanceMeters } from "@/lib/mapUtils";
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
  const position = useGrantedPosition();
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
          closestStopId={position ? closestStopId(routes.find(route => route.id === schedule.routeId)?.stops, position) : null}
          defaultOpen={schedules.length === 1}
        />
      ))}
    </div>
  );
}

/** Stops farther than this are not "closest" in any useful sense. */
const CLOSEST_STOP_MAX_METERS = 1_500;

/**
 * The passenger's position, read once, only when location access was already
 * granted elsewhere in the app. The Routes tab never prompts for it.
 */
function useGrantedPosition(): { lat: number; lng: number } | null {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation || !navigator.permissions?.query) return;
    let alive = true;
    navigator.permissions.query({ name: "geolocation" }).then(status => {
      if (!alive || status.state !== "granted") return;
      navigator.geolocation.getCurrentPosition(
        fix => { if (alive) setPosition({ lat: fix.coords.latitude, lng: fix.coords.longitude }); },
        () => {},
        { maximumAge: 60_000, timeout: 10_000 },
      );
    }, () => {});
    return () => { alive = false; };
  }, []);
  return position;
}

function closestStopId(stops: readonly RouteStop[] | undefined, position: { lat: number; lng: number }): string | null {
  let best: { id: string; meters: number } | null = null;
  for (const stop of stops ?? []) {
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) continue;
    const meters = getDistanceMeters(position, stop);
    if (meters <= CLOSEST_STOP_MAX_METERS && (!best || meters < best.meters)) best = { id: stop.id, meters };
  }
  return best?.id ?? null;
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
function RouteScheduleCard({ schedule, buses, closestStopId, defaultOpen }: {
  schedule: PassengerRouteSchedule;
  /** null when bus details could not be read. */
  buses: BusData[] | null;
  /** The stop nearest the passenger, when their location is known. */
  closestStopId: string | null;
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
              className={`size-5 transition-transform duration-300 ${EASE_SMOOTH} motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
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
        className={`grid transition-[grid-template-rows] duration-300 ${EASE_SMOOTH} motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
            <RouteBuses routeName={schedule.name} buses={buses} />
            {stopCount === 0 ? (
              <p className="px-4 py-5 text-center text-[13px]" style={{ color: "var(--text-ghost)" }}>
                No stops listed for this route yet
              </p>
            ) : (
              <StopTimeline schedule={schedule} closestStopId={closestStopId} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Distance from a row's top to its dot's centre: the middle of the name's first line. */
const DOT_Y_PX = 26;
/** Length of the stop open/close animation; a closing stop stays mounted this long. */
const STOP_DETAILS_MS = 300;
/** Ease-out with a soft landing, shared by every Routes tab expansion. */
const EASE_SMOOTH = "ease-[cubic-bezier(0.22,1,0.36,1)]";

/** "07:05" → minutes after midnight. Times are already validated "HH:mm". */
function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Scheduled minutes from one time to a later one, through midnight if needed. */
function minutesBetween(from: string, to: string): number {
  return (minutesOfDay(to) - minutesOfDay(from) + 1440) % 1440;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * The route's stops on one continuous rail. Tapping a stop opens it in place:
 * a larger filled dot, the time in a clock pill, and where the stop sits on
 * the route. The stop nearest the passenger, when known, starts open.
 */
function StopTimeline({ schedule, closestStopId }: {
  schedule: PassengerRouteSchedule;
  closestStopId: string | null;
}) {
  // undefined until the passenger picks (or closes) a stop themselves.
  const [chosenStopId, setChosenStopId] = useState<string | null>();
  // The stop that was just closed stays mounted until it has slid shut.
  const [closingStopId, setClosingStopId] = useState<string | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const scrollTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => {
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(scrollTimer.current);
  }, []);
  const selectedStopId = chosenStopId === undefined ? closestStopId : chosenStopId;
  const stops = schedule.stops;
  const first = stops[0];
  const last = stops[stops.length - 1];
  const detailsIdOf = (stopId: string) => `passenger-route-${schedule.routeId}-stop-${stopId}`;

  const select = (next: string | null) => {
    if (selectedStopId && selectedStopId !== next) {
      setClosingStopId(selectedStopId);
      window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => setClosingStopId(null), STOP_DETAILS_MS);
    }
    setChosenStopId(next);
    window.clearTimeout(scrollTimer.current);
    if (next) {
      // Once it has opened, bring the whole stop into view above the navigation bar.
      scrollTimer.current = window.setTimeout(() => {
        document.getElementById(detailsIdOf(next))?.scrollIntoView?.({
          block: "nearest",
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        });
      }, STOP_DETAILS_MS);
    }
  };

  return (
    <ol aria-label={`${schedule.name} stops`} className="pt-1 pb-2">
      {stops.map((stop, index) => {
        const isFirst = index === 0;
        const isLast = index === stops.length - 1;
        const isSelected = stop.id === selectedStopId;
        const isClosing = !isSelected && stop.id === closingStopId;
        const isClosest = stop.id === closestStopId;
        const detailsId = detailsIdOf(stop.id);
        const sinceFirst = !isFirst && stop.time && first.time ? minutesBetween(first.time, stop.time) : null;
        const facts = [
          { icon: MapPin, text: isFirst ? "First stop" : isLast ? "Last stop" : `Stop ${index + 1} of ${stops.length}` },
          ...(sinceFirst !== null ? [{ icon: Timer, text: `${formatDuration(sinceFirst)} from ${first.name}` }] : []),
          ...(!isLast && last.time ? [{ icon: Flag, text: `Reaches ${last.name} at ${formatStopTime(last.time)}` }] : []),
        ];
        return (
          <li key={stop.id} data-stop-selected={isSelected || undefined} className="flex items-stretch gap-3.5 px-4">
            {/* Rail: each row draws the halves of the line that meet its dot,
                so the line starts at the first stop and ends at the last. */}
            <span aria-hidden="true" data-rail className="relative w-5 shrink-0">
              {!isFirst && (
                <span className="absolute left-1/2 top-0 w-1 -translate-x-1/2" style={{ height: DOT_Y_PX, background: "var(--routes-accent)" }} />
              )}
              {!isLast && (
                <span className="absolute left-1/2 bottom-0 w-1 -translate-x-1/2" style={{ top: DOT_Y_PX, background: "var(--routes-accent)" }} />
              )}
              {/* A slight overshoot lets the opened dot settle rather than snap. */}
              <span
                data-rail-dot
                className={`absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[width,height,box-shadow,background-color,border-color] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none ${isSelected ? "size-5" : "size-3.5"}`}
                style={{
                  top: DOT_Y_PX,
                  background: isSelected || isFirst || isLast ? "var(--routes-accent)" : "var(--surface-3)",
                  border: `3px solid ${isSelected ? "var(--routes-accent-text)" : "var(--routes-accent)"}`,
                  boxShadow: isSelected ? "0 0 0 5px rgba(176, 48, 63, 0.3)" : "0 0 0 0 rgba(176, 48, 63, 0)",
                }}
              />
            </span>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                aria-expanded={isSelected}
                aria-controls={isSelected ? detailsId : undefined}
                onClick={() => select(isSelected ? null : stop.id)}
                className={`-mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded-xl px-2 pt-4 text-left transition-[padding,background-color] duration-300 ${EASE_SMOOTH} active:bg-white/[0.04] motion-reduce:transition-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--routes-accent-text)] ${isSelected ? "pb-2" : "pb-4"}`}
              >
                <span className="min-w-0 flex-1">
                  <span
                    data-stop-name
                    className={`block break-words leading-5 transition-[font-size,color] duration-300 ${EASE_SMOOTH} motion-reduce:transition-none ${isSelected ? "text-[15.5px] font-black" : isFirst || isLast ? "text-[14.5px] font-black" : "text-[14.5px] font-bold"}`}
                    style={{ color: isSelected || isFirst || isLast ? "var(--text-primary)" : "var(--text-secondary)" }}
                  >
                    {stop.name}
                  </span>
                  {isClosest && (
                    <span data-closest-stop className="mt-0.5 block text-[12px] font-bold" style={{ color: "var(--routes-accent-text)" }}>
                      <span className="sr-only">, </span>Closest stop
                    </span>
                  )}
                </span>
                <span className="sr-only">, </span>
                {/* Every time keeps the pill's box, so opening only fades the
                    pill in and nothing shifts sideways. */}
                <span
                  data-stop-time={isSelected && stop.time ? "pill" : ""}
                  className={`-my-1 inline-flex shrink-0 items-center rounded-lg border px-2 py-1 leading-5 transition-[background-color,border-color] duration-300 ${EASE_SMOOTH} motion-reduce:transition-none ${stop.time ? "text-[13.5px] font-black tabular-nums" : "text-[11.5px] font-bold"}`}
                  style={{
                    color: stop.time ? "var(--status-live)" : "var(--text-ghost)",
                    background: isSelected && stop.time ? "var(--surface-2)" : "transparent",
                    borderColor: isSelected && stop.time ? "var(--border-default)" : "transparent",
                  }}
                >
                  {stop.time && (
                    <span
                      aria-hidden="true"
                      className={`inline-flex overflow-hidden transition-[width,margin,opacity] duration-300 ${EASE_SMOOTH} motion-reduce:transition-none ${isSelected ? "mr-1.5 w-3.5 opacity-100" : "mr-0 w-0 opacity-0"}`}
                    >
                      <Clock className="size-3.5 shrink-0" strokeWidth={2.75} />
                    </span>
                  )}
                  {stop.time ? formatStopTime(stop.time) : "Time not set"}
                </span>
              </button>
              {(isSelected || isClosing) && (
                // grid-rows 0fr → 1fr slides the details to their height;
                // @starting-style gives the opening frame to slide from.
                <div
                  id={detailsId}
                  data-stop-details={isSelected ? "open" : "closing"}
                  inert={!isSelected}
                  aria-hidden={isSelected ? undefined : true}
                  className={`grid transition-[grid-template-rows,opacity] duration-300 ${EASE_SMOOTH} motion-reduce:transition-none starting:grid-rows-[0fr] starting:opacity-0 ${isSelected ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                  style={{ scrollMarginBottom: `calc(${PASSENGER_NAV_HEIGHT_PX + 32}px + var(--safe-area-bottom))` }}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="pb-4">
                      <p className="text-[12.5px] font-bold" style={{ color: "var(--text-secondary)" }}>
                        {stop.time ? "Scheduled time" : "No time scheduled for this stop yet"}
                      </p>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {facts.map((fact, factIndex) => (
                          <StopFact key={fact.text} icon={fact.icon} delayMs={60 + factIndex * 50}>{fact.text}</StopFact>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A small read-only fact about the open stop, in the tab's maroon tint; fades up just after the stop opens. */
function StopFact({ icon: Icon, delayMs, children }: { icon: typeof MapPin; delayMs: number; children: ReactNode }) {
  return (
    <span
      data-stop-fact
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold leading-snug transition-[opacity,translate] duration-300 ${EASE_SMOOTH} motion-reduce:transition-none starting:translate-y-1 starting:opacity-0`}
      style={{ background: "rgba(176, 48, 63, 0.18)", color: "var(--routes-accent-text)", transitionDelay: `${delayMs}ms` }}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />
      <span className="min-w-0 break-words">{children}</span>
    </span>
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
