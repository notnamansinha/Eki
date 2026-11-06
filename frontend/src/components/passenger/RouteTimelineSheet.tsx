import React, { useState } from "react";
import { Route as RouteIcon, Footprints } from "lucide-react";
import { RouteData } from "@/hooks/useRoutes";
import BottomSheet from "./ui/BottomSheet";
import { publishedStopIndex } from "@/lib/publishedStopIndex";
import { isBehindBus, stopProgress, stopVisitLabel } from "@/lib/stopProgress";

interface RouteTimelineSheetProps {
  route: RouteData | null;
  targetStopId: string;
  activeBusId?: string | null;
  stopETAs?: Record<string, number>;
  headerContent?: React.ReactNode;
  bottomControls?: React.ReactNode;
  walkMinutesToTarget?: number;
  preview?: boolean;
  currentStopIndex?: number; // Authoritative index from driver/ESP32 via RTDB
  /** Stop the bus is at now, acknowledged on arrival. */
  atStopIndex?: number;
  /** Passed stops the bus was never observed at. */
  unobservedStopIndices?: number[];
  aggregateArrivals?: boolean;
  geometryUnavailable?: boolean;
}

/** The passenger map draws every route in AU Red; the timeline follows it. */
const ROUTE_COLOR = "#801214";

export default function RouteTimelineSheet({
  route,
  targetStopId,
  stopETAs = {},
  bottomControls,
  walkMinutesToTarget,
  currentStopIndex,
  atStopIndex,
  unobservedStopIndices,
  preview = false,
  aggregateArrivals = false,
  geometryUnavailable = false,
}: RouteTimelineSheetProps) {
  const [isOpen, setIsOpen] = useState(false);
  if (!route || !route.stops || route.stops.length === 0) return null;

  const nextStopIndex = !preview && !aggregateArrivals
    ? publishedStopIndex(currentStopIndex, route.stops.length) : undefined;
  const progress = nextStopIndex === undefined ? undefined
    : stopProgress(route.stops.length, { currentStopIndex: nextStopIndex, atStopIndex, unobservedStopIndices });

  return (
    <BottomSheet
      isOpen={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
      headerIcon={<RouteIcon className="w-4 h-4" />}
      headerTitle={preview ? "Configured route" : "Route timeline"}
      bottomControls={bottomControls}
    >
      {/* Route name */}
      <p className="mb-5 text-center text-[13px] font-medium text-[var(--text-secondary)]">
        {route.name}
      </p>
      {!preview && !aggregateArrivals && nextStopIndex === undefined && (
        <p role="status" className="mb-4 text-[13px] text-[var(--text-secondary)]">
          Stop progress unavailable.
        </p>
      )}
      {!preview && (aggregateArrivals || geometryUnavailable) && (
        <p role="status" className="mb-4 text-[13px] text-[var(--text-secondary)]">
          {aggregateArrivals && "Earliest arrival across buses. Select a bus to see its stop progress. "}
          {geometryUnavailable && "Road geometry unavailable for some buses. Their arrival estimates are unavailable."}
        </p>
      )}

      {/* Timeline */}
      <div className="relative pl-7 pb-4">
        {route.stops.map((stop, index) => {
          const isTarget = stop.id === targetStopId;
          const isLast = index === route.stops.length - 1;
          const isFirst = index === 0;

          const etaMinutes = preview ? undefined : stopETAs[stop.id];
          // Missing geometry or ETA is never evidence that a stop was reached.
          const visit = progress?.states[index];
          const isPast = isBehindBus(visit);

          // The stop the bus is at now, or else the one it is heading towards.
          const isAtStop = visit === "at";
          const isNextStop = !isPast && (isAtStop || visit === "next");

          return (
            <div
              key={stop.id}
              data-passed={isPast}
              data-current={isNextStop}
              className="pp-stop-row relative flex items-start gap-4 pb-7"
            >
              {/* Timeline rail + dots */}
              <div
                className="absolute top-0 bottom-0 flex flex-col items-center"
                style={{ left: isNextStop ? -20 : -28 }}
              >
                <div
                  className="w-3 h-3 rounded-full z-10 border-2 shrink-0"
                  style={{
                    borderColor: "var(--surface-1)",
                    background: isPast
                      ? "var(--route-passed)"
                      : isNextStop
                        ? "var(--status-live)"
                        : ROUTE_COLOR,
                    boxShadow: isNextStop
                      ? "0 0 0 3px color-mix(in oklab, var(--status-live) 25%, transparent)"
                      : isTarget
                        ? "0 0 0 3px var(--accent-subtle)"
                        : "none",
                  }}
                />
                {!isLast && (
                  <div
                    className="w-[2px] flex-1 mt-1 mb-1"
                    style={{ background: isPast ? "var(--route-passed)" : `${ROUTE_COLOR}40` }}
                  />
                )}
              </div>

              {/* Stop info */}
              <div className="flex-1 -mt-1 min-w-0">
                {isNextStop && (
                  <div className="pp-stop-kicker" data-tone="live">
                    <span aria-hidden="true" style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--status-live)", animation: "pulse-dot 1.5s infinite" }} />
                    {isAtStop ? "Bus is here" : "Next stop"}
                  </div>
                )}
                {isPast && (
                  <div className="pp-stop-kicker" data-tone="muted">
                    {stopVisitLabel(visit)}
                  </div>
                )}
                <p className={(isTarget || isNextStop) && !isPast ? "font-medium text-[15px]" : "text-[14px]"}
                  style={{ color: isPast ? "var(--text-tertiary)" : (isTarget || isNextStop) ? "var(--text-primary)" : "var(--text-secondary)" }}>
                  {stop.name}
                </p>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span className="pp-chip">
                    {stop.shortName}
                  </span>
                  {isTarget && (
                    <span className="pp-chip" data-tone="accent">
                      {preview ? "Selected stop" : isFirst ? "Boarding stop" : isLast ? "Destination" : "Selected stop"}
                    </span>
                  )}
                  {isFirst && !isTarget && (
                    <span className="pp-chip">
                      {preview ? "Route endpoint" : "Start"}
                    </span>
                  )}
                  {isLast && !isTarget && (
                    <span className="pp-chip">
                      {preview ? "Route endpoint" : "Terminus"}
                    </span>
                  )}
                  {isTarget && typeof walkMinutesToTarget === "number" && (
                    <span className="pp-chip">
                      <Footprints className="w-3 h-3" aria-hidden="true" />
                      {walkMinutesToTarget === 0 ? "At stop" : `${walkMinutesToTarget} min walk`}
                    </span>
                  )}
                </div>
              </div>

              {/* ETA */}
              {typeof etaMinutes === "number" && !isPast && !isAtStop && (
                <div className="ml-auto text-right flex flex-col justify-center pr-1 pt-0.5">
                  <div className="flex items-baseline gap-1">
                    <span className="pp-eta" data-soon={etaMinutes <= 2 && etaMinutes > 0}>
                      {etaMinutes === 0 ? "Due" : etaMinutes}
                    </span>
                    {etaMinutes > 0 && (
                      <span className="pp-eta-unit">
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
