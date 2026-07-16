import React from 'react';
import { RouteData } from '@/hooks/useRoutes';
import { Navigation, Clock, Activity, MapPin } from 'lucide-react';

interface RouteCarouselProps {
  routes: RouteData[];
  selectedRouteId: string;
  onSwipe?: (id: string) => void;
  onClick: (id: string) => void;
  getActiveBusesCount: (routeId: string) => number;
}

export default function RouteCarousel({ routes, selectedRouteId, onClick, getActiveBusesCount }: RouteCarouselProps) {
  if (routes.length === 0) return null;

  return (
    <div className="w-full flex flex-col gap-4 pb-4">
      {routes.map((route) => {
        const isSelected = route.id === selectedRouteId;
        const activeBuses = getActiveBusesCount(route.id);
        const stops = route.stops ?? [];
        const durationMins = route.duration ? Math.round(parseInt(route.duration) / 60) : (stops.length * 2); // Fallback estimation
        const scheduleTime = new Date(Date.now() + durationMins * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return (
          <div
            key={route.id}
            className="w-full flex items-stretch transition-all duration-300 ease-out cursor-pointer"
            onClick={() => onClick(route.id)}
          >
            <div
              className="w-full text-left transition-all duration-300 rounded-[20px] p-5 border relative overflow-hidden flex flex-col min-h-[170px]"
              style={{
                background: "var(--surface-3)",
                borderColor: "var(--border-subtle)",
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
                  {stops.length > 0 && (
                    <p className="text-[14.5px] font-bold mt-2 line-clamp-1" style={{ color: "var(--text-secondary)" }}>
                      {stops[0].name.split(',')[0]} <span className="mx-1 opacity-60">&rarr;</span> {stops[stops.length - 1].name.split(',')[0]}
                    </p>
                  )}
                </div>

                <div className="flex items-center w-full mt-6 gap-3">
                  <div className="flex items-center gap-2">
                    {activeBuses > 0 && (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold tracking-wider flex items-center gap-1.5 shrink-0" style={{ background: "rgba(34, 197, 94, 0.1)", color: "var(--status-live)" }}>
                        <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--status-live)" }} />
                        LIVE
                      </span>
                    )}
                    <div className="flex items-center gap-1.5 text-[11.5px] font-black whitespace-nowrap" style={{ color: "var(--text-tertiary)" }}>
                      <span>{stops.length} stops</span>
                      <span className="text-[10px] opacity-30">&bull;</span>
                      <span className="text-white">Scheduled: {scheduleTime}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1.5 text-[13px] font-black tracking-wider uppercase transition-opacity shrink-0" style={{ color: "var(--accent)" }}>
                    TRACK ROUTE <span className="text-[15px]">&rarr;</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
