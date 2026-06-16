"use client";

import { useState, useEffect } from "react";
import { useRoutes } from "@/hooks/useRoutes";
import { Bus, Navigation, Play, Square, ChevronDown, ChevronUp, MapPin } from "lucide-react";

import { DriverData } from "@/hooks/useDrivers";
import { BusData } from "@/hooks/useBuses";

interface Props {
  onNewRequest?: (req: any) => void;
  busId: string;
  driverId: string;
  setDriverId: (id: string) => void;
  buses: BusData[];
  setSelectedBusId: (id: string) => void;
  drivers: DriverData[];
  selectedRouteIds: string[];
  setSelectedRouteIds: (ids: string[]) => void;
  isTracking: boolean;
  onStartTracking: () => void;
  onStopTracking: () => void;
  onRouteUpdate?: (routeIds: string[]) => void;
  isSocketConnected?: boolean;
}

export default function TransmitterControls({
  busId,
  driverId,
  setDriverId,
  buses,
  setSelectedBusId,
  drivers,
  selectedRouteIds,
  setSelectedRouteIds,
  isTracking,
  onStartTracking,
  onStopTracking,
  onRouteUpdate,
  isSocketConnected = false,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(true);
  const { routes } = useRoutes();

  useEffect(() => {
    if (isTracking) {
      setIsExpanded(false);
    } else {
      setIsExpanded(true);
    }
  }, [isTracking]);

  return (
    <div className={`flex flex-col w-full bg-brand-dark rounded-t-3xl border-t border-white/10 shadow-2xl transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] overflow-hidden relative`}>
      {/* Drag Handle / Header */}
      <div 
        className="w-full h-[60px] flex items-center justify-between px-6 cursor-pointer relative"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-white/20 rounded-full" />
        <div className="flex items-center gap-3 mt-2">
          <Navigation className="w-4 h-4 text-white/50" />
          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white/70">
            Transmitter Controls
          </span>
        </div>
        <div className="mt-2 text-white/40">
          {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
        </div>
      </div>

      <div className={`px-6 md:px-8 gap-5 md:gap-6 flex-col overflow-y-auto max-h-[55vh] ${isExpanded ? 'flex pb-8' : 'hidden'}`}>

        {/* Hardware Selector */}
        {!isTracking ? (
          <div className="space-y-3">
            <label className="text-[10px] text-white/20 font-black uppercase tracking-[0.2em] px-1">Hardware Identity (Fleet Vehicle)</label>
            <div className="relative group">
              <select
                value={busId}
                onChange={(e) => setSelectedBusId(e.target.value)}
                className="w-full h-14 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-2xl px-6 py-2.5 text-white text-sm font-bold focus:outline-none focus:ring-2 focus:ring-white/20 appearance-none shadow-2xl transition-all cursor-pointer"
              >
                <option value="" className="bg-[#1a1c29] text-white min-h-[40px]">— SELECT VEHICLE —</option>
                {buses.map((b) => (
                  <option key={b.id} value={b.id} className="bg-[#1a1c29] text-white min-h-[40px]">{b.name} ({b.id})</option>
                ))}
              </select>
              <ChevronDown className="absolute right-6 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 group-hover:text-white/60 transition-colors pointer-events-none" />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="text-[10px] text-white/20 font-black uppercase tracking-[0.2em] px-1">Hardware Identity</label>
            <div className="w-full bg-brand-dark/40 border border-white/5 rounded-2xl px-6 py-4 text-white text-sm flex items-center justify-between shadow-inner">
              <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                  <Bus className="w-4 h-4 text-white/50" />
                </div>
                <span className="font-black font-mono tracking-widest text-white/80">{busId || "UNASSIGNED"}</span>
              </div>
              <div className="flex items-center gap-2">
                 {isTracking ? (
                   <>
                     <span className="w-2 h-2 rounded-full bg-status-active shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                     <span className="text-[9px] font-black tracking-widest text-status-active uppercase">Operational</span>
                   </>
                 ) : (
                   <>
                     <span className="w-2 h-2 rounded-full bg-white/20" />
                     <span className="text-[9px] font-black tracking-widest text-white/40 uppercase">Offline</span>
                   </>
                 )}
              </div>
            </div>
          </div>
        )}

        {/* Operator Selector */}
        {!isTracking && (
          <div className="space-y-3">
            <label className="text-[10px] text-white/20 font-black uppercase tracking-[0.2em] px-1">Operator Identity</label>
            <div className="relative group">
              <select
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                className="w-full h-14 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-2xl px-6 py-2.5 text-white text-sm font-bold focus:outline-none focus:ring-2 focus:ring-white/20 appearance-none shadow-2xl transition-all cursor-pointer"
              >
                <option value="" className="bg-[#1a1c29] text-white min-h-[40px]">— SELECT OPERATOR —</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id} className="bg-[#1a1c29] text-white min-h-[40px]">{d.name} ({d.id})</option>
                ))}
              </select>
              <ChevronDown className="absolute right-6 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 group-hover:text-white/60 transition-colors pointer-events-none" />
            </div>
          </div>
        )}

        {/* Path Selector - Single Select */}
        <div className="space-y-3">
          <label className="text-[10px] text-white/20 font-black uppercase tracking-[0.2em] px-1">Active Route ({selectedRouteIds.length > 0 ? 1 : 0} selected)</label>
          <div className="bg-brand-dark/40 border border-white/5 rounded-2xl overflow-hidden shadow-inner">
            {!busId ? (
              <p className="text-[10px] text-white/20 font-bold uppercase tracking-widest text-center py-4">Select a vehicle first</p>
            ) : (() => {
              if (buses.length === 0 || routes.length === 0) {
                return <p className="text-[10px] text-white/20 font-bold uppercase tracking-widest text-center py-4 animate-pulse">Synchronizing Fleet Data...</p>;
              }

              const activeBus = buses.find(b => b.id === busId);
              // Backward compatibility for legacy assignedRouteId
              const busRoutes = activeBus?.assignedRoutes || ((activeBus as any)?.assignedRouteId ? [(activeBus as any).assignedRouteId] : []);
              const allowedRoutes = routes.filter(r => busRoutes.includes(r.id));
              
              if (allowedRoutes.length === 0) {
                return (
                  <div className="flex flex-col items-center py-6 px-4 text-center">
                    <p className="text-[10px] text-red-400 font-bold uppercase tracking-widest mb-1">No Routes Assigned</p>
                    <p className="text-[9px] text-white/20 font-medium">Vehicle "{busId}" is not authorized for any routes in the Admin Panel.</p>
                  </div>
                );
              }

              return allowedRoutes.map((r) => {
                const isSelected = selectedRouteIds.includes(r.id);
                return (
                  <label
                    key={r.id}
                    className={`flex items-center gap-4 px-5 py-4 cursor-pointer border-b border-white/5 last:border-b-0 transition-all ${
                      isSelected ? 'bg-white/5' : 'hover:bg-white/3'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                      isSelected ? 'border-emerald-400 bg-emerald-500/20' : 'border-white/20 bg-transparent'
                    }`}>
                      {isSelected && <div className="w-2.5 h-2.5 bg-emerald-400 rounded-full" />}
                    </div>
                    <input
                      type="radio"
                      name="transmitterRoute"
                      className="sr-only"
                      checked={isSelected}
                      disabled={isTracking}
                      onChange={() => {
                        setSelectedRouteIds([r.id]);
                        if (isTracking) onRouteUpdate?.([r.id]);
                      }}
                    />
                    <div className="flex flex-col">
                      <span className={`text-sm font-bold tracking-tight ${isSelected ? 'text-white' : 'text-white/40'}`}>{r.name}</span>
                      <span className="text-[9px] font-mono text-white/20 tracking-widest">{r.id}</span>
                    </div>
                  </label>
                );
              });
            })()}
          </div>
        </div>
        
        {/* Expanded Tracking Controls */}
        <div className="pt-4">
          {!isTracking ? (
          <button
              aria-label="Go live and start transmitting location"
              onClick={onStartTracking}
              disabled={!busId || !driverId || selectedRouteIds.length === 0 || !isSocketConnected}
              className="w-full py-5 rounded-[1.5rem] bg-white text-brand-dark font-black text-sm hover:scale-[1.02] active:scale-95 transition-all shadow-3xl flex items-center justify-center gap-3 tracking-[0.1em] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {!isSocketConnected ? (
                <>
                  <span className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
                  CONNECTING…
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-brand-dark" />
                  GO LIVE
                </>
              )}
            </button>
          ) : (
          <button
              aria-label="End shift and stop transmitting"
              onClick={onStopTracking}
              className="w-full py-5 rounded-[1.5rem] bg-red-500 text-white font-black text-sm hover:scale-[1.02] active:scale-95 transition-all shadow-3xl shadow-red-500/20 flex items-center justify-center gap-3 tracking-[0.1em]"
            >
              <Square className="w-4 h-4 fill-white" />
              END SHIFT
            </button>
          )}
        </div>
      </div>

      {/* Collapsed View (Live Tracking Bar) */}
      {!isExpanded && isTracking && (
        <div className="px-8 pb-6 flex items-center justify-between gap-4 animate-slide-up">
          <div className="flex flex-col flex-1" onClick={() => setIsExpanded(true)}>
             <div className="flex items-center gap-2 mb-1">
               <span className="w-2.5 h-2.5 rounded-full bg-status-active shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
               <span className="text-[10px] font-black text-status-active uppercase tracking-widest">TRANSMITTING</span>
             </div>
             <div className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-white/20" />
                <span className="text-sm font-bold text-white tracking-tight">
                  {selectedRouteIds.length} Route{selectedRouteIds.length !== 1 ? 's' : ''} Active
                </span>
             </div>
          </div>
          <button
            aria-label="Stop transmitting and go offline"
            onClick={onStopTracking}
            className="h-12 px-6 rounded-2xl bg-white/5 border border-white/5 text-red-500 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-red-500 hover:text-white transition-all shadow-2xl"
          >
            END SHIFT
          </button>
        </div>
      )}
    </div>
  );
}
