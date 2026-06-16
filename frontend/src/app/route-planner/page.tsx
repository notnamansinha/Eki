"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, MapPin, ArrowRight, Navigation2, ChevronDown, Loader2, AlertCircle, GitBranch, Route, X, RefreshCw } from "lucide-react";
import { PREDEFINED_ROUTES } from "@/lib/predefinedRoutes";

const RoutePlannerMap = dynamic(() => import("@/components/maps/RoutePlannerMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#0f1117]">
      <Loader2 className="w-8 h-8 text-white/20 animate-spin" />
    </div>
  ),
});

// ── Types ──────────────────────────────────────────────────────────────────────
interface Stop {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lng: number;
}

interface PlanResult {
  routeId: string;
  routeName: string;
  routeColor: string;
  startStop: Stop;
  endStop: Stop;
  viaStop: Stop | null;
  stopsOnSegment: Stop[];
  polyline: string;
  totalStops: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

// ── Helpers ────────────────────────────────────────────────────────────────────
function StopDot({ color, size = 10, pulse = false }: { color: string; size?: number; pulse?: boolean }) {
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {pulse && (
        <div className="absolute inset-0 rounded-full animate-ping opacity-40" style={{ background: color }} />
      )}
      <div
        className="rounded-full border-2 border-[#0f1117] z-10"
        style={{ width: size, height: size, background: color }}
      />
    </div>
  );
}

