import React from 'react';
import { RouteData } from '@/hooks/useRoutes';

interface RouteCarouselProps {
  routes: RouteData[];
  selectedRouteId: string;
  onSwipe: (id: string) => void; // kept for API compatibility — selects the route
  onClick: (id: string) => void; // opens tracking view
  getActiveBusesCount: (routeId: string) => number;
}

export default function RouteCarousel({ routes, selectedRouteId, onSwipe, onClick, getActiveBusesCount }: RouteCarouselProps) {
  if (routes.length === 0) return null;

  const handleCardClick = (routeId: string) => {
    onSwipe(routeId); // Sets selectedRouteId
    onClick(routeId); // Opens tracking view
  };

  return (
    <div className="w-full flex flex-col gap-3 px-1">
      {routes.map((route) => {
        const isSelected = route.id === selectedRouteId;
        const activeBuses = getActiveBusesCount(route.id);
        const stops = route.stops ?? [];
        const firstStop = stops[0];
        const lastStop = stops[stops.length - 1];
        const durationMins = route.duration
          ? Math.round(parseInt(route.duration) / 60)
          : stops.length * 2;

        return (
          <button
            key={route.id}
            onClick={() => handleCardClick(route.id)}
            className="w-full text-left transition-all duration-300 rounded-[20px] p-5 border relative overflow-hidden flex flex-col active:scale-[0.99]"
            style={{
              background: isSelected ? 'var(--surface-3)' : 'var(--surface-2)',
              borderColor: isSelected ? 'var(--border-hover)' : 'var(--border-subtle)',
              boxShadow: isSelected
                ? '0 8px 32px rgba(0,0,0,0.25)'
                : '0 2px 8px rgba(0,0,0,0.08)',
            }}
          >
            {/* Route color accent strip */}
            <div
              className="absolute left-0 top-0 bottom-0 w-[4px]"
              style={{
                background: 'linear-gradient(180deg, #5B3E8A 0%, #7A5C9B 100%)',
                opacity: isSelected ? 1 : 0.25,
                borderTopLeftRadius: '20px',
                borderBottomLeftRadius: '20px',
              }}
            />

            <div className="pl-3 flex flex-col gap-3">
              {/* Route name + live badge row */}
              <div className="flex items-start justify-between gap-2">
                <h3
                  className="text-route-name line-clamp-2 flex-1"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {route.name}
                </h3>
                {activeBuses > 0 && (
                  <span
                    className="px-2.5 py-1 rounded-lg text-chip uppercase tracking-widest flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    style={{ background: 'rgba(34, 197, 94, 0.1)', color: 'var(--status-live)' }}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full animate-pulse"
                      style={{ background: 'var(--status-live)' }}
                    />
                    Live
                  </span>
                )}
              </div>

              {/* First → Last stop */}
              {firstStop && lastStop && (
                <p className="text-[12px] font-medium truncate" style={{ color: 'var(--text-tertiary)' }}>
                  {firstStop.shortName || firstStop.name}
                  <span className="mx-1.5 opacity-40">→</span>
                  {lastStop.shortName || lastStop.name}
                </p>
              )}

              {/* Divider */}
              <div className="w-full h-px" style={{ background: 'var(--border-subtle)', opacity: 0.5 }} />

              {/* Metadata chips row */}
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="px-2.5 py-1 rounded-lg text-chip uppercase tracking-widest whitespace-nowrap"
                  style={{ background: 'var(--surface-1)', color: 'var(--text-secondary)' }}
                >
                  BUS
                </span>
                <span
                  className="text-metadata whitespace-nowrap"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {stops.length} stops
                </span>
                <span className="text-[10px] opacity-30" style={{ color: 'var(--text-ghost)' }}>•</span>
                <span
                  className="text-metadata whitespace-nowrap"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  ~{durationMins} min
                </span>
                {route.type === 'circular' && (
                  <span
                    className="px-2.5 py-1 rounded-lg text-chip uppercase tracking-widest whitespace-nowrap"
                    style={{ background: 'var(--surface-1)', color: 'var(--text-secondary)' }}
                  >
                    Circular
                  </span>
                )}
                <span
                  className="ml-auto text-[10px] font-bold uppercase tracking-widest text-accent"
                  style={{ color: "var(--accent)" }}
                >
                  Track Route →
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
