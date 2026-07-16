import React, { useState, useEffect } from "react";
import { Navigation, Footprints } from "lucide-react";
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
}

export default function RouteTimelineSheet({
  route,
  targetStopId,
  activeBusId,
  stopETAs = {},
  headerContent,
  bottomControls,
  walkMinutesToTarget,
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
      headerIcon={<Navigation className="w-4 h-4" />}
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
          const hasEtaData = Object.keys(stopETAs).length > 0;
          const etaMinutes = stopETAs[stop.id];
          const isPastBus = hasEtaData && etaMinutes === undefined;
          const isPastTarget = targetIndex !== -1 && index > targetIndex;
          const isDimmed = isPastBus || isPastTarget;
          const isLast = index === route.stops.length - 1;
          const isFirst = index === 0;

          return (
            <div key={stop.id} className={`relative flex items-start gap-4 pb-7 ${isDimmed ? "opacity-25" : "opacity-100"}`}>
              {/* Timeline rail + dots */}
              <div className="absolute left-[-28px] top-0 bottom-0 flex flex-col items-center">
                <div
                  className="w-3 h-3 rounded-full z-10 border-2 shrink-0"
                  style={{
                    borderColor: "var(--surface-1)",
                    background: isTarget
                      ? "var(--accent)"
                      : isDimmed
                        ? "var(--surface-4)"
                        : routeColor,
                    boxShadow: isTarget ? `0 0 8px var(--accent-glow)` : "none",
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
                <p className={`truncate ${isTarget ? "font-semibold text-[14px]" : "font-medium text-[13px]"}`}
                  style={{ color: isTarget ? "var(--text-primary)" : isDimmed ? "var(--text-ghost)" : "var(--text-secondary)" }}>
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
                      Your stop
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
              {typeof etaMinutes === "number" && !isPastBus && (
                <div className="ml-auto text-right flex flex-col justify-center pr-1 pt-0.5">
                  <div className="flex items-baseline gap-0.5">
                    <span className={`text-lg font-extrabold tracking-tight ${etaMinutes <= 2 && etaMinutes > 0 ? "" : ""}`}
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