function SelectBox({
  label,
  value,
  options,
  onChange,
  disabled,
  accentColor,
  icon,
  placeholder,
  optional,
  onClear,
}: {
  label: string;
  value: string;
  options: Stop[];
  onChange: (v: string) => void;
  disabled?: boolean;
  accentColor?: string;
  icon?: React.ReactNode;
  placeholder?: string;
  optional?: boolean;
  onClear?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40 flex items-center gap-1.5">
          {icon}
          {label}
          {optional && <span className="text-white/20 font-normal normal-case tracking-normal text-[9px]">(optional)</span>}
        </label>
        {optional && value && onClear && (
          <button
            onClick={onClear}
            className="text-white/30 hover:text-white/70 transition-colors p-0.5 rounded"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`
            w-full h-12 pl-4 pr-10 rounded-2xl text-sm font-semibold text-white
            appearance-none cursor-pointer transition-all outline-none
            ${disabled
              ? "bg-white/3 border border-white/5 text-white/30 cursor-not-allowed"
              : "bg-white/8 border border-white/10 hover:bg-white/12 hover:border-white/20 focus:border-white/30 focus:ring-2 focus:ring-white/10"
            }
          `}
          style={value && !disabled ? { borderColor: `${accentColor}50` } : {}}
        >
          <option value="" className="bg-[#1a1c29] text-white/50">
            {placeholder || `Select ${label}`}
          </option>
          {options.map((s) => (
            <option key={s.id} value={s.id} className="bg-[#1a1c29] text-white font-bold">
              {s.name}
            </option>
          ))}
        </select>
        <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-white/30">
          <ChevronDown className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function RoutePlannerPage() {
  const [selectedRouteId, setSelectedRouteId] = useState("route_rto_iskon");
  const [startStopId, setStartStopId] = useState("");
  const [endStopId, setEndStopId] = useState("");
  const [viaStopId, setViaStopId] = useState("");
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [clickedStop, setClickedStop] = useState<Stop | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Find the selected route definition
  const selectedRoute = PREDEFINED_ROUTES.find((r) => r.id === selectedRouteId);
  const stops = selectedRoute?.stops ?? [];

  // Stops available for each field (exclude the other selected stops)
  const startStops = stops.filter((s) => s.id !== endStopId && s.id !== viaStopId);
  const endStops   = stops.filter((s) => s.id !== startStopId && s.id !== viaStopId);
  const viaStops   = stops.filter(
    (s) => s.id !== startStopId && s.id !== endStopId && s.id !== stops[0]?.id && s.id !== stops[stops.length - 1]?.id
  );

  // Reset selections when route changes
  useEffect(() => {
    setStartStopId("");
    setEndStopId("");
    setViaStopId("");
    setPlanResult(null);
    setError(null);
  }, [selectedRouteId]);

  // Auto-trigger plan when both stops are selected
  const fetchPlan = useCallback(async (
    routeId: string,
    startId: string,
    endId: string,
    viaId: string
  ) => {
    if (!routeId || !startId || !endId) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routeId,
          startStopId: startId,
          endStopId: endId,
          viaStopId: viaId || undefined,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server returned ${res.status}`);
      }

      const data = await res.json() as PlanResult;
      setPlanResult(data);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to plan route");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (startStopId && endStopId) {
      fetchPlan(selectedRouteId, startStopId, endStopId, viaStopId);
    } else {
      setPlanResult(null);
    }
  }, [selectedRouteId, startStopId, endStopId, viaStopId, fetchPlan]);

  // When user clicks a stop marker on the map
  const handleStopClick = (stop: Stop) => {
    setClickedStop(stop);
  };

  const handleSetAs = (role: "start" | "end" | "via") => {
    if (!clickedStop) return;
    if (role === "start") setStartStopId(clickedStop.id);
    if (role === "end")   setEndStopId(clickedStop.id);
    if (role === "via")   setViaStopId(clickedStop.id);
    setClickedStop(null);
  };

  const routeColor = selectedRoute?.color ?? "#3b82f6";
  const hasResult = !!planResult;

  return (
    <div
      className="relative flex flex-col h-screen overflow-hidden"
      style={{ background: "#0f1117", fontFamily: "'Inter', sans-serif" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        * { -webkit-font-smoothing: antialiased; }
        @keyframes pulse { 0%,100%{opacity:.4;transform:scale(1)} 50%{opacity:.1;transform:scale(2)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
        .fade-in { animation: fadeIn 0.3s ease both; }
        .slide-up { animation: slideUp 0.35s cubic-bezier(0.34,1.56,0.64,1) both; }
        .stop-row:hover .stop-action { opacity: 1; }
        select option { background: #1a1c29; }
        ::-webkit-scrollbar { width: 4px; } 
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
      `}</style>

      {/* ── FULL-SCREEN MAP ─────────────────────────────────────────────────── */}
      <div className="absolute inset-0 z-0">
        <RoutePlannerMap
          stopsOnSegment={planResult?.stopsOnSegment ?? []}
          polyline={planResult?.polyline ?? ""}
          routeColor={routeColor}
          startStopId={startStopId}
          endStopId={endStopId}
          viaStopId={viaStopId || null}
          onStopClick={handleStopClick}
        />
      </div>

      {/* ── TOP NAV BAR ─────────────────────────────────────────────────────── */}
      <div
        className="relative z-30 flex items-center gap-3 px-4 py-3"
        style={{
          background: "linear-gradient(180deg, rgba(15,17,23,0.98) 0%, rgba(15,17,23,0.7) 100%)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <Link
          href="/"
          className="flex items-center justify-center w-9 h-9 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: routeColor }} />
            <p className="text-xs font-black text-white uppercase tracking-[0.15em] truncate">
              Route Planner
            </p>
          </div>
          <p className="text-[10px] text-white/30 truncate mt-0.5">
            {selectedRoute?.name ?? "Select a route"}
          </p>
        </div>

        <button
          onClick={() => setIsPanelOpen((p) => !p)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-all text-xs font-bold"
        >
          <Route className="w-3.5 h-3.5" />
          {isPanelOpen ? "Map" : "Plan"}
        </button>
      </div>

      {/* ── PLANNER PANEL ───────────────────────────────────────────────────── */}
      <div
        className={`
          relative z-20 transition-all duration-500 overflow-hidden flex-shrink-0
          ${isPanelOpen ? "max-h-[75vh]" : "max-h-0"}
        `}
      >
        <div
          className="overflow-y-auto"
          style={{
            background: "rgba(15,17,23,0.97)",
            backdropFilter: "blur(24px)",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <div className="px-4 pt-4 pb-3 space-y-4 max-w-lg mx-auto">
            {/* Route selector */}
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40 flex items-center gap-1.5 mb-1.5">
                <GitBranch className="w-3 h-3" />
                Select Route
              </label>
              <div className="relative">
                <select
                  value={selectedRouteId}
                  onChange={(e) => setSelectedRouteId(e.target.value)}
                  className="w-full h-12 pl-4 pr-10 rounded-2xl text-sm font-bold text-white bg-white/8 border border-white/10 hover:bg-white/12 hover:border-white/20 focus:border-white/30 focus:ring-2 focus:ring-white/10 appearance-none cursor-pointer transition-all outline-none"
                  style={{ borderColor: `${routeColor}40` }}
                >
                  {PREDEFINED_ROUTES.map((r) => (
                    <option key={r.id} value={r.id} className="bg-[#1a1c29] text-white">
                      {r.name}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-white/30">
                  <ChevronDown className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* === From / To / Via row */}
            <div className="grid grid-cols-1 gap-3">
              <SelectBox
                label="From"
                value={startStopId}
                options={startStops}
                onChange={setStartStopId}
                accentColor="#22c55e"
                icon={<div className="w-2 h-2 rounded-full bg-emerald-500" />}
                placeholder="Select departure stop"
              />

              {/* Swap button */}
              <div className="flex justify-center -my-1">
                <button
                  onClick={() => {
                    const tmp = startStopId;
                    setStartStopId(endStopId);
                    setEndStopId(tmp);
                  }}
                  disabled={!startStopId || !endStopId}
                  className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                  title="Swap start and end"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              <SelectBox
                label="To"
                value={endStopId}
                options={endStops}
                onChange={setEndStopId}
                accentColor="#ef4444"
                icon={<div className="w-2 h-2 rounded-full bg-red-500" />}
                placeholder="Select destination stop"
              />

              {viaStops.length > 0 && (
                <SelectBox
                  label="Via"
                  value={viaStopId}
                  options={viaStops}
                  onChange={setViaStopId}
                  accentColor="#f59e0b"
                  icon={<div className="w-2 h-2 rounded-full bg-amber-500" />}
                  placeholder="Add an intermediate stop"
                  optional
                  onClear={() => setViaStopId("")}
                />
              )}
            </div>

            {/* ── Status indicators ─────────────────────────────────────────── */}
            {loading && (
              <div className="flex items-center gap-2 text-white/50 text-xs fade-in py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Planning your route…
              </div>
            )}

            {error && !loading && (
              <div className="flex items-center gap-2 text-red-400 text-xs fade-in bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* ── Trip Summary ──────────────────────────────────────────────── */}
            {hasResult && !loading && !error && (
              <div className="fade-in rounded-2xl overflow-hidden border border-white/8" style={{ background: "rgba(255,255,255,0.04)" }}>
                {/* Header */}
                <div className="px-4 pt-3.5 pb-2.5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="flex items-center gap-2">
                    <Navigation2 className="w-3.5 h-3.5" style={{ color: routeColor }} />
                    <span className="text-xs font-black text-white uppercase tracking-[0.1em]">Your Trip</span>
                  </div>
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ background: `${routeColor}20`, color: routeColor }}>
                    {planResult!.totalStops} stops
                  </span>
                </div>

                {/* Stop list */}
                <div className="px-4 py-3 space-y-0 max-h-[200px] overflow-y-auto">
                  {planResult!.stopsOnSegment.map((stop, i) => {
                    const isFirst = i === 0;
                    const isLast  = i === planResult!.stopsOnSegment.length - 1;
                    const isVia   = stop.id === viaStopId;

                    return (
                      <div key={`${stop.id}-${i}`} className="flex items-start gap-3 stop-row">
                        {/* Connector line */}
                        <div className="flex flex-col items-center pt-1 gap-0">
                          <StopDot
                            color={isFirst ? "#22c55e" : isLast ? "#ef4444" : isVia ? "#f59e0b" : routeColor}
                            size={isFirst || isLast ? 14 : 10}
                            pulse={isFirst || isLast}
                          />
                          {!isLast && (
                            <div className="w-px flex-1 min-h-[20px] mt-1 mb-1 opacity-30" style={{ background: routeColor }} />
                          )}
                        </div>

                        {/* Stop name */}
                        <div className="flex-1 pb-3 min-w-0">
                          <p className={`text-xs font-${isFirst || isLast ? "black" : "medium"} text-white truncate`}>
                            {stop.name}
                          </p>
                          {(isFirst || isLast || isVia) && (
                            <p className="text-[9px] text-white/30 uppercase tracking-widest font-bold mt-0.5">
                              {isFirst ? "Departure" : isLast ? "Destination" : "Via"}
                            </p>
                          )}
                        </div>

                        {/* Arrow for non-last */}
                        {!isLast && (
                          <ArrowRight className="w-3 h-3 text-white/15 mt-0.5 flex-shrink-0 stop-action opacity-0 transition-opacity" />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Hint: click a map marker */}
                <div className="px-4 pb-3 pt-1">
                  <p className="text-[9px] text-white/20 text-center uppercase tracking-widest">
                    Tap a marker on the map to set it as start, via or end
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── STOP CONTEXT MENU (appears when marker is tapped) ───────────────── */}
      {clickedStop && (
        <div className="absolute inset-x-0 bottom-0 z-50 slide-up pb-safe">
          <div
            className="mx-auto max-w-lg rounded-t-3xl p-5 space-y-3"
            style={{ background: "rgba(20,22,30,0.98)", backdropFilter: "blur(24px)", border: "1px solid rgba(255,255,255,0.1)", borderBottom: "none" }}
          >
            <div className="flex items-center justify-between mb-1">
              <div>
                <p className="text-xs font-black text-white uppercase tracking-[0.12em]">{clickedStop.name}</p>
                <p className="text-[10px] text-white/30 mt-0.5">Choose an action for this stop</p>
              </div>
              <button onClick={() => setClickedStop(null)} className="p-1.5 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { role: "start" as const, label: "Set as Start", color: "#22c55e", icon: "🟢", disabled: clickedStop.id === endStopId },
                { role: "via"   as const, label: "Set as Via",   color: "#f59e0b", icon: "🟡", disabled: clickedStop.id === startStopId || clickedStop.id === endStopId },
                { role: "end"   as const, label: "Set as End",   color: "#ef4444", icon: "🔴", disabled: clickedStop.id === startStopId },
              ].map(({ role, label, color, icon, disabled }) => (
                <button
                  key={role}
                  onClick={() => handleSetAs(role)}
                  disabled={disabled}
                  className="flex flex-col items-center gap-2 py-3 rounded-2xl border transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                  style={{
                    background: `${color}15`,
                    borderColor: `${color}30`,
                  }}
                >
                  <span className="text-xl">{icon}</span>
                  <span className="text-[10px] font-black text-white uppercase tracking-[0.08em] text-center leading-tight">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── EMPTY STATE ─────────────────────────────────────────────────────── */}
      {!hasResult && !loading && !error && startStopId && !endStopId && (
        <div className="absolute bottom-6 inset-x-0 z-20 flex justify-center pointer-events-none">
          <div className="fade-in flex items-center gap-2.5 px-5 py-3 rounded-full text-xs font-bold text-white/50"
            style={{ background: "rgba(15,17,23,0.9)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(20px)" }}
          >
            <MapPin className="w-4 h-4" style={{ color: routeColor }} />
            Now choose your destination stop
          </div>
        </div>
      )}

      {!startStopId && !isPanelOpen && (
        <div className="absolute bottom-6 inset-x-0 z-20 flex justify-center pointer-events-none">
          <div className="fade-in flex items-center gap-2.5 px-5 py-3 rounded-full text-xs font-bold text-white/50"
            style={{ background: "rgba(15,17,23,0.9)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(20px)" }}
          >
            <Route className="w-4 h-4" style={{ color: routeColor }} />
            Tap "Plan" to open the route selector
          </div>
        </div>
      )}
    </div>
  );
}
