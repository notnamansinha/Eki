import React, { useState, useEffect } from 'react';
import { RouteData } from '@/hooks/useRoutes';

interface RouteCarouselProps {
  routes: RouteData[];
  selectedRouteId: string;
  onSwipe?: (id: string) => void;
  onClick: (id: string) => void;
  getActiveBusesCount: (routeId: string) => number;
}

export default function RouteCarousel({ routes, selectedRouteId, onClick, getActiveBusesCount }: RouteCarouselProps) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const refresh = () => setNow(Date.now());
    refresh();
    const intervalId = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const liveRoutes = routes.filter((route) => getActiveBusesCount(route.id) > 0);

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
        const activeBuses = getActiveBusesCount(route.id);
        const stops = route.stops ?? [];
        const durationMins = route.duration ? Math.round(parseInt(route.duration) / 60) : (stops.length * 2); // Fallback estimation
        const scheduleTime = now ? new Date(now + durationMins * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';

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

                <div className="flex items-baseline w-full mt-6 gap-3">
                  <div className="flex items-center gap-2">

                    <div className="flex items-baseline gap-1.5 text-[11.5px] font-black whitespace-nowrap" style={{ color: "var(--text-tertiary)" }}>
                      <span>{stops.length} stops</span>
                      <span className="text-[10px] opacity-30 self-center">&bull;</span>
                      <span className="text-white">Scheduled: {scheduleTime}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-baseline gap-1.5 text-[13px] font-black tracking-wider uppercase transition-opacity shrink-0" style={{ color: "var(--accent)" }}>
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
