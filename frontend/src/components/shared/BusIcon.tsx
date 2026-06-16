"use client";

import React from "react";

interface BusIconProps {
  heading: number;
  status: "active" | "idle" | "maintenance" | string;
  size?: number;
}

const STATUS_COLORS: Record<string, { primary: string; glow: string }> = {
  active: { primary: "#10b981", glow: "rgba(16, 185, 129, 0.4)" },
  maintenance: { primary: "#ef4444", glow: "rgba(239, 68, 68, 0.4)" },
  idle: { primary: "#f59e0b", glow: "rgba(245, 158, 11, 0.4)" },
};

/**
 * Memoized bus icon — only re-renders when heading/status/size actually change.
 * Heading is rounded to nearest 5° so tiny GPS jitter doesn't cause re-renders.
 */
const BusIcon = React.memo(function BusIcon({ heading, status, size = 32 }: BusIconProps) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.idle;
  // Round heading to nearest 5° — prevents re-render on tiny gyro noise
  const snappedHeading = Math.round(heading / 5) * 5;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {/* Simple Active Pulse — uses CSS only, no React re-render */}
      {status === "active" && (
        <div className="absolute inset-0 rounded-full bg-status-active/20 animate-ping opacity-60" />
      )}
      
      {/* Directional Arrow — GPU-accelerated rotation via will-change */}
      <div
        className="relative z-10"
        style={{
          transform: `rotate(${snappedHeading}deg)`,
          transition: "transform 600ms cubic-bezier(0.4, 0, 0.2, 1)",
          willChange: "transform",
        }}
      >
        <svg 
          width={size * 0.7} 
          height={size * 0.7} 
          viewBox="0 0 24 24" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
        >
          <path 
            d="M12 2L20 20L12 16L4 20L12 2Z" 
            fill={colors.primary} 
            stroke="white" 
            strokeWidth="1"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Mini status indicator */}
      <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full border border-brand-dark" style={{ backgroundColor: colors.primary }} />
    </div>
  );
}, (prev, next) => {
  // Custom comparator: only re-render if heading bucket, status, or size changed
  return (
    Math.round(prev.heading / 5) === Math.round(next.heading / 5) &&
    prev.status === next.status &&
    prev.size === next.size
  );
});

export default BusIcon;
