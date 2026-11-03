"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, ChevronRight, Search } from "lucide-react";
import { usePassengerRouteConfig } from "@/hooks/usePassengerRouteConfig";
import { useRoutes } from "@/hooks/useRoutes";
import {
  buildPassengerRouteSchedules,
  formatStopTime,
  type PassengerRouteSchedule,
} from "@/lib/passengerRouteSchedule";

function lineLabel(name: string) {
  const code = /^(?:line[ -]+)?(\d+[a-z]?)$/i.exec(name.trim())?.[1];
  if (code) return `Line ${code.toUpperCase()}`;
  const words = name.trim().split(/\s+/);
  const short = words.length > 1
    ? words.slice(0, 4).map(word => Array.from(word)[0]).join("")
    : Array.from(words[0]).slice(0, 6).join("");
  return short.toUpperCase();
}

function LineBadge({ schedule }: { schedule: PassengerRouteSchedule }) {
  const accent = /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(schedule.color) ? schedule.color : undefined;
  return (
    <span className="schedule-line-badge" style={{ "--route-accent": accent } as CSSProperties}>
      <svg
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="4.5" y="3" width="15" height="16" rx="3" />
        <path d="M9.5 6h5M4.5 13h15M4.5 8.5h-2v3m17-3h2v3M7 19v2.5m10-2.5v2.5" />
        <circle cx="8" cy="16" r="1" fill="currentColor" stroke="none" />
        <circle cx="16" cy="16" r="1" fill="currentColor" stroke="none" />
      </svg>
      {lineLabel(schedule.name)}
    </span>
  );
}

function endpoints(schedule: PassengerRouteSchedule) {
  const first = schedule.stops[0]?.name;
  const last = schedule.stops.at(-1)?.name;
  if (first && last && first !== last) return `${first} → ${last}`;
  return first;
}

export default function RoutesTab() {
  const { retry } = useRoutes();
  // Reopen the published schedule listener as well as retrying the shared routes listener.
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="passenger-schedules">
      <RouteSchedules key={attempt} onRetry={() => { retry(); setAttempt(value => value + 1); }} />
    </div>
  );
}

function RouteSchedules({ onRetry }: { onRetry: () => void }) {
  const { config, loading: configLoading, error: configError } = usePassengerRouteConfig();
  const { routes, loading: routesLoading, error: routesError } = useRoutes();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const lastRow = useRef<HTMLButtonElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const detail = useRef<HTMLElement>(null);
  const focusNext = useRef<"list" | "detail" | null>(null);
  const error = configError || routesError;
  const loading = configLoading || (routesLoading && routes.length === 0);
  const schedules = buildPassengerRouteSchedules(config, routes);
  const query = search.trim().toLocaleLowerCase();
  const filtered = schedules.filter(schedule => !query ||
    [schedule.name, lineLabel(schedule.name), ...schedule.stops.map(stop => stop.name)]
      .some(value => value.toLocaleLowerCase().includes(query)));
  const selected = selectedId ? schedules.find(schedule => schedule.routeId === selectedId) : filtered[0];
  const selectedMissing = selectedId !== null && !selected && !loading && !error;

  useEffect(() => {
    if (focusNext.current === "detail") {
      if (detail.current) detail.current.scrollTop = 0;
      detailHeading.current?.focus({ preventScroll: true });
    } else if (focusNext.current === "list") {
      (lastRow.current?.isConnected ? lastRow.current : listHeading.current)?.focus();
    }
    focusNext.current = null;
  }, [selectedId]);

  return (
    <div className="schedule-layout" data-detail-open={selectedId !== null && !error && !loading}>
      <section className="schedule-list overflow-y-auto" aria-labelledby="schedule-list-title">
        <header className="schedule-list-header">
          <h1 id="schedule-list-title" ref={listHeading} tabIndex={-1}>Routes</h1>
          <p>Stops and scheduled times for each route.</p>
          {!loading && !error && schedules.length > 1 && (
            <label className="schedule-search">
              <Search size={16} aria-hidden="true" />
              <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search routes or stops" aria-label="Search routes or stops" />
            </label>
          )}
        </header>
        {error ? (
          <div className="schedule-state" role="alert">
            <p>Route schedules could not be loaded.</p>
            <p>{error}</p>
            <button type="button" onClick={onRetry}>Retry</button>
          </div>
        ) : loading ? (
          <div className="schedule-state" role="status">
            <p>Loading routes…</p>
            <div className="schedule-skeleton" aria-hidden="true" />
            <div className="schedule-skeleton" aria-hidden="true" />
            <div className="schedule-skeleton" aria-hidden="true" />
          </div>
        ) : schedules.length === 0 ? (
          <div className="schedule-state">
            <p>No routes published yet</p>
            <p>Route schedules will appear here once they are published.</p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="schedule-state" role="status">No routes match your search.</p>
        ) : (
          <ul aria-label="Published routes">
            {filtered.map(schedule => (
              <li key={schedule.routeId}>
                <button
                  type="button"
                  className="schedule-route-row"
                  data-selected={selected?.routeId === schedule.routeId}
                  aria-label={`View schedule for ${schedule.name}`}
                  aria-current={selectedId === schedule.routeId ? "true" : undefined}
                  onClick={event => {
                    if (selectedId === schedule.routeId) {
                      detailHeading.current?.focus();
                      return;
                    }
                    lastRow.current = event.currentTarget;
                    focusNext.current = "detail";
                    setSelectedId(schedule.routeId);
                  }}
                >
                  <LineBadge schedule={schedule} />
                  <span className="schedule-route-copy">
                    <strong>{schedule.name}</strong>
                    {endpoints(schedule) && <span>{endpoints(schedule)}</span>}
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="schedule-detail overflow-y-auto" ref={detail} aria-label="Route details" tabIndex={0}>
        {!error && !loading && (selected || selectedMissing) && (
          <header className="schedule-detail-header">
            {selectedId !== null && (
              <button type="button" className="schedule-back" aria-label="Back to all routes" onClick={() => {
                focusNext.current = "list";
                setSelectedId(null);
              }}>
                <ArrowLeft size={20} aria-hidden="true" />
              </button>
            )}
            {selected && <LineBadge schedule={selected} />}
            <h2 ref={detailHeading} tabIndex={-1}>{selected?.name ?? "Route unavailable"}</h2>
          </header>
        )}
        {!error && !loading && selected ? (
          <>
            <div className="schedule-summary">
              {endpoints(selected) && <p className="schedule-endpoints">{endpoints(selected)}</p>}
              <p>Scheduled stops · {selected.stops.length} {selected.stops.length === 1 ? "stop" : "stops"}</p>
              <p>Scheduled times only</p>
            </div>
            {selected.stops.length > 0 ? (
              <ol className="schedule-stops" aria-label={`${selected.name} stops`}>
                {selected.stops.map(stop => (
                  <li key={stop.id} className="schedule-stop">
                    <span className="schedule-stop-rail" aria-hidden="true" />
                    <div className="schedule-stop-copy">
                      <p>{stop.name}</p>
                      <p>{stop.time ? `Scheduled ${formatStopTime(stop.time)}` : "Time not set"}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="schedule-state">No stops listed for this route yet</p>}
          </>
        ) : selectedMissing ? (
          <p className="schedule-state" role="status">This route is no longer published. Choose another route.</p>
        ) : null}
      </section>
    </div>
  );
}
