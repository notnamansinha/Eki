import React from 'react';
import { RouteData } from '@/hooks/useRoutes';
import { Navigation, ArrowRight } from 'lucide-react';

interface RouteCardProps {
  route: RouteData;
  isSelected: boolean;
  onSelect: (id: string) => void;
  activeBusesCount?: number;
}

export default function RouteCard({ route, isSelected, onSelect, activeBusesCount = 0 }: RouteCardProps) {
  const routeColor = route.color || "var(--accent)";
  const stops = route.stops ?? [];
  const firstStop = stops[0];
  const lastStop = stops[stops.length - 1];

  return (
    <button
      onClick={() => onSelect(route.id)}
      className={`w-full text-left transition-all duration-200 rounded-xl p-4 border relative overflow-hidden group
        ${isSelected 
          ? 'border-[var(--border-hover)]' 
          : 'border-[var(--border-subtle)] hover:border-[var(--border-hover)]'}`}
      style={{
        background: isSelected ? "var(--surface-3)" : "var(--surface-2)",
      }}
    >
      {/* Route color strip */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl"
        style={{ background: routeColor }}
      />

      <div className="pl-2">
        {/* Top row: name + active badge */}
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold tracking-tight text-[15px]" style={{ color: "var(--text-primary)" }}>
            {route.name}
          </h3>
          {activeBusesCount > 0 ? (
            <div className="status-live" style={{ fontSize: "9px", padding: "2px 8px" }}>
              {activeBusesCount} live
            </div>
          ) : (
            <span className="text-[10px] font-semibold" style={{ color: "var(--text-ghost)" }}>
              Offline
            </span>
          )}
        </div>

        {/* Route summary: first → last stop */}
        {firstStop && lastStop && (
          <div className="flex items-center gap-1.5 mb-3 text-[12px] font-medium" style={{ color: "var(--text-tertiary)" }}>
            <span className="truncate max-w-[120px]">{firstStop.shortName || firstStop.name}</span>
            <ArrowRight className="w-3 h-3 shrink-0" style={{ color: "var(--text-ghost)" }} />
            <span className="truncate max-w-[120px]">{lastStop.shortName || lastStop.name}</span>
          </div>
        )}

        {/* Bottom: stop count */}
        <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "var(--text-ghost)" }}>
          <Navigation className="w-3 h-3" />
          <span>{stops.length} stops</span>
        </div>
      </div>
    </button>
  );
}
