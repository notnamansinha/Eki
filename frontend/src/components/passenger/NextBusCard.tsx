"use client";

import React from "react";
import { Navigation, Footprints, ChevronUp } from "lucide-react";

interface NextBusCardProps {
  routeName: string;
  targetStopName: string;
  etaMinutes: number | undefined;
  motionState: "moving" | "stopped" | "uncertain";
  walkMinutes?: number;
  onTap?: () => void;
  routeColor?: string;
}

const MOTION_LABELS: Record<string, { label: string; color: string }> = {
  moving:    { label: "In motion",     color: "var(--status-live)" },
  stopped:   { label: "At stop",       color: "var(--status-warning)" },
  uncertain: { label: "Signal weak",   color: "var(--status-danger)" },
};

export default function NextBusCard({
  routeName,
  targetStopName,
  etaMinutes,
  motionState,
  walkMinutes,
  onTap,
  routeColor = "var(--accent)",
}: NextBusCardProps) {
  const motion = MOTION_LABELS[motionState] || MOTION_LABELS.uncertain;

  return (
    <button
      onClick={onTap}
      className="w-full text-left transition-all duration-200 active:scale-[0.98]"
      aria-label={typeof etaMinutes === "number" ? `Next bus in ${etaMinutes} minutes` : "Next bus ETA calculating"}
    >
      <div
        className="rounded-2xl p-4 border"
        style={{
          background: "var(--surface-2)",
          borderColor: "var(--border-subtle)",
          boxShadow: "0 -4px 24px rgba(0, 0, 0, 0.3)",
        }}
      >
        {/* Top row: route + motion status */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: routeColor }}
            />
            <span className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
              {routeName}
            </span>
          </div>
          <ChevronUp className="w-4 h-4 shrink-0" style={{ color: "var(--text-ghost)" }} />
        </div>

        {/* Main row: ETA number + details */}
        <div className="flex items-end justify-between">
          <div className="flex items-baseline gap-1">
            {typeof etaMinutes === "number" ? (
              <>
                <span className="eta-number animate-count-in">
                  {etaMinutes === 0 ? "Now" : etaMinutes}
                </span>
                {etaMinutes > 0 && <span className="eta-unit">min</span>}
              </>
            ) : (
              <span className="text-lg font-extrabold" style={{ color: "var(--text-tertiary)" }}>
                Calculating…
              </span>
            )}
          </div>

          <div className="flex flex-col items-end gap-1.5">
            {/* Motion state */}
            <div className="flex items-center gap-1.5">
              <div
                className="w-[5px] h-[5px] rounded-full"
                style={{ background: motion.color }}
              />
              <span className="text-[10px] font-semibold" style={{ color: "var(--text-tertiary)" }}>
                {motion.label}
              </span>
            </div>

            {/* Walk ETA */}
            {typeof walkMinutes === "number" && (
              <div className="flex items-center gap-1">
                <Footprints className="w-3 h-3" style={{ color: "var(--text-ghost)" }} />
                <span className="text-[10px] font-semibold" style={{ color: "var(--text-tertiary)" }}>
                  {walkMinutes === 0 ? "At stop" : `${walkMinutes} min walk`}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
