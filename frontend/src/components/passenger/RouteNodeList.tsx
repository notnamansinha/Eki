import React, { useState, useEffect } from "react";
import { Footprints } from "lucide-react";
import { RouteData } from "@/hooks/useRoutes";

interface RouteNodeListProps {
  route: RouteData | null;
  targetStopId: string;
  activeBusId?: string | null;
  stopETAs?: Record<string, number>;
  walkMinutesToTarget?: number;
}

export default function RouteNodeList({
  route,
  targetStopId,
  activeBusId,
  stopETAs = {},
  walkMinutesToTarget,
}: RouteNodeListProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted || !route || !route.stops || route.stops.length === 0) return null;

  const targetIndex = route.stops.findIndex((s) => s.id === targetStopId);
  const routeColor = route.color || "#3b82f6";

  return (
    <div className="relative px-6 pt-28 pb-32 h-full overflow-y-auto" style={{ background: "var(--surface-0)" }}>
      {route.stops.map((stop, index) => {
        const isTarget = stop.id === targetStopId;
        const hasEtaData = Object.keys(stopETAs).length > 0;
        const etaMinutes = stopETAs[stop.id];
        const isPastBus = hasEtaData && etaMinutes === undefined;
        const isPastTarget = targetIndex !== -1 && index > targetIndex;
        const isDimmed = isPastBus || isPastTarget;
        const isLast = index === route.stops.length - 1;
        const isFirst = index === 0;

        return (
          <div key={stop.id} className={`relative flex items-stretch gap-6 pb-10 ${isDimmed ? "opacity-30" : "opacity-100"}`}>
            {/* Timeline rail + dots */}
            <div className="relative flex flex-col items-center w-[16px] shrink-0">
              <div
                className="w-4 h-4 rounded-full z-10 border-2 shrink-0 transition-all duration-300 mt-[2px]"
                style={{
                  borderColor: "var(--surface-1)",
                  background: isTarget
                    ? "var(--accent)"
                    : isDimmed
                      ? "var(--surface-4)"
                      : routeColor,
                  boxShadow: isTarget ? `0 0 12px var(--accent-glow)` : "none",
                }}
              />
              {!isLast && (
                <div
                  className="w-[2px] flex-1 mt-[4px] -mb-[38px] transition-all duration-300"
                  style={{
                    background: isDimmed
                      ? "var(--surface-3)"
                      : `${routeColor}40`,
                  }}
                />
              )}
            </div>

            {/* Stop info */}
            <div className="flex-1 flex flex-col min-w-0">
              <p className={`transition-colors leading-tight ${isTarget ? "text-important-number" : "text-card-title"}`}
                style={{ color: isTarget ? "var(--text-primary)" : isDimmed ? "var(--text-ghost)" : "var(--text-secondary)" }}>
                {stop.name}
              </p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-chip px-2 py-0.5 rounded"
                  style={{ background: "var(--surface-3)", color: "var(--text-ghost)" }}>
                  {stop.shortName}
                </span>
                {isTarget && (
                  <span className="px-2 py-0.5 rounded text-chip"
                    style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}>
                    {isFirst ? "Boarding Stop" : isLast ? "Destination" : "Selected Stop"}
                  </span>
                )}
                {isFirst && !isTarget && (
                  <span className="px-2 py-0.5 rounded text-chip"
                    style={{ background: "var(--surface-3)", color: "var(--text-ghost)" }}>
                    Start
                  </span>
                )}
                {isLast && !isTarget && (
                  <span className="px-2 py-0.5 rounded text-chip"
                    style={{ background: "var(--surface-3)", color: "var(--text-ghost)" }}>
                    Terminus
                  </span>
                )}
                {isTarget && typeof walkMinutesToTarget === "number" && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-chip"
                    style={{ background: "rgba(59, 130, 246, 0.10)", color: "#60A5FA" }}>
                    <Footprints className="w-3 h-3" />
                    {walkMinutesToTarget === 0 ? "At stop" : `${walkMinutesToTarget} min walk`}
                  </span>
                )}
              </div>
            </div>

            {/* ETA */}
            {typeof etaMinutes === "number" && !isPastBus && (
              <div className="ml-auto text-right flex flex-col justify-start pt-0.5">
                <div className="flex items-baseline gap-1">
                  <span className={`text-important-number ${etaMinutes <= 2 && etaMinutes > 0 ? "animate-pulse" : ""}`}
                    style={{ 
                      color: etaMinutes <= 2 && etaMinutes > 0 ? "var(--status-live)" : "var(--text-primary)",
                      fontSize: "24px",
                    }}>
                    {etaMinutes === 0 ? "Due" : etaMinutes}
                  </span>
                  {etaMinutes > 0 && (
                    <span className="text-label" style={{ color: "var(--text-ghost)" }}>
                      min
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
