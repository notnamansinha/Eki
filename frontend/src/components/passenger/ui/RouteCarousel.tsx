import React, { useId } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { RouteData } from '@/hooks/useRoutes';
import {
  routeInRideDirectionState,
  type RideDirectionState,
} from '@/lib/rideDirection';
import { routeLineLabel } from '@/lib/routeLineLabel';
import { isDemoRouteId } from '@/lib/demoRide';

interface RouteCarouselProps {
  routes: RouteData[];
  selectedRouteId: string;
  onClick: (id: string) => void;
  getActiveBusesCount: (routeId: string) => number;
  getAvailableBusesCount: (routeId: string) => number;
  getDirectionState: (routeId: string) => RideDirectionState | "unknown";
}

export default function RouteCarousel({ routes, selectedRouteId, onClick, getActiveBusesCount, getAvailableBusesCount, getDirectionState }: RouteCarouselProps) {
  const idBase = useId();
  const liveRoutes = routes.filter((route) =>
    getActiveBusesCount(route.id) > 0 || getAvailableBusesCount(route.id) > 0
  );

  if (liveRoutes.length === 0) {
    return (
      <div className="pp-empty">
        <p className="pp-empty-title">No live routes right now</p>
        <p className="pp-empty-detail">Routes will appear here once a bus is active.</p>
      </div>
    );
  }

  // The demo ride is listed last, in its own group, so it never reads as a live route.
  const card = (route: RouteData) => {
    const activeCount = getActiveBusesCount(route.id);
    const availableCount = getAvailableBusesCount(route.id);
    const hasService = activeCount > 0;
    const directionState = getDirectionState(route.id);
    const directedRoute = hasService && directionState !== "unknown"
      ? routeInRideDirectionState(route, directionState)
      : null;
    const stops = directedRoute?.stops ?? route.stops ?? [];
    const durationSeconds = Number.parseFloat(directedRoute?.duration ?? route.duration ?? "");
    const durationMins = Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Math.max(1, Math.round(durationSeconds / 60)) : null;
    const selected = route.id === selectedRouteId;
    // The demo ride is simulated in this browser; say so on its card.
    const demo = isDemoRouteId(route.id);

    return (
      <button
        type="button"
        key={route.id}
        data-passenger-route={route.id}
        className="w-full min-w-0 flex items-stretch text-left disabled:cursor-default"
        onClick={() => onClick(route.id)}
        aria-label={demo ? "Try the demo ride" : `Track ${route.name}`}
        aria-describedby={selected ? `${idBase}-selected` : undefined}
      >
        <div
          className="passenger-live-route-card relative w-full min-w-0 overflow-hidden flex flex-col min-h-[140px] p-4 text-left"
          data-selected={selected}
          data-demo={demo || undefined}
        >
          <span className="pp-route-code" aria-hidden="true">{demo ? "Demo" : routeLineLabel(route.name)}</span>
          <div className="passenger-live-route-card-content min-w-0 flex flex-col h-full justify-between">
            <div className="passenger-live-route-label">
              <h3 className="pp-route-name">
                {route.name}
                {demo && <span className="pp-demo-chip">Not a real bus</span>}
              </h3>
              {directedRoute && stops.length > 0 ? (
                <p className="pp-route-endpoints">
                  {stops[0].name.split(',')[0]} <span className="pp-arrow">→</span> {stops[stops.length - 1].name.split(',')[0]}
                </p>
              ) : (
                <p className="pp-route-endpoints">
                  {hasService ? directionState === "unknown" ? "Open for live status" : "Direction pending" : "Vehicle available — service not started"}
                </p>
              )}
              {selected && (
                <span id={`${idBase}-selected`} className="pp-selected-chip">
                  <Check size={12} strokeWidth={3} aria-hidden="true" />
                  Selected
                </span>
              )}
            </div>

            <div className="passenger-live-route-details flex flex-wrap items-center justify-between w-full mt-4 gap-3">
              <div className="passenger-live-route-meta">
                <div className="pp-route-meta-text">
                  <span>{stops.length ? `${stops.length} stops` : "Stops pending"}</span>
                  <span aria-hidden="true">·</span>
                  <span>{demo ? "Practice choosing stops and boarding" : durationMins ? `${durationMins} min route` : "Duration pending"}</span>
                </div>
              </div>

              <div className="passenger-live-route-action pp-route-cta shrink-0">
                {demo ? "Try it" : directedRoute ? "Track route" : hasService ? "View status" : `${availableCount} available`}
                <span className="pp-cta-icon" aria-hidden="true"><ArrowRight size={16} /></span>
              </div>
            </div>
          </div>
        </div>
      </button>
    );
  };
  const regular = liveRoutes.filter(route => !isDemoRouteId(route.id));
  const demos = liveRoutes.filter(route => isDemoRouteId(route.id));

  return (
    <>
      {regular.length > 0 && (
        <div className="passenger-live-route-list w-full flex flex-col gap-3 pb-4">
          {regular.map(card)}
        </div>
      )}
      {demos.length > 0 && (
        <section aria-labelledby={`${idBase}-practice`} className="passenger-demo-ride">
          <h2 id={`${idBase}-practice`} className="pp-section-label">Practice</h2>
          <div className="passenger-live-route-list w-full flex flex-col gap-3 pb-4">
            {demos.map(card)}
          </div>
        </section>
      )}
    </>
  );
}
