"use client";

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { usePassengerRouteConfig } from "@/hooks/usePassengerRouteConfig";
import { useRoutes } from "@/hooks/useRoutes";
import {
  buildPassengerRouteSchedules,
  formatStopTime,
  type PassengerRouteSchedule,
} from "@/lib/passengerRouteSchedule";
import { PASSENGER_NAV_HEIGHT_PX } from "./passengerFrame";

/**
 * Passenger "Routes" tab: the admin-approved routes with their stops and
 * configured times. Only what `buildPassengerRouteSchedules` returns is shown,
 * so unapproved or deleted routes never reach the page.
 */
export default function RoutesTab() {
  const { retry: retryRoutes } = useRoutes();
  // Remounting the body re-opens the schedule listener after a read failure;
  // the shared routes listener has its own retry.
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="flex-1 overflow-y-auto overscroll-contain flex flex-col pt-safe px-5" style={{ background: "var(--surface-0)" }}>
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

  if (configLoading || (routesLoading && routes.length === 0)) {
    return (
      <div className="flex items-center justify-center gap-2 py-12" role="status">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" style={{ color: "var(--text-tertiary)" }} />
        <p className="text-[13px] font-medium" style={{ color: "var(--text-tertiary)" }}>Loading routes…</p>
      </div>
    );
  }

  const schedules = buildPassengerRouteSchedules(config, routes);
  if (schedules.length === 0) {
    return (
      <div className="rounded-xl p-8 text-center flex flex-col items-center justify-center gap-2"
        style={{ background: "var(--surface-2)", border: "1px dashed var(--border-default)" }}>
        <p className="text-[13px] font-medium" style={{ color: "var(--text-tertiary)" }}>
          No routes published yet
        </p>
        <p className="text-[12px]" style={{ color: "var(--text-ghost)" }}>
          Route schedules will appear here once they are published.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {schedules.map(schedule => <RouteScheduleCard key={schedule.routeId} schedule={schedule} />)}
    </div>
  );
}

function RouteScheduleCard({ schedule }: { schedule: PassengerRouteSchedule }) {
  const headingId = `passenger-route-schedule-${schedule.routeId}`;
  const stopCount = schedule.stops.length;
  return (
    <section
      aria-labelledby={headingId}
      data-route-schedule={schedule.routeId}
      className="rounded-2xl p-5"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="size-3 shrink-0 rounded-full"
          style={{ background: schedule.color || "var(--text-tertiary)" }}
        />
        <h2 id={headingId} className="min-w-0 flex-1 break-words text-[17px] font-extrabold tracking-tight leading-snug" style={{ color: "var(--text-primary)" }}>
          {schedule.name}
        </h2>
        <span className="shrink-0 text-[12px] font-semibold" style={{ color: "var(--text-tertiary)" }}>
          {stopCount === 1 ? "1 stop" : `${stopCount} stops`}
        </span>
      </div>

      {stopCount === 0 ? (
        <p className="mt-4 text-[13px] text-center" style={{ color: "var(--text-ghost)" }}>
          No stops listed for this route yet
        </p>
      ) : (
        <ol
          aria-label={`${schedule.name} stops`}
          className="relative mt-5 before:absolute before:inset-y-2 before:left-1/2 before:w-[3px] before:-translate-x-1/2 before:rounded-full before:bg-[var(--accent)] before:content-['']"
        >
          {schedule.stops.map((stop, index) => {
            const side = index % 2 === 0 ? "left" : "right";
            const terminal = index === 0 || index === stopCount - 1;
            return (
              <li
                key={stop.id}
                data-side={side}
                className="relative grid grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)] items-center py-2.5"
              >
                <div className={`row-start-1 min-w-0 ${side === "left" ? "col-start-1 text-right pr-1" : "col-start-3 text-left pl-1"}`}>
                  <p className="break-words text-[14px] font-bold leading-snug" style={{ color: "var(--text-primary)" }}>
                    {stop.name}
                  </p>
                  <span className="sr-only">, </span>
                  {stop.time ? (
                    <p className="mt-1 text-[12px] font-semibold tabular-nums" style={{ color: "var(--status-live)" }}>
                      {formatStopTime(stop.time)}
                    </p>
                  ) : (
                    <p className="mt-1 text-[12px] font-medium" style={{ color: "var(--text-ghost)" }}>
                      Time not set
                    </p>
                  )}
                </div>
                <span
                  aria-hidden="true"
                  className="col-start-2 row-start-1 size-3.5 justify-self-center rounded-full"
                  style={{
                    background: terminal ? "var(--accent)" : "var(--surface-2)",
                    border: "3px solid var(--accent)",
                  }}
                />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
