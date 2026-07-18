import React, { useState, useEffect } from "react";
import { Route as RouteIcon, Footprints } from "lucide-react";
import { RouteData } from "@/hooks/useRoutes";
import BottomSheet from "./ui/BottomSheet";

interface RouteTimelineSheetProps {
  route: RouteData | null;
  targetStopId: string;
  activeBusId?: string | null;
  stopETAs?: Record<string, number>;
  headerContent?: React.ReactNode;
  bottomControls?: React.ReactNode;
  walkMinutesToTarget?: number;
  currentStopIndex?: number; // Authoritative index from driver/ESP32 via RTDB
}

export default function RouteTimelineSheet({
  route,
  targetStopId,
  activeBusId,
  stopETAs = {},
  headerContent,
  bottomControls,
  walkMinutesToTarget,
  currentStopIndex,
}: RouteTimelineSheetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted || !route || !route.stops || route.stops.length === 0) return null;

  const targetIndex = route.stops.findIndex((s) => s.id === targetStopId);
  const routeColor = route.color || "#3b82f6";

  return (
    <BottomSheet
      isOpen={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
      headerIcon={<RouteIcon className="w-4 h-4" />}
      headerTitle="Route Timeline"
      bottomControls={bottomControls}
    >
      {/* Route name */}
      <div className="text-[11px] font-semibold mb-5 text-center" style={{ color: "var(--text-ghost)" }}>
        {route.name}
      </div>

      {/* Timeline */}
      <div className="relative pl-7 pb-4">
        {route.stops.map((stop, index) => {
          const isTarget = stop.id === targetStopId;
          const isLast = index === route.stops.length - 1;
          const isFirst = index === 0;

          // A stop is "passed" if the bus has moved beyond it.
          // If driver hasn't pushed any index yet, fall back to ETA inference.
          const hasEtaData = Object.keys(stopETAs).length > 0;
          const etaMinutes = stopETAs[stop.id];

          let isPast: boolean;
          if (currentStopIndex !== undefined) {
            // Driver/ESP32 is source of truth
            isPast = index < currentStopIndex;
          } else {
            // Fallback: infer from ETA engine (stop has no ETA = bus has passed it)
            isPast = hasEtaData && etaMinutes === undefined;
          }

          // Dim passed stops. Never dim future stops just because they're after the user's target.
          const isDimmed = isPast;

          // The stop the bus is currently heading towards
          const isNextStop = currentStopIndex !== undefined
            ? index === currentStopIndex
            : false;

          return (
            <div
              key={stop.id}
              className={`relative flex items-start gap-4 pb-7 ${isDimmed ? "opacity-25" : "opacity-100"}`}
              style={isNextStop && !isDimmed ? {
                background: "rgba(34, 197, 94, 0.06)",
                borderLeft: "2px solid var(--status-live)",
                paddingLeft: 8,
                marginLeft: -10,
                borderRadius: 8,
              } : undefined}
            >
              {/* Timeline rail + dots */}
              <div 
                className="absolute top-0 bottom-0 flex flex-col items-center"
                style={{ left: isNextStop && !isDimmed ? -20 : -28 }}
              >
                <div
                  className="w-3 h-3 rounded-full z-10 border-2 shrink-0"
                  style={{
                    borderColor: "var(--surface-1)",
                    background: isDimmed
                      ? "var(--surface-4)"
                      : isNextStop
                        ? "var(--status-live)"
                        : isTarget
                          ? "var(--accent)"
                          : routeColor,
                    boxShadow: isNextStop && !isDimmed
                      ? "0 0 8px rgba(34, 197, 94, 0.7)"
                      : isTarget && !isDimmed
                        ? "0 0 8px var(--accent-glow)"
                        : "none",
                  }}
                />
                {!isLast && (
                  <div
                    className="w-[2px] flex-1 mt-1 mb-1"
                    style={{
                      background: isDimmed
                        ? "var(--surface-3)"
                        : `${routeColor}40`,
                    }}
                  />
                )}
              </div>

              {/* Stop info */}
              <div className="flex-1 -mt-1 min-w-0">
                {isNextStop && !isDimmed && (
                  <div className="text-[9px] font-bold uppercase tracking-widest mb-1 flex items-center gap-1" style={{ color: "var(--status-live)" }}>
                    <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: "var(--status-live)", animation: "pulse 1.5s infinite" }} />
                    Next Stop
                  </div>
                )}
                <p className={`${(isTarget || isNextStop) && !isDimmed ? "font-semibold text-[14px]" : "font-medium text-[13px]"}`}
                  style={{ color: isDimmed ? "var(--text-ghost)" : (isTarget || isNextStop) ? "var(--text-primary)" : "var(--text-secondary)" }}>
                  {stop.name}
                </p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                    style={{ background: "var(--surface-3)", color: "var(--text-ghost)" }}>
                    {stop.shortName}
                  </span>
                  {isTarget && (
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold"
                      style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}>
                      {isFirst ? "Boarding Stop" : isLast ? "Destination" : "Selected Stop"}
                    </span>
                  )}
                  {isFirst && !isTarget && (
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold"
                      style={{ background: "var(--surface-3)", color: "var(--text-ghost)" }}>
                      Start
                    </span>
                  )}
                  {isLast && !isTarget && (
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold"
                      style={{ background: "var(--surface-3)", color: "var(--text-ghost)" }}>
                      Terminus
                    </span>
                  )}
                  {isTarget && typeof walkMinutesToTarget === "number" && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-semibold"
                      style={{ background: "rgba(59, 130, 246, 0.10)", color: "#60A5FA" }}>
                      <Footprints className="w-2.5 h-2.5" />
                      {walkMinutesToTarget === 0 ? "At stop" : `${walkMinutesToTarget} min walk`}
                    </span>
                  )}
                </div>
              </div>

              {/* ETA */}
              {typeof etaMinutes === "number" && !isPast && (
                <div className="ml-auto text-right flex flex-col justify-center pr-1 pt-0.5">
                  <div className="flex items-baseline gap-0.5">
                    <span className={`text-lg font-extrabold tracking-tight`}
                      style={{ 
                        color: etaMinutes <= 2 && etaMinutes > 0 ? "var(--status-live)" : "var(--text-primary)",
                        fontVariantNumeric: "tabular-nums",
                      }}>
                      {etaMinutes === 0 ? "Due" : etaMinutes}
                    </span>
                    {etaMinutes > 0 && (
                      <span className="text-[9px] font-semibold" style={{ color: "var(--text-ghost)" }}>
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
    </BottomSheet>
  );
}
