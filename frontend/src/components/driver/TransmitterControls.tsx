"use client";

import { useState } from "react";
import { Navigation, Play, ChevronDown, ChevronUp } from "lucide-react";
import CustomSelect from "@/components/ui/CustomSelect";

import { DriverData } from "@/hooks/useDrivers";
import { BusData } from "@/hooks/useBuses";
import { RouteData } from "@/hooks/useRoutes";

interface Props {
  busId: string;
  driverId: string;
  setDriverId: (id: string) => void;
  buses: BusData[];
  setSelectedBusId: (id: string) => void;
  drivers: DriverData[];
  routes: RouteData[];
  selectedRouteIds: string[];
  setSelectedRouteIds: (ids: string[]) => void;
  onStartTracking: () => void;
}

export default function TransmitterControls({
  busId,
  driverId,
  setDriverId,
  buses,
  setSelectedBusId,
  drivers,
  routes,
  selectedRouteIds,
  setSelectedRouteIds,
  onStartTracking,
}: Props) {
  const [expanded, setExpanded] = useState(true);

  const vehicleOptions = [
    { value: "", label: "Select vehicle…" },
    ...buses.map((b) => ({ value: b.id, label: `${b.name} (${b.id})` })),
  ];

  const assignedDriver = drivers.find((driver) => driver.id === driverId);
  const operatorOptions = [
    { value: "", label: "Select operator…" },
    ...(assignedDriver ? [{ value: assignedDriver.id, label: `${assignedDriver.name} (${assignedDriver.id})` }] : []),
  ];

  return (
    <div className="w-full shadow-2xl overflow-hidden rounded-2xl animate-fade-in transition-all duration-300"
      style={{ 
        background: "var(--surface-2)", 
        border: "1px solid var(--border-default)" 
      }}>
      
      {/* Header bar */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="trip-setup-controls"
        className="w-full px-5 py-4 flex items-center justify-between cursor-pointer select-none text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" 
            style={{ background: "rgba(59, 130, 246, 0.15)", color: "#60a5fa" }}>
            <Navigation className="w-4 h-4" />
          </div>
          <span className="text-[13px] font-semibold tracking-wide" style={{ color: "var(--text-primary)" }}>
            Trip Setup
          </span>
        </div>
        <div className="mt-1" style={{ color: "var(--text-ghost)" }}>
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </div>
      </button>

      <div id="trip-setup-controls" className={`px-5 gap-4 flex-col overflow-y-auto max-h-[55vh] ${expanded ? 'flex pb-6' : 'hidden'}`}>

        {/* Vehicle Selector */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold px-0.5" style={{ color: "var(--text-ghost)" }}>
            Vehicle
          </label>
          <CustomSelect
            ariaLabel="Vehicle"
            value={busId}
            onChange={(val) => setSelectedBusId(val)}
            options={vehicleOptions}
            placeholder="Select vehicle…"
            style={{
              background: "var(--surface-3)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          />
        </div>

        {/* Operator Selector */}
        <div className="space-y-1.5">
            <label className="text-[10px] font-semibold px-0.5" style={{ color: "var(--text-ghost)" }}>
              Operator
            </label>
            <CustomSelect
              ariaLabel="Operator"
              value={driverId}
              onChange={(val) => setDriverId(val)}
              disabled
              options={operatorOptions}
              placeholder="Select operator…"
              style={{ 
                background: "var(--surface-3)", 
                border: "1px solid var(--border-default)", 
                color: "var(--text-primary)" 
              }}
            />
        </div>

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
                      onChange={() => {
                        setSelectedRouteIds([r.id]);
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
          <button
              aria-label="Arm ride for automatic start at stop one"
              onClick={onStartTracking}
              disabled={!busId || !driverId || !drivers.some(d => d.id === driverId) || selectedRouteIds.length === 0}
              className="w-full py-4 rounded-xl font-semibold text-[14px] active:scale-[0.98] transition-all flex items-center justify-center gap-2.5 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
            >
              <Play className="w-4 h-4" style={{ fill: "var(--surface-0)" }} />
              Arm Ride
            </button>
        </div>
      </div>
    </div>
  );
}
