"use client";

import { useState } from "react";
import { useRoutes } from "@/hooks/useRoutes";
import { BusFront as Bus, Navigation, Play, Square, ChevronDown, ChevronUp, MapPin } from "lucide-react";

import { DriverData } from "@/hooks/useDrivers";
import { BusData } from "@/hooks/useBuses";

interface Props {
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
  const expanded = !isTracking && isExpanded;

  return (
    <div className="flex flex-col w-full rounded-t-2xl overflow-hidden relative transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
      style={{ background: "var(--surface-1)", borderTop: "1px solid var(--border-default)" }}>
      {/* Handle / Header */}
      <div 
        className="w-full h-[52px] flex items-center justify-between px-5 cursor-pointer relative"
        onClick={() => !isTracking && setIsExpanded(!isExpanded)}
      >
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full" style={{ background: "var(--surface-4)" }} />
        <div className="flex items-center gap-2.5 mt-1">
          <Navigation className="w-3.5 h-3.5" style={{ color: "var(--text-ghost)" }} />
          <span className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
            Transmitter Controls
          </span>
        </div>
        <div className="mt-1" style={{ color: "var(--text-ghost)" }}>
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </div>
      </div>

      <div className={`px-5 gap-4 flex-col overflow-y-auto max-h-[55vh] ${expanded ? 'flex pb-6' : 'hidden'}`}>

        {/* Vehicle Selector */}
        {!isTracking ? (
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold px-0.5" style={{ color: "var(--text-ghost)" }}>
              Vehicle
            </label>
            <div className="relative">
              <select
                value={busId}
                onChange={(e) => setSelectedBusId(e.target.value)}
                className="w-full h-12 rounded-xl px-4 pr-10 text-[13px] font-semibold focus:outline-none appearance-none cursor-pointer transition-all"
                style={{ 
                  background: "var(--surface-3)", 
                  border: "1px solid var(--border-default)", 
                  color: "var(--text-primary)" 
                }}
              >
                <option value="" style={{ background: "var(--surface-2)" }}>Select vehicle…</option>
                {buses.map((b) => (
                  <option key={b.id} value={b.id} style={{ background: "var(--surface-2)" }}>{b.name} ({b.id})</option>
                ))}
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "var(--text-ghost)" }} />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold px-0.5" style={{ color: "var(--text-ghost)" }}>
              Vehicle
            </label>
            <div className="w-full rounded-xl px-4 py-3 text-[13px] flex items-center justify-between"
              style={{ background: "var(--surface-3)", border: "1px solid var(--border-subtle)" }}>
              <div className="flex items-center gap-3">
                <Bus className="w-4 h-4" style={{ color: "var(--text-ghost)" }} />
                <span className="font-semibold tabular-nums tracking-wide" style={{ color: "var(--text-secondary)" }}>
                  {busId || "UNASSIGNED"}
                </span>
              </div>
              {isTracking && (
                <div className="status-live" style={{ fontSize: "9px", padding: "2px 8px" }}>
                  Live
                </div>
              )}
            </div>
          </div>
        )}

        {/* Operator Selector */}
        {!isTracking && (
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold px-0.5" style={{ color: "var(--text-ghost)" }}>
              Operator
            </label>
            <div className="relative">
              <select
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                disabled
                className="w-full h-12 rounded-xl px-4 pr-10 text-[13px] font-semibold focus:outline-none appearance-none cursor-pointer transition-all"
                style={{ 
                  background: "var(--surface-3)", 
                  border: "1px solid var(--border-default)", 
                  color: "var(--text-primary)" 
                }}
              >
                <option value="" style={{ background: "var(--surface-2)" }}>Select operator…</option>
                {drivers.filter((driver) => driver.id === driverId).map((d) => (
                  <option key={d.id} value={d.id} style={{ background: "var(--surface-2)" }}>{d.name} ({d.id})</option>
                ))}
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "var(--text-ghost)" }} />
            </div>
          </div>
        )}

        {/* Route Selector */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold px-0.5" style={{ color: "var(--text-ghost)" }}>
            Route {selectedRouteIds.length > 0 ? "· 1 selected" : ""}
          </label>
          <div className="rounded-xl overflow-hidden" style={{ background: "var(--surface-3)", border: "1px solid var(--border-subtle)" }}>
            {!busId ? (
              <p className="text-[11px] font-medium text-center py-4" style={{ color: "var(--text-ghost)" }}>
                Select a vehicle first
              </p>
            ) : (() => {
              if (buses.length === 0 || routes.length === 0) {
                return <p className="text-[11px] font-medium text-center py-4 animate-pulse" style={{ color: "var(--text-ghost)" }}>Loading fleet data…</p>;
              }

              const activeBus = buses.find(b => b.id === busId);
              const busRoutes = activeBus?.assignedRoutes || (activeBus?.assignedRouteId ? [activeBus.assignedRouteId] : []);
              const allowedRoutes = routes.filter(r => busRoutes.includes(r.id));
              
              if (allowedRoutes.length === 0) {
                return (
                  <div className="flex flex-col items-center py-5 px-4 text-center">
                    <p className="text-[11px] font-semibold mb-0.5" style={{ color: "var(--status-danger)" }}>No routes assigned</p>
                    <p className="text-[10px]" style={{ color: "var(--text-ghost)" }}>Vehicle &quot;{busId}&quot; has no authorized routes.</p>
                  </div>
                );
              }

              return allowedRoutes.map((r) => {
                const isSelected = selectedRouteIds.includes(r.id);
                return (
                  <label
                    key={r.id}
                    className="flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-colors"
                    style={{ 
                      borderBottom: "1px solid var(--border-subtle)",
                      background: isSelected ? "var(--surface-4)" : "transparent",
                    }}
                  >
                    <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
                      style={{
                        borderColor: isSelected ? "var(--status-live)" : "var(--text-ghost)",
                        background: isSelected ? "rgba(52,211,153,0.15)" : "transparent",
                      }}>
                      {isSelected && <div className="w-2 h-2 rounded-full" style={{ background: "var(--status-live)" }} />}
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
                      <span className="text-[13px] font-semibold" style={{ color: isSelected ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                        {r.name}
                      </span>
                      <span className="text-[9px] tabular-nums" style={{ color: "var(--text-ghost)" }}>{r.id}</span>
                    </div>
                  </label>
                );
              });
            })()}
          </div>
        </div>
        
        {/* Action Button */}
        <div className="pt-2">
          {!isTracking ? (
          <button
              aria-label="Go live and start transmitting location"
              onClick={onStartTracking}
              disabled={!busId || !driverId || !drivers.some(d => d.id === driverId) || selectedRouteIds.length === 0 || !isSocketConnected}
              className="w-full py-4 rounded-xl font-semibold text-[14px] active:scale-[0.98] transition-all flex items-center justify-center gap-2.5 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
            >
              {!isSocketConnected ? (
                <>
                  <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: "var(--status-warning)" }} />
                  Connecting…
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" style={{ fill: "var(--surface-0)" }} />
                  Go Live
                </>
              )}
            </button>
          ) : (
          <button
              aria-label="End shift and stop transmitting"
              onClick={onStopTracking}
              className="w-full py-4 rounded-xl font-semibold text-[14px] active:scale-[0.98] transition-all flex items-center justify-center gap-2.5"
              style={{ background: "var(--status-danger)", color: "white" }}
            >
              <Square className="w-4 h-4" style={{ fill: "white" }} />
              End Shift
            </button>
          )}
        </div>
      </div>

      {/* Collapsed Tracking Bar */}
      {!isExpanded && isTracking && (
        <div className="px-5 pb-5 flex items-center justify-between gap-4 animate-slide-up">
          <div className="flex flex-col flex-1 cursor-pointer" onClick={() => setIsExpanded(true)}>
             <div className="status-live mb-1" style={{ fontSize: "9px", padding: "2px 8px", width: "fit-content" }}>
               Transmitting
             </div>
             <div className="flex items-center gap-1.5">
                <MapPin className="w-3 h-3" style={{ color: "var(--text-ghost)" }} />
                <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                  {selectedRouteIds.length} Route{selectedRouteIds.length !== 1 ? 's' : ''} Active
                </span>
             </div>
          </div>
          <button
            aria-label="Stop transmitting and go offline"
            onClick={onStopTracking}
            className="h-10 px-5 rounded-xl text-[11px] font-semibold transition-all"
            style={{ 
              background: "var(--status-danger-bg)", 
              border: "1px solid rgba(248,113,113,0.15)", 
              color: "var(--status-danger)" 
            }}
          >
            End Shift
          </button>
        </div>
      )}
    </div>
  );
}
