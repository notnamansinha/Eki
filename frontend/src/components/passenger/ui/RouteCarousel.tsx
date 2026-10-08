import React from 'react';
import { RouteData } from '@/hooks/useRoutes';
import {
  routeInRideDirectionState,
  type RideDirectionState,
} from '@/lib/rideDirection';

interface RouteCarouselProps {
  routes: RouteData[];
  selectedRouteId: string;
  onSwipe?: (id: string) => void;
  onClick: (id: string) => void;
  getActiveBusesCount: (routeId: string) => number;
  getAvailableBusesCount: (routeId: string) => number;
  getDirectionState: (routeId: string) => RideDirectionState | "unknown";
}

export default function RouteCarousel({ routes, selectedRouteId, onClick, getActiveBusesCount, getAvailableBusesCount, getDirectionState }: RouteCarouselProps) {
  const liveRoutes = routes.filter((route) =>
    getActiveBusesCount(route.id) > 0 || getAvailableBusesCount(route.id) > 0
  );

  if (liveRoutes.length === 0) {
    return (
      <div className="w-full flex flex-col items-center justify-center py-12 gap-3">
        <p className="text-[16px] font-black" style={{ color: "var(--text-secondary)" }}>No live routes right now</p>
        <p className="text-[13px] font-medium text-center" style={{ color: "var(--text-tertiary)" }}>Routes will appear here once a bus is active.</p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-4 pb-4">
      {liveRoutes.map((route) => {
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

        return (
          <button
            type="button"
            key={route.id}
            className="w-full flex items-stretch text-left transition-all duration-300 ease-out disabled:cursor-default"
            onClick={() => onClick(route.id)}
            aria-label={`Track ${route.name}`}
          >
            <div
              className="w-full text-left transition-all duration-300 rounded-[20px] p-5 border relative overflow-hidden flex flex-col min-h-[170px]"
              style={{
                background: "var(--surface-3)",
                borderColor: route.id === selectedRouteId ? "var(--accent)" : "var(--border-subtle)",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
              }}
            >
              <div className="pl-2 flex flex-col h-full justify-between">
                <div>
                  <h3
                    className="text-[22px] font-black tracking-tight line-clamp-1"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {route.name}
                  </h3>
                  {directedRoute && stops.length > 0 ? (
                    <p className="text-[14.5px] font-bold mt-2 line-clamp-1" style={{ color: "var(--text-secondary)" }}>
                      {stops[0].name.split(',')[0]} <span className="mx-1 opacity-60">&rarr;</span> {stops[stops.length - 1].name.split(',')[0]}
                    </p>
                  ) : (
                    <p className="text-[14.5px] font-bold mt-2" style={{ color: "var(--text-secondary)" }}>
                      {hasService ? directionState === "unknown" ? "Open for live status" : "Direction pending" : "Vehicle available — service not started"}
                    </p>
                  )}
                </div>

                <div className="flex items-baseline w-full mt-6 gap-3">
                  <div className="flex items-center gap-2">

                    <div className="flex items-baseline gap-1.5 text-[11.5px] font-black whitespace-nowrap" style={{ color: "var(--text-tertiary)" }}>
                      <span>{stops.length ? `${stops.length} stops` : "Stops pending"}</span>
                      <span className="text-[10px] opacity-30 self-center">&bull;</span>
                      <span className="text-white">{durationMins ? `${durationMins} min route` : "Duration pending"}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-baseline gap-1.5 text-[13px] font-black tracking-wider uppercase transition-opacity shrink-0" style={{ color: "var(--accent)" }}>
                    {directedRoute ? "TRACK ROUTE" : hasService ? "VIEW STATUS" : `${availableCount} AVAILABLE`}
                    <span className="text-[15px]">&rarr;</span>
                  </div>
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
