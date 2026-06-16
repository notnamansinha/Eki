"use client";

import React from "react";
import { MapPin, Bus, CheckCircle, Navigation } from "lucide-react";

export interface ETACardProps {
  stopName: string;
  stopShortName: string;
  etaMinutes: number;
  distanceKm: string;
  viaRoad: string;
  isArriving: boolean; // eta <= 2
  hasArrived: boolean; // eta === 0
  isLoading: boolean;
}

const ETACard = React.memo(function ETACard({
  stopName,
  stopShortName,
  etaMinutes,
  distanceKm,
  viaRoad,
  isArriving,
  hasArrived,
  isLoading,
}: ETACardProps) {
  if (isLoading) {
    return (
      <div className="w-full max-w-sm bg-brand-surface rounded-[2rem] border border-white/5 p-8 shadow-3xl flex flex-col gap-6 animate-pulse">
        <div className="h-4 bg-white/5 rounded-full w-1/3" />
        <div className="flex gap-4">
          <div className="w-12 h-12 bg-white/5 rounded-2xl" />
          <div className="flex-1 space-y-3">
            <div className="h-4 bg-white/5 rounded w-1/2" />
            <div className="h-3 bg-white/5 rounded w-1/4" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-4">
      {/* Arrival Alert Banner */}
      {isArriving && !hasArrived && (
        <div 
          className="bg-emerald-500/10 border border-emerald-500/20 rounded-[1.5rem] px-6 py-4 shadow-3xl flex items-center gap-4 animate-slide-up"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
             <Bus className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="flex flex-col">
            <span className="font-black text-xs uppercase tracking-widest text-emerald-400">Proximal Arrival</span>
            <span className="font-bold text-[10px] text-white/40 uppercase tracking-widest mt-1">{stopShortName} in ~{etaMinutes} min</span>
          </div>
        </div>
      )}

      {/* Arrived Banner */}
      {hasArrived && (
        <div className="bg-emerald-500 border border-emerald-400 rounded-[1.5rem] px-8 py-5 shadow-3xl flex items-center justify-center gap-3 animate-slide-up">
           <CheckCircle className="w-5 h-5 text-brand-dark" />
           <span className="text-brand-dark font-black text-xs uppercase tracking-widest leading-none">Vehicle Synchronized at {stopName}</span>
        </div>
      )}

      {/* Main ETA Card */}
      {!hasArrived && (
        <div className="bg-brand-surface/90 border border-white/5 rounded-[2.5rem] p-8 shadow-3xl w-full flex flex-col gap-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 blur-[50px] pointer-events-none" />
          
          {/* Top: Location Context */}
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-white/5 border border-white/5">
              <MapPin className="w-4 h-4 text-white/40" />
            </div>
            <div className="flex flex-col">
               <span className="text-[10px] font-black tracking-widest text-white/20 uppercase mb-0.5">Target Stop</span>
               <span className="text-white font-bold text-base tracking-tight">{stopName}</span>
            </div>
          </div>

          {/* Bottom: Live Metrics */}
          <div className="flex items-center gap-6 bg-brand-dark/40 p-6 rounded-[1.5rem] border border-white/5 shadow-inner">
            <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center shadow-2xl">
               <Bus className="w-6 h-6 text-brand-dark" />
            </div>
            <div className="flex flex-col flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-white text-2xl font-black tracking-tighter">
                  {etaMinutes}
                </span>
                <span className="text-white/30 text-xs font-black uppercase tracking-widest leading-none pb-1">MINUTES</span>
              </div>
              <div className="flex items-center gap-2 mt-1.5 overflow-hidden">
                <Navigation className="w-3 h-3 text-white/20 flex-shrink-0" />
                <span className="text-white/40 font-bold text-[10px] uppercase tracking-widest truncate">
                  {distanceKm}km via {viaRoad}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default ETACard;
