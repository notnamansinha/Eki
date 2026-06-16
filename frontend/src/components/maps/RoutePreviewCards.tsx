"use client";

import React from "react";
import { Play, Clock, Navigation, Route } from "lucide-react";
import { RouteSummary } from "@/hooks/useGoogleDirections";

interface RoutePreviewCardsProps {
  routes: RouteSummary[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onStart: () => void;
  isLoading: boolean;
}

const RoutePreviewCards = React.memo(function RoutePreviewCards({
  routes,
  selectedIndex,
  onSelect,
  onStart,
  isLoading,
}: RoutePreviewCardsProps) {
  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory scrollbar-hide">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="min-w-[180px] bg-brand-surface/90 border border-white/5 rounded-[1.5rem] p-5 animate-pulse flex flex-col gap-3 snap-center"
          >
            <div className="h-3 bg-white/10 rounded-full w-2/3" />
            <div className="h-6 bg-white/10 rounded-full w-1/2" />
            <div className="h-3 bg-white/10 rounded-full w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  if (routes.length === 0) return null;

  // Determine "fastest" label
  const fastestIdx = routes.reduce(
    (min, r, i) => (r.duration < routes[min].duration ? i : min),
    0
  );

  // Determine traffic level from duration ratio relative to fastest
  const getTrafficColor = (duration: number) => {
    const ratio = duration / (routes[fastestIdx]?.duration || 1);
    if (ratio <= 1.05) return "bg-emerald-400"; // green — near-fastest
    if (ratio <= 1.25) return "bg-amber-400";   // yellow — moderate
    return "bg-red-400";                          // red — slow
  };

  return (
    <div className="flex gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory scrollbar-hide">
      {routes.map((route, idx) => {
        const isSelected = idx === selectedIndex;
        const isFastest = idx === fastestIdx;

        return (
          <div
            key={idx}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(idx)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(idx); }}
            className={`
              min-w-[200px] flex-shrink-0 snap-center rounded-[1.5rem] p-5 cursor-pointer
              transition-all duration-300 text-left relative overflow-hidden select-none
              ${isSelected
                ? "bg-white/95 border-2 border-blue-500 shadow-[0_0_30px_rgba(66,133,244,0.2)] scale-[1.02]"
                : "bg-brand-surface/90 border border-white/10 hover:border-white/20 hover:bg-brand-surface"
              }
            `}
          >
            {/* Fastest badge */}
            {isFastest && (
              <div className={`absolute top-3 right-3 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider ${
                isSelected ? "bg-blue-500 text-white" : "bg-emerald-500/20 text-emerald-400"
              }`}>
                Fastest
              </div>
            )}

            {/* Traffic indicator */}
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-2 h-2 rounded-full ${getTrafficColor(route.duration)}`} />
              <span className={`text-[9px] font-black uppercase tracking-[0.15em] ${
                isSelected ? "text-slate-400" : "text-white/30"
              }`}>
                Route {idx + 1}
              </span>
            </div>

            {/* Duration — hero metric */}
            <div className="flex items-baseline gap-1.5 mb-1">
              <Clock className={`w-3.5 h-3.5 ${isSelected ? "text-blue-500" : "text-white/30"}`} />
              <span className={`text-xl font-black tracking-tighter ${
                isSelected ? "text-slate-900" : "text-white"
              }`}>
                {route.durationText}
              </span>
            </div>

            {/* Distance */}
            <div className="flex items-center gap-1.5 mb-3">
              <Navigation className={`w-3 h-3 ${isSelected ? "text-slate-400" : "text-white/20"}`} />
              <span className={`text-[11px] font-bold ${
                isSelected ? "text-slate-500" : "text-white/40"
              }`}>
                {route.distanceText}
              </span>
            </div>

            {/* Route summary */}
            <div className="flex items-center gap-1.5 mb-3">
              <Route className={`w-3 h-3 flex-shrink-0 ${isSelected ? "text-slate-400" : "text-white/20"}`} />
              <span className={`text-[10px] font-bold truncate ${
                isSelected ? "text-slate-500" : "text-white/30"
              }`}>
                via {route.summary}
              </span>
            </div>

            {/* START button — only on selected route */}
            {isSelected && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStart();
                }}
                className="w-full mt-1 py-3 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-black text-xs uppercase tracking-[0.15em] flex items-center justify-center gap-2 shadow-lg hover:shadow-blue-500/30 active:scale-95 transition-all"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                Start
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
});

export default RoutePreviewCards;
