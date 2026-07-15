"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, MapPin, Navigation2, ChevronDown, Loader2, AlertCircle, GitBranch, Route, X, RefreshCw } from "lucide-react";
import { PREDEFINED_ROUTES } from "@/lib/predefinedRoutes";

const RoutePlannerMap = dynamic(() => import("@/components/maps/RoutePlannerMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center" style={{ background: "var(--surface-0)" }}>
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--text-ghost)" }} />
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
        className="rounded-full z-10"
        style={{ width: size, height: size, background: color, border: "2px solid var(--surface-0)" }}
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
        <label className="text-[10px] font-bold flex items-center gap-1.5" style={{ color: "var(--text-ghost)", letterSpacing: "0.08em" }}>
          {icon}
          {label.toUpperCase()}
          {optional && <span className="font-normal normal-case" style={{ color: "var(--text-ghost)", letterSpacing: "0" }}>(optional)</span>}
        </label>
        {optional && value && onClear && (
          <button
            onClick={onClear}
            className="p-0.5 rounded transition-colors"
            style={{ color: "var(--text-ghost)" }}
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
          className="w-full h-11 pl-4 pr-10 rounded-xl text-[13px] font-semibold appearance-none cursor-pointer transition-all outline-none"
          style={{
            background: disabled ? "var(--surface-3)" : "var(--surface-3)",
            border: `1px solid ${value && !disabled && accentColor ? `${accentColor}40` : "var(--border-default)"}`,
            color: disabled ? "var(--text-ghost)" : "var(--text-primary)",
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          <option value="" style={{ background: "var(--surface-2)", color: "var(--text-tertiary)" }}>
            {placeholder || `Select ${label}`}
          </option>
          {options.map((s) => (
            <option key={s.id} value={s.id} style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-ghost)" }}>
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

  const selectedRoute = PREDEFINED_ROUTES.find((r) => r.id === selectedRouteId);
  const stops = selectedRoute?.stops ?? [];

  const startStops = stops.filter((s) => s.id !== endStopId && s.id !== viaStopId);
  const endStops   = stops.filter((s) => s.id !== startStopId && s.id !== viaStopId);
  const viaStops   = stops.filter(
    (s) => s.id !== startStopId && s.id !== endStopId && s.id !== stops[0]?.id && s.id !== stops[stops.length - 1]?.id
  );

  const handleRouteChange = (routeId: string) => {
    setSelectedRouteId(routeId);
    setStartStopId("");
    setEndStopId("");
    setViaStopId("");
    setPlanResult(null);
    setError(null);
  };

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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchPlan(selectedRouteId, startStopId, endStopId, viaStopId);
    } else {
      setPlanResult(null);
    }
  }, [selectedRouteId, startStopId, endStopId, viaStopId, fetchPlan]);

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
      style={{ background: "var(--surface-0)" }}
    >
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
          background: "rgba(9, 9, 11, 0.92)",
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <Link
          href="/"
          className="flex items-center justify-center w-9 h-9 rounded-xl transition-all"
          style={{ background: "var(--surface-3)", border: "1px solid var(--border-default)", color: "var(--text-secondary)" }}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: routeColor }} />
            <p className="text-[12px] font-bold truncate" style={{ color: "var(--text-primary)" }}>
              Route Planner
            </p>
          </div>
          <p className="text-[10px] truncate mt-0.5" style={{ color: "var(--text-ghost)" }}>
            {selectedRoute?.name ?? "Select a route"}
          </p>
        </div>

        <button
          onClick={() => setIsPanelOpen((p) => !p)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold transition-all"
          style={{ 
            background: "var(--surface-3)", 
            border: "1px solid var(--border-default)", 
            color: "var(--text-secondary)" 
          }}
        >
          <Route className="w-3.5 h-3.5" />
          {isPanelOpen ? "Map" : "Plan"}
        </button>
      </div>

      {/* ── PLANNER PANEL ───────────────────────────────────────────────────── */}
      <div
        className={`relative z-20 transition-all duration-500 overflow-hidden flex-shrink-0 ${isPanelOpen ? "max-h-[75vh]" : "max-h-0"}`}
      >
        <div
          className="overflow-y-auto"
          style={{
            background: "rgba(9, 9, 11, 0.96)",
            backdropFilter: "blur(20px)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div className="px-4 pt-4 pb-3 space-y-4 max-w-lg mx-auto">
            {/* Route selector */}
            <div>
              <label className="text-[10px] font-bold flex items-center gap-1.5 mb-1.5" 
                style={{ color: "var(--text-ghost)", letterSpacing: "0.08em" }}>
                <GitBranch className="w-3 h-3" />
                SELECT ROUTE
              </label>
              <div className="relative">
                <select
                  value={selectedRouteId}
                  onChange={(e) => handleRouteChange(e.target.value)}
                  className="w-full h-11 pl-4 pr-10 rounded-xl text-[13px] font-semibold appearance-none cursor-pointer transition-all outline-none"
                  style={{ 
                    background: "var(--surface-3)", 
                    border: `1px solid ${routeColor}30`,
                    color: "var(--text-primary)"
                  }}
                >
                  {PREDEFINED_ROUTES.map((r) => (
                    <option key={r.id} value={r.id} style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-ghost)" }}>
                  <ChevronDown className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* From / To / Via */}
            <div className="grid grid-cols-1 gap-3">
              <SelectBox
                label="From"
                value={startStopId}
                options={startStops}
                onChange={setStartStopId}
                accentColor="#22c55e"
                icon={<div className="w-2 h-2 rounded-full" style={{ background: "#22c55e" }} />}
                placeholder="Select departure stop"
              />

              {/* Swap */}
              <div className="flex justify-center -my-1">
                <button
                  onClick={() => {
                    const tmp = startStopId;
                    setStartStopId(endStopId);
                    setEndStopId(tmp);
                  }}
                  disabled={!startStopId || !endStopId}
                  className="p-2 rounded-xl transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                  style={{ 
                    background: "var(--surface-3)", 
                    border: "1px solid var(--border-default)", 
                    color: "var(--text-secondary)" 
                  }}
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
                icon={<div className="w-2 h-2 rounded-full" style={{ background: "#ef4444" }} />}
                placeholder="Select destination stop"
              />

              {viaStops.length > 0 && (
                <SelectBox
                  label="Via"
                  value={viaStopId}
                  options={viaStops}
                  onChange={setViaStopId}
                  accentColor="#f59e0b"
                  icon={<div className="w-2 h-2 rounded-full" style={{ background: "#f59e0b" }} />}
                  placeholder="Add intermediate stop"
                  optional
                  onClear={() => setViaStopId("")}
                />
              )}
            </div>

            {/* Status indicators */}
            {loading && (
              <div className="flex items-center gap-2 text-[12px] animate-fade-in py-2" style={{ color: "var(--text-tertiary)" }}>
                <Loader2 className="w-4 h-4 animate-spin" />
                Planning your route…
              </div>
            )}

            {error && !loading && (
              <div className="flex items-center gap-2 text-[12px] animate-fade-in px-3 py-2.5 rounded-xl"
                style={{ 
                  background: "var(--status-danger-bg)", 
                  border: "1px solid rgba(248, 113, 113, 0.15)", 
                  color: "var(--status-danger)" 
                }}>
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Trip Summary */}
            {hasResult && !loading && !error && (
              <div className="animate-fade-in rounded-xl overflow-hidden"
                style={{ background: "var(--surface-3)", border: "1px solid var(--border-subtle)" }}>
                {/* Header */}
                <div className="px-4 pt-3.5 pb-2.5 flex items-center justify-between"
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <div className="flex items-center gap-2">
                    <Navigation2 className="w-3.5 h-3.5" style={{ color: routeColor }} />
                    <span className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>Your Trip</span>
                  </div>
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-md"
                    style={{ background: `${routeColor}18`, color: routeColor }}>
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
                      <div key={`${stop.id}-${i}`} className="flex items-start gap-3">
                        <div className="flex flex-col items-center pt-1 gap-0">
                          <StopDot
                            color={isFirst ? "#22c55e" : isLast ? "#ef4444" : isVia ? "#f59e0b" : routeColor}
                            size={isFirst || isLast ? 12 : 9}
                            pulse={isFirst || isLast}
                          />
                          {!isLast && (
                            <div className="w-px flex-1 min-h-[18px] mt-1 mb-1 opacity-25" style={{ background: routeColor }} />
                          )}
                        </div>

                        <div className="flex-1 pb-3 min-w-0">
                          <p className={`text-[12px] font-${isFirst || isLast ? "bold" : "medium"} truncate`}
                            style={{ color: "var(--text-primary)" }}>
                            {stop.name}
                          </p>
                          {(isFirst || isLast || isVia) && (
                            <p className="text-[9px] font-bold mt-0.5"
                              style={{ color: "var(--text-ghost)", letterSpacing: "0.06em" }}>
                              {isFirst ? "DEPARTURE" : isLast ? "DESTINATION" : "VIA"}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="px-4 pb-3 pt-1">
                  <p className="text-[9px] text-center font-semibold" style={{ color: "var(--text-ghost)", letterSpacing: "0.05em" }}>
                    Tap a marker on the map to set it as start, via or end
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── STOP CONTEXT MENU ───────────────────────────────────────────────── */}
      {clickedStop && (
        <div className="absolute inset-x-0 bottom-0 z-50 animate-slide-up pb-safe">
          <div
            className="mx-auto max-w-lg rounded-t-2xl p-5 space-y-3"
            style={{ background: "var(--surface-1)", backdropFilter: "blur(20px)", border: "1px solid var(--border-default)", borderBottom: "none" }}
          >
            <div className="flex items-center justify-between mb-1">
              <div>
                <p className="text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>{clickedStop.name}</p>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--text-ghost)" }}>Choose an action for this stop</p>
              </div>
              <button onClick={() => setClickedStop(null)} className="p-1.5 rounded-lg transition-colors"
                style={{ background: "var(--surface-3)", color: "var(--text-ghost)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { role: "start" as const, label: "Set as Start", color: "#22c55e", disabled: clickedStop.id === endStopId },
                { role: "via"   as const, label: "Set as Via",   color: "#f59e0b", disabled: clickedStop.id === startStopId || clickedStop.id === endStopId },
                { role: "end"   as const, label: "Set as End",   color: "#ef4444", disabled: clickedStop.id === startStopId },
              ].map(({ role, label, color, disabled }) => (
                <button
                  key={role}
                  onClick={() => handleSetAs(role)}
                  disabled={disabled}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl border transition-all disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
                  style={{ background: `${color}12`, borderColor: `${color}25` }}
                >
                  <div className="w-3.5 h-3.5 rounded-full" style={{ background: color }} />
                  <span className="text-[10px] font-bold text-center leading-tight"
                    style={{ color: "var(--text-secondary)" }}>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── EMPTY STATE ─────────────────────────────────────────────────────── */}
      {!hasResult && !loading && !error && startStopId && !endStopId && (
        <div className="absolute bottom-6 inset-x-0 z-20 flex justify-center pointer-events-none">
          <div className="animate-fade-in flex items-center gap-2.5 px-5 py-3 rounded-full text-[12px] font-semibold"
            style={{ 
              background: "rgba(9, 9, 11, 0.92)", 
              border: "1px solid var(--border-default)", 
              backdropFilter: "blur(16px)",
              color: "var(--text-secondary)"
            }}>
            <MapPin className="w-4 h-4" style={{ color: routeColor }} />
            Now choose your destination stop
          </div>
        </div>
      )}

      {!startStopId && !isPanelOpen && (
        <div className="absolute bottom-6 inset-x-0 z-20 flex justify-center pointer-events-none">
          <div className="animate-fade-in flex items-center gap-2.5 px-5 py-3 rounded-full text-[12px] font-semibold"
            style={{ 
              background: "rgba(9, 9, 11, 0.92)", 
              border: "1px solid var(--border-default)", 
              backdropFilter: "blur(16px)",
              color: "var(--text-secondary)"
            }}>
            <Route className="w-4 h-4" style={{ color: routeColor }} />
            Tap &quot;Plan&quot; to open the route selector
          </div>
        </div>
      )}
    </div>
  );
}
