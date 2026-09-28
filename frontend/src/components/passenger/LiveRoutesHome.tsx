"use client";

import { useRef, useState } from "react";
import {
  Bell, Bookmark, BusFront, ChevronRight, Clock3, MapPin,
  Radio, Route as RouteIcon, Star, TriangleAlert,
} from "lucide-react";
import type { RouteData } from "@/hooks/useRoutes";
import type { PassengerLiveBus } from "@/lib/passengerLiveBus";
import type { PassengerBusAvailability } from "@/lib/passengerBusAvailability";
import { normalizeRideDirection, routeInRideDirectionState } from "@/lib/rideDirection";
import styles from "./LiveRoutesHome.module.css";

type Filter = "all" | "live" | "saved";
const SAVED_ROUTES_KEY = "eki:passenger-saved-routes";

function initialSavedRoutes(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(SAVED_ROUTES_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

interface Props {
  routes: RouteData[];
  activeBuses: PassengerLiveBus[];
  availableBuses: PassengerBusAvailability[];
  announcement?: string;
  loading: boolean;
  error: boolean;
  emptyMessage: string;
  emptyDetail: string;
  onRetry: () => void;
  onSelectRoute: (id: string) => void;
}

function RouteCard({ route, buses, availableCount, recommended, saved, onSave, onSelect }: {
  route: RouteData;
  buses: PassengerLiveBus[];
  availableCount: number;
  recommended: boolean;
  saved: boolean;
  onSave: () => void;
  onSelect: () => void;
}) {
  const live = buses.length > 0;
  const primaryBus = buses[0];
  const direction = normalizeRideDirection(primaryBus?.direction);
  const directedRoute = live ? routeInRideDirectionState(route, direction) : route;
  const stops = directedRoute?.stops ?? [];
  const origin = stops[0]?.name;
  const destination = stops.length > 1 ? stops[stops.length - 1]?.name : undefined;
  const via = stops.slice(1, -1).map((stop) => stop.name).slice(0, 2).join(", ");
  const delay = typeof primaryBus?.delayMinutes === "number" && primaryBus.delayMinutes > 0
    ? Math.round(primaryBus.delayMinutes) : 0;

  return (
    <article className={`${styles.card} ${recommended ? styles.recommended : ""}`}>
      <div className={styles.cardTop}>
        <span className={styles.modeIcon}><BusFront size={23} aria-hidden="true" /></span>
        <span className={styles.modeName}>Campus bus</span>
        <span className={styles.routeBadge}>{route.name}</span>
        <button className={styles.saveButton} type="button" onClick={onSave}
          aria-label={`${saved ? "Remove" : "Save"} ${route.name} ${saved ? "from" : "to"} saved routes`}
          aria-pressed={saved}>
          <Bookmark size={19} fill={saved ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      </div>
      {recommended && <span className={styles.recommendation}><Star size={13} fill="currentColor" aria-hidden="true" /> Recommended</span>}
      <button className={styles.routeAction} type="button" onClick={onSelect} disabled={!live}
        aria-label={live ? `Track ${route.name}` : `${route.name}, ${availableCount ? "vehicle available, service not started" : "no live service"}`}>
        <span className={styles.routeMain}>
          <span className={styles.routeTitle}>
            {live && direction === "pending" ? "Direction pending" : origin && destination ? <>{origin} <span className={styles.pathArrow}>→</span> {destination}</> : route.name}
          </span>
          <span className={styles.via}>{via && direction !== "pending" ? `Via ${via}` : live ? "Route details available when direction is resolved" : "Waiting for live service"}</span>
        </span>
        <span className={styles.cardBottom}>
          <span className={styles.statuses}>
            <span className={live ? styles.liveStatus : styles.quietStatus}><span className={styles.statusDot} />{live ? "Live" : availableCount ? "Vehicle available" : "No live service"}</span>
            {live && <span className={delay ? styles.delayStatus : styles.quietStatus}><Clock3 size={15} aria-hidden="true" />{delay ? `+${delay} min delay` : "No delay reported"}</span>}
          </span>
          <span className={styles.arrival}>
            <span className={styles.arrivalLabel}>{live ? "Live arrival" : "Next arrival"}</span>
            <span className={styles.arrivalValue}>{live ? "View ETA" : "—"}<ChevronRight size={19} aria-hidden="true" /></span>
          </span>
        </span>
      </button>
    </article>
  );
}

export default function LiveRoutesHome({ routes, activeBuses, availableBuses, announcement, loading, error, emptyMessage, emptyDetail, onRetry, onSelectRoute }: Props) {
  const [filter, setFilter] = useState<Filter>("live");
  const [showLocationInfo, setShowLocationInfo] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const [savedRoutes, setSavedRoutes] = useState(initialSavedRoutes);
  const savedSet = new Set(savedRoutes);
  const activeIds = new Set(activeBuses.map((bus) => bus.routeId));
  const listedRoutes = routes.filter((route) =>
    (route.stops?.length ?? 0) > 0 || (route.waypoints?.length ?? 0) > 0,
  );
  const filteredRoutes = listedRoutes.filter((route) =>
    filter === "all" || (filter === "live" && activeIds.has(route.id)) || (filter === "saved" && savedSet.has(route.id)),
  );
  const recommendedId = filteredRoutes.find((route) => activeIds.has(route.id) &&
    !activeBuses.some((bus) => bus.routeId === route.id && (bus.delayMinutes ?? 0) > 0))?.id;

  const toggleSaved = (id: string) => {
    const next = savedSet.has(id) ? savedRoutes.filter((item) => item !== id) : [...savedRoutes, id];
    setSavedRoutes(next);
    try { window.localStorage.setItem(SAVED_ROUTES_KEY, JSON.stringify(next)); } catch { /* Storage may be unavailable. */ }
  };

  return (
    <main className={styles.home}>
      <div className={styles.background} aria-hidden="true" />
      <div className={styles.scroll}>
        <div className={styles.content}>
          <header className={styles.header}>
            <div className={styles.locationWrap}>
              <button className={styles.location} type="button" aria-expanded={showLocationInfo} onClick={() => setShowLocationInfo((value) => !value)}><MapPin size={19} aria-hidden="true" /> Ahmedabad</button>
              {showLocationInfo && <span className={styles.locationInfo}>Showing routes in Ahmedabad</span>}
            </div>
            <button className={styles.notification} type="button" aria-label="View service status" onClick={() => alertRef.current?.scrollIntoView({ block: "center" })}><Bell size={20} aria-hidden="true" />{announcement && <span className={styles.notificationDot} />}</button>
          </header>
          <section className={styles.hero} aria-labelledby="live-routes-title">
            <p className={styles.eyebrow}>YOUR CITY, IN MOTION</p>
            <h1 id="live-routes-title">Live Routes<span className={styles.titleDot}>.</span></h1>
            <p>Real-time service updates for Ahmedabad campus buses.</p>
          </section>
          <div className={styles.alert} role={announcement ? "status" : undefined} ref={alertRef}>
            <span className={styles.alertIcon}><TriangleAlert size={22} aria-hidden="true" /></span>
            <span className={styles.alertCopy}><strong>{announcement ? "Service update" : "Service status"}</strong><span>{announcement || "Live routes appear as buses enter service."}</span></span>
            <ChevronRight size={18} className={styles.alertChevron} aria-hidden="true" />
          </div>
          <div className={styles.sectionHeading}><h2>Explore routes</h2><span>{filteredRoutes.length} routes</span></div>
          <div className={styles.filters} role="group" aria-label="Filter routes">
            {(["all", "live", "saved"] as const).map((item) => {
              const Icon = item === "all" ? RouteIcon : item === "live" ? Radio : Bookmark;
              return <button key={item} type="button" className={`${styles.filter} ${filter === item ? styles.filterActive : ""}`}
                aria-pressed={filter === item} onClick={() => setFilter(item)}><Icon size={18} aria-hidden="true" />{item[0].toUpperCase() + item.slice(1)}</button>;
            })}
          </div>
          <div className={styles.routeList} aria-live="polite">
            {loading && !error ? <div className={styles.stateCard} role="status">Loading live routes…</div> : error ?
              <div className={styles.stateCard}><strong>Couldn’t load routes</strong><span>Check your connection and try again.</span><button type="button" onClick={onRetry}>Retry</button></div> :
              filteredRoutes.length ? filteredRoutes.map((route) => <RouteCard key={route.id} route={route}
                buses={activeBuses.filter((bus) => bus.routeId === route.id)}
                availableCount={availableBuses.filter((bus) => bus.routeId === route.id).length}
                recommended={route.id === recommendedId} saved={savedSet.has(route.id)}
                onSave={() => toggleSaved(route.id)} onSelect={() => onSelectRoute(route.id)} />) :
              <div className={styles.stateCard}><strong>{filter === "saved" ? "No saved routes yet" : filter === "all" ? "No routes available" : emptyMessage}</strong><span>{filter === "saved" ? "Save a route from All or Live to find it here." : filter === "all" ? "Routes will appear here when configured." : emptyDetail}</span></div>}
          </div>
        </div>
      </div>
    </main>
  );
}
