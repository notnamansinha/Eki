"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Map as GoogleMap, AdvancedMarker, useMap,
} from "@vis.gl/react-google-maps";
import { auth } from "@/lib/firebaseAuth";
import { useBuses } from "@/hooks/useBuses";
import { useDynamicRouteGeometries } from "@/hooks/useDynamicRouteGeometries";
import { useDrivers } from "@/hooks/useDrivers";
import { useRoutes } from "@/hooks/useRoutes";
import { useRTDBResume } from "@/hooks/useRTDBResume";
import { useActiveBuses, type ActiveBusEntry } from "@/hooks/useActiveBuses";
import { useAuth } from "@/hooks/useAuth";
import {
  hasValidBusCoordinates,
  isLiveBusSignalLost,
} from "@/lib/liveBusFreshness";
import { MAP_OPTIONS, MAPS_MAP_ID, DEFAULT_CENTER } from "@/config/maps";
import { errorMessage } from "@/lib/errors";
import {
  Activity, Navigation2, Clock, AlertTriangle,
  TrendingUp, X, ChevronDown, ChevronUp,
  Eye, Wifi, WifiOff, MessageCircle, Play, RefreshCw, TicketCheck,
} from "lucide-react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { apiRequest } from "@/lib/apiClient";
import CustomSelect from "@/components/ui/CustomSelect";
import MessagingPanel from "@/components/shared/MessagingPanel";
import DirectionsRoute from "@/components/maps/DirectionsRoute";
import { normalizeHeading, unwrapHeading } from "@/lib/markerHeading";
import { liveBusMarkerPosition } from "@/lib/liveBusMarkerPosition";
import { isLiveChatDeviceOnline } from "@/lib/activeBusEntries";
import {
  directionLabel,
  normalizeRideDirection,
  routeInRideDirection,
} from "@/lib/rideDirection";

/* â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const TRIP_STATE: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  pre_departure: { label: "Pre-departure", color: "text-white/50", bg: "bg-white/5", dot: "bg-white/30" },
  in_service:    { label: "In Service", color: "text-emerald-400", bg: "bg-emerald-500/10", dot: "bg-emerald-400" },
  completed:     { label: "Completed",  color: "text-blue-400",    bg: "bg-blue-500/10",    dot: "bg-blue-400" },
};
const MOTION_STATE: Record<string, { label: string; color: string }> = {
  moving:    { label: "Moving",  color: "text-emerald-400" },
  stopped:   { label: "Stopped", color: "text-amber-400" },
  uncertain: { label: "No GPS",  color: "text-red-400" },
};
function timeSince(t?: string | number): string {
  if (!t) return "—";
  const ms = typeof t === "number" ? Date.now() - t : Date.now() - new Date(t).getTime();
  // Future server timestamps (clock skew) can make ms negative; clamp to zero
  // so the dashboard never renders "-5s ago".
  const elapsed = Math.max(0, ms);
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)}s ago`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  return `${Math.floor(elapsed / 3_600_000)}h ago`;
}
function headingLabel(d?: number): string {
  if (d == null) return "—";
  const dirs = ["N","NE","E","SE","S","SW","W","NW","N"];
  return dirs[Math.round(d / 45) % 8] + ` ${Math.round(d)}°`;
}

function assignedRouteIds(bus: { assignedRoutes?: string[]; assignedRouteId?: string } | undefined) {
  return bus?.assignedRoutes ?? (bus?.assignedRouteId ? [bus.assignedRouteId] : []);
}

async function requestAdmin<T>(path: string, init: RequestInit): Promise<T> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Administrator session is unavailable.");
  const token = await currentUser.getIdToken();
  return apiRequest<T>(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    fallbackError: "Ride operation failed.",
  });
}

/* â”€â”€ Map centering helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function MapCenter({ center }: { center: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (center && map) { map.panTo(center); map.setZoom(15); }
  }, [center, map]);
  return null;
}

/* Live ride details */
function LiveDetailsDrawer({
  entry,
  routeName,
  onClose,
}: {
  entry: ActiveBusEntry;
  routeName: string;
  onClose: () => void;
}) {
  const [msg, setMsg] = useState("");
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    };
  }, []);

  const clearMessageLater = () => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMsg(""), 2000);
  };

  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [isWiping, setIsWiping] = useState(false);
  const dialogRef = useDialogFocus<HTMLDivElement>(true, () => {
    if (!isWiping) onClose();
  });

  const confirmWipeMessages = async () => {
    setIsWiping(true);
    try {
      if (!entry.sessionId) throw new Error("This vehicle has no active message session.");
      await requestAdmin(
        `/api/shifts/${encodeURIComponent(entry.sessionId)}/messages`,
        { method: "DELETE" },
      );
      setMsg("Messages cleared ✓");
      clearMessageLater();
      setShowWipeConfirm(false);
    } catch (error: unknown) {
      setMsg("Error: " + errorMessage(error));
    } finally {
      setIsWiping(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`Live details for ${entry.busId}`} className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} tabIndex={-1} className="w-full max-w-md bg-[#0f0f12] border border-white/10 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden animate-slide-up">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/5">
          <div>
            <p className="text-[10px] text-white/30 uppercase tracking-widest font-black">Live Details</p>
            <p className="font-bold text-white">{entry.busId}</p>
            <p className="text-xs text-white/50">{routeName}</p>
          </div>
          <button onClick={onClose} aria-label="Close live details" className="w-11 h-11 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-black">Trip state</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {!entry.sessionId
                  ? "Ride not armed"
                  : TRIP_STATE[entry.tripState ?? "pre_departure"]?.label ?? "Pre-departure"}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-black">Signal</p>
              <p className="mt-1 text-sm font-semibold text-white">{entry.deviceState === "offline" || entry.motionState === "uncertain" ? "Interrupted" : "Connected"}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-black">Current stop</p>
              <p className="mt-1 text-sm font-semibold text-white">{Math.max(0, Number(entry.currentStopIndex ?? 0)) + 1}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-black">Delay</p>
              <p className="mt-1 text-sm font-semibold text-white">{Math.max(0, Number(entry.delayMinutes ?? 0))} min</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-black">Route matching</p>
              <p className="mt-1 text-sm font-semibold text-white">{entry.routeState ?? "Pending"}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-black">Match confidence</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {entry.matchConfidence == null
                  ? "—"
                  : `${Math.round(entry.matchConfidence * 100)}%`}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-black">Route context</p>
              <p className="mt-1 text-sm font-semibold text-white">
                v{entry.routeVersion ?? "—"} · {entry.routeSource ?? "configured"}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-black">Distance to route</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {entry.distanceToActiveRoute == null
                  ? "—"
                  : `${Math.round(entry.distanceToActiveRoute)} m`}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-[10px] text-white/50">
            <p className="font-black uppercase tracking-widest text-white/30">Location diagnostics</p>
            <p className="mt-2 font-mono">
              Raw: {entry.rawLocation
                ? `${entry.rawLocation.lat.toFixed(6)}, ${entry.rawLocation.lng.toFixed(6)} · seq ${entry.rawLocation.seq} · HDOP ${entry.rawLocation.gpsHdop?.toFixed(1) ?? "legacy"}`
                : "—"}
            </p>
            <p className="mt-1 font-mono">
              Matched: {entry.matchedLocation
                ? `${entry.matchedLocation.lat.toFixed(6)}, ${entry.matchedLocation.lng.toFixed(6)} · segment ${entry.matchedLocation.segmentIndex}`
                : "raw fallback"}
            </p>
          </div>

          {msg && <p className="text-xs text-emerald-400 font-semibold">{msg}</p>}

          <p className="text-xs leading-relaxed text-white/45">
            Raw position comes from authenticated GNSS telemetry. A confident,
            current-version route match controls the displayed marker; uncertain
            or rerouting states fall back to the raw fix. Stop progress remains
            independent of route geometry changes.
          </p>
          <button onClick={() => setShowWipeConfirm(true)} className="h-11 flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-colors">
            <MessageCircle className="w-3.5 h-3.5" /> Clear Messages
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={showWipeConfirm}
        title="Clear Messages?"
        description={`Clear all shift messages for ${entry.busId}?`}
        confirmText="Clear Messages"
        cancelText="Cancel"
        variant="danger"
        loading={isWiping}
        onConfirm={confirmWipeMessages}
        onCancel={() => setShowWipeConfirm(false)}
      />
    </div>
  );
}

/* â”€â”€ Live bus map marker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function BusMarker({
  entry,
  onClick,
}: {
  entry: ActiveBusEntry;
  onClick: () => void;
}) {
  const ts = TRIP_STATE[entry.tripState ?? "pre_departure"] ?? TRIP_STATE.pre_departure;
  const markerColor =
    entry.tripState === "in_service"
      ? entry.motionState === "moving" ? "#34D399" : "#FBBF24"
      : entry.deviceState === "offline" || entry.motionState === "uncertain" ? "#FB923C" : "#94949C";

  const markerPoint = useMemo(
    () => liveBusMarkerPosition(entry),
    [entry],
  );

  const [displayHeading, setDisplayHeading] = useState(() =>
    normalizeHeading(entry.heading),
  );
  const displayHeadingRef = useRef(displayHeading);
  useEffect(() => {
    const nextHeading = unwrapHeading(entry.heading, displayHeadingRef.current);
    displayHeadingRef.current = nextHeading;
    setDisplayHeading(nextHeading);
  }, [entry.heading]);

  if (!markerPoint) return null;
  return (
    <AdvancedMarker position={markerPoint} onClick={onClick}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer" }} title={`${entry.busId} — ${ts.label}`}>
        <div style={{
          width: 36, height: 36, borderRadius: 18,
          background: markerColor, border: "3px solid #09090b",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: `0 0 0 2px ${markerColor}40, 0 4px 12px rgba(0,0,0,0.5)`,
        }}>
          <Navigation2
            style={{
              width: 16,
              height: 16,
              color: "#09090b",
              transform: `rotate(${displayHeading}deg)`,
              transformOrigin: "center",
              transition: "transform 250ms ease-out",
              willChange: "transform",
            }}
          />
        </div>
        <div style={{
          marginTop: 4, padding: "2px 6px", borderRadius: 5,
          background: "rgba(9,9,11,0.9)", border: "1px solid rgba(255,255,255,0.1)",
          color: "white", fontSize: 9, whiteSpace: "nowrap", fontWeight: 700,
          letterSpacing: "0.08em",
        }}>{entry.busId}</div>
      </div>
    </AdvancedMarker>
  );
}

/* â”€â”€ Fleet card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function FleetCard({
  entry, buses, routes, drivers,
  onSelect, selected, onChangeDelay, delayPending, boardingCode,
  onLoadBoardingCode, onOpenChat, canChat,
}: {
  entry: ActiveBusEntry;
  buses: ReturnType<typeof useBuses>["buses"];
  routes: ReturnType<typeof useRoutes>["routes"];
  drivers: ReturnType<typeof useDrivers>["drivers"];
  onSelect: () => void;
  selected: boolean;
  onChangeDelay: (entry: ActiveBusEntry, delta: number) => void;
  delayPending: boolean;
  boardingCode?: string;
  onLoadBoardingCode: (entry: ActiveBusEntry) => void;
  onOpenChat: (entry: ActiveBusEntry) => void;
  canChat: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const bus = buses.find(b => b.id === entry.busId);
  const route = routes.find(r => r.id === entry.routeId);
  const direction = normalizeRideDirection(entry.direction);
  const directedRoute = route && direction
    ? routeInRideDirection(route, direction)
    : undefined;
  const driver = drivers.find(d => d.id === entry.driverId);
  const ts = TRIP_STATE[entry.tripState ?? "pre_departure"] ?? TRIP_STATE.pre_departure;
  const ms = MOTION_STATE[entry.motionState ?? "uncertain"] ?? MOTION_STATE.uncertain;
  const stopIdx = (entry.currentStopIndex ?? 0) + 1;
  const stopCount = directedRoute?.stops?.length ?? 0;

  return (
    <>
      {detailsOpen && (
        <LiveDetailsDrawer
          entry={entry}
          routeName={route?.name ?? entry.routeId ?? "—"}
          onClose={() => setDetailsOpen(false)}
        />
      )}
      <div
        className={`border rounded-xl overflow-hidden transition-all ${
          selected ? "border-brand-accent/40 bg-brand-accent/5" : "border-white/8 bg-white/3 hover:border-white/15"
        }`}
      >
        <div className="w-full p-3 flex items-center gap-1">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={`fleet-details-${entry.busId}-${entry.routeId ?? "route"}`}
            onClick={() => { setExpanded(o => !o); onSelect(); }}
            className="min-w-0 flex-1 flex items-center gap-3 text-left rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/50"
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${ts.bg}`}>
              <span className={`w-2 h-2 rounded-full ${ts.dot} ${entry.motionState === "moving" ? "animate-pulse" : ""}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white text-sm truncate">{bus?.name ?? entry.busId}</p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className={`text-[9px] font-black uppercase tracking-wider ${ts.color}`}>
                  {entry.sessionId ? ts.label : "Ride not armed"}
                </span>
                <span className={`text-[9px] font-semibold ${ms.color}`}>{ms.label}</span>
                {entry.speed != null && <span className="text-[9px] text-white/30 tabular-nums">{Math.round(entry.speed)} km/h</span>}
                {(entry.delayMinutes ?? 0) > 0 && (
                  <span className="text-[9px] text-amber-400 font-black">+{entry.delayMinutes}m delay</span>
                )}
              </div>
            </div>
            {expanded ? <ChevronUp className="w-3.5 h-3.5 text-white/30" /> : <ChevronDown className="w-3.5 h-3.5 text-white/30" />}
          </button>
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            className="w-9 h-9 shrink-0 rounded-lg bg-white/5 flex items-center justify-center hover:bg-brand-accent/20 hover:text-brand-accent transition-colors"
            title="Live details"
            aria-label={`Open live details for ${entry.busId}`}
          >
            <Eye className="w-3.5 h-3.5 text-white/50" />
          </button>
          {isLiveChatDeviceOnline(entry) && (
            <button
              type="button"
              disabled={!canChat}
              onClick={() => onOpenChat(entry)}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white/5 px-2.5 text-[10px] font-bold text-white transition-colors hover:bg-brand-accent/20 hover:text-brand-accent disabled:opacity-40"
              title={entry.sessionId ? "Open live chat" : "Device online; chat will unlock when a ride is armed"}
              aria-label={`Open live chat for ${entry.busId}`}
            >
              <MessageCircle className="size-3.5" />
              Chat
            </button>
          )}
        </div>

        {expanded && (
          <div id={`fleet-details-${entry.busId}-${entry.routeId ?? "route"}`} className="border-t border-white/5 p-3 flex flex-col gap-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Speed", value: entry.speed != null ? `${Math.round(entry.speed)} km/h` : "—" },
                { label: "Heading", value: headingLabel(entry.heading) },
                { label: "Last Update", value: timeSince(entry.receivedAt ?? entry.timestamp) },
                { label: "Stop", value: stopCount > 0 ? `${stopIdx}/${stopCount}` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white/3 border border-white/5 rounded-lg p-2 flex flex-col gap-0.5">
                  <span className="text-[8px] font-black uppercase tracking-wider text-white/25">{label}</span>
                  <span className="text-xs font-semibold text-white tabular-nums">{value}</span>
                </div>
              ))}
            </div>
            {stopCount > 0 && entry.tripState === "in_service" && (
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-[8px] font-black uppercase tracking-wider text-white/25">Route Progress</span>
                  <span className="text-[9px] text-white/30 tabular-nums">{stopIdx}/{stopCount} stops</span>
                </div>
                <div className="h-1 bg-white/5 rounded-full">
                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.round((stopIdx / stopCount) * 100)}%` }} />
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {directedRoute?.stops?.[entry.currentStopIndex ?? 0] && (
                    <div>
                      <span className="text-[8px] text-white/25 uppercase font-black">Next Stop</span>
                      <p className="text-[10px] font-semibold text-white truncate">{directedRoute.stops[entry.currentStopIndex ?? 0].name}</p>
                    </div>
                  )}
                  {directedRoute?.stops?.[(entry.currentStopIndex ?? 0) + 1] && (
                    <div>
                      <span className="text-[8px] text-white/25 uppercase font-black">Following Stop</span>
                      <p className="text-[10px] font-semibold text-white/60 truncate">{directedRoute.stops[(entry.currentStopIndex ?? 0) + 1].name}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/5">
              <div>
                <span className="text-[8px] font-black uppercase tracking-wider text-white/25">Driver</span>
                <p className="text-[10px] font-semibold text-white truncate">{driver?.name ?? entry.driverId ?? "—"}</p>
              </div>
              <div>
                <span className="text-[8px] font-black uppercase tracking-wider text-white/25">Route</span>
                <p className="text-[10px] font-semibold text-white truncate">{route?.name ?? entry.routeId ?? "—"}</p>
                {route && (
                  <p className="text-[9px] text-white/40">
                    {directionLabel(normalizeRideDirection(entry.direction), route.stops)}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
              <span className="mr-1 text-[10px] font-semibold text-white/50">
                Delay: {Math.max(0, Number(entry.delayMinutes ?? 0))} min
              </span>
              {[-2, -1, 1, 2].map((delta) => (
                <button
                  key={delta}
                  type="button"
                  disabled={delayPending || !entry.routeId || !entry.driverId}
                  onClick={() => onChangeDelay(entry, delta)}
                  className="min-h-9 min-w-9 rounded-lg border border-white/10 bg-white/5 px-2 text-xs font-bold text-white disabled:opacity-40"
                  aria-label={`${delta > 0 ? "Increase" : "Decrease"} delay by ${Math.abs(delta)} minutes for ${entry.busId}`}
                >
                  {delta > 0 ? `+${delta}` : delta}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!entry.sessionId}
                onClick={() => onLoadBoardingCode(entry)}
                className="flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-bold text-white disabled:opacity-40"
              >
                <TicketCheck className="size-4" />
                {boardingCode ? `${boardingCode.slice(0, 4)}-${boardingCode.slice(4)}` : "Boarding code"}
              </button>
            </div>
            {hasValidBusCoordinates(entry.lat, entry.lng) && (
              <p className="text-[9px] text-white/20 tabular-nums">
                {entry.lat!.toFixed(5)}, {entry.lng!.toFixed(5)}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/* â”€â”€ Main Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export default function DashboardPanel() {
  const { user } = useAuth();
  const {
    isResuming,
    connectionGeneration,
    resumeGeneration,
    markSnapshotReceived,
  } = useRTDBResume();
  const activeEntries = useActiveBuses({
    connectionGeneration,
    resumeGeneration,
    markSnapshotReceived,
  });
  const { buses, error: busesError, retry: retryBuses } = useBuses();
  const activeEntriesMap = useMemo(
    () => new Map(activeEntries.map((entry) => [entry.busId, entry])),
    [activeEntries],
  );
  const dynamicGeometries = useDynamicRouteGeometries(activeEntriesMap);
  const { drivers } = useDrivers();
  const { routes, error: routesError, retry: retryRoutes } = useRoutes();
  const routesById = useMemo(
    () => new Map(routes.map((route) => [route.id, route])),
    [routes],
  );
  const activeRouteOverlays = useMemo(() => {
    const overlays = new Map<string, {
      key: string;
      routeId: string;
      color: string;
      polyline?: string;
      polylineQuality?: "HIGH_QUALITY";
      direction: "forward" | "reverse";
      stops: Array<{ lat: number; lng: number }>;
    }>();
    for (const entry of activeEntries) {
      if (!entry.routeId) continue;
      const route = routesById.get(entry.routeId);
      if (!route) continue;
      const direction = normalizeRideDirection(entry.direction);
      if (!direction) continue;
      const hasDirectionalGeometry = Boolean(
        route.forwardPolyline && route.reversePolyline,
      );
      const geometry =
        entry.routeSource === "dynamic-reroute"
          ? dynamicGeometries.get(entry.busId)
          : undefined;
      const hasDynamic = Boolean(geometry);
      const overlayKey = hasDynamic
        ? entry.activeRouteId ?? `${route.id}:${entry.routeVersion ?? 0}:${entry.busId}`
        : `${route.id}:${direction}`;
      if (overlays.has(overlayKey)) continue;
      overlays.set(overlayKey, {
        key: overlayKey,
        routeId: route.id,
        color: route.color,
        polyline: hasDynamic && geometry
          ? geometry.polyline
          : (direction === "reverse"
              ? route.reversePolyline
              : route.forwardPolyline ?? route.polyline),
        polylineQuality: hasDynamic && geometry
          ? "HIGH_QUALITY"
          : hasDirectionalGeometry
            ? route.polylineQuality
            : undefined,
        direction,
        stops: (route.stops ?? route.waypoints ?? []).map(({ lat, lng }) => ({
          lat,
          lng,
        })),
      });
    }
    return [...overlays.values()];
  }, [activeEntries, routesById, dynamicGeometries]);
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [freshnessNow, setFreshnessNow] = useState(() => Date.now());
  const [driverId, setDriverId] = useState("");
  const [busId, setBusId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [armStatus, setArmStatus] = useState("");
  const [armPending, setArmPending] = useState(false);
  const [delayPending, setDelayPending] = useState("");
  const [boardingCodes, setBoardingCodes] = useState<Record<string, string>>({});
  const [chatEntry, setChatEntry] = useState<ActiveBusEntry | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setFreshnessNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  // â”€â”€ Traffic layer rendered imperatively â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const TrafficLayer = () => {
    const map = useMap();
    const layerRef = useRef<google.maps.TrafficLayer | null>(null);

    useEffect(() => {
      if (!map) return;
      layerRef.current = new google.maps.TrafficLayer();
      layerRef.current.setMap(map);
      return () => { layerRef.current?.setMap(null); };
    }, [map]);

    return null;
  };

  const inService  = activeEntries.filter(e => e.tripState === "in_service").length;
  const moving     = activeEntries.filter(e => e.motionState === "moving").length;
  const gpsLost    = activeEntries.filter(e =>
    e.deviceState === "offline" ||
    e.motionState === "uncertain" ||
    isLiveBusSignalLost(e.receivedAt ?? e.timestamp, freshnessNow)
  ).length;
  const awaitingStart = activeEntries.filter(
    e => e.tripState === "pre_departure" && !e.sessionId,
  ).length;

  const handleSelectBus = useCallback((entry: ActiveBusEntry) => {
    setSelectedBusId(prev => prev === entry.busId ? null : entry.busId);
    const markerPoint = liveBusMarkerPosition(entry);
    if (markerPoint) setMapCenter(markerPoint);
  }, []);

  const selectedBus = buses.find((bus) => bus.id === busId);
  const allowedRouteIds = assignedRouteIds(selectedBus);
  const allowedRoutes = routes.filter((route) => allowedRouteIds.includes(route.id));

  const selectDriver = (nextDriverId: string) => {
    const driver = drivers.find((candidate) => candidate.id === nextDriverId);
    const nextBusId = driver?.assignedBusId ?? "";
    const nextBus = buses.find((bus) => bus.id === nextBusId);
    const nextRoutes = assignedRouteIds(nextBus);
    setDriverId(nextDriverId);
    setBusId(nextBusId);
    setRouteId(nextRoutes.length === 1 ? nextRoutes[0] : "");
    setArmStatus("");
  };

  const armRide = async () => {
    if (!driverId || !busId || !routeId) return;
    setArmPending(true);
    setArmStatus("");
    try {
      const result = await requestAdmin<{
        sessionId?: string;
        resumed?: boolean;
        direction?: "forward" | "reverse";
      }>(
        "/api/shifts/start",
        {
          method: "POST",
          body: JSON.stringify({ driverId, busId, routeId }),
        },
      );
      const inferredDirection = normalizeRideDirection(result.direction);
      setArmStatus(
        result.resumed
          ? `Active ride restored (${result.sessionId}).`
          : `Ride armed (${result.sessionId}) for ${directionLabel(inferredDirection, routes.find((route) => route.id === routeId)?.stops ?? [])}.`,
      );
    } catch (error) {
      setArmStatus(errorMessage(error));
    } finally {
      setArmPending(false);
    }
  };

  const changeDelay = async (entry: ActiveBusEntry, delta: number) => {
    if (!entry.routeId || !entry.driverId) return;
    const operationId = `${entry.busId}_${entry.routeId}`;
    const delayMinutes = Math.max(0, Number(entry.delayMinutes ?? 0) + delta);
    setDelayPending(operationId);
    setArmStatus("");
    try {
      await requestAdmin<{ delayMinutes: number }>("/api/shifts/delay", {
        method: "PATCH",
        body: JSON.stringify({
          busId: entry.busId,
          routeId: entry.routeId,
          driverId: entry.driverId,
          delayMinutes,
        }),
      });
      setArmStatus(`Delay updated to ${delayMinutes} minutes for ${entry.busId}.`);
    } catch (error) {
      setArmStatus(errorMessage(error));
    } finally {
      setDelayPending("");
    }
  };

  const loadBoardingCode = async (entry: ActiveBusEntry) => {
    if (!entry.sessionId) return;
    try {
      const result = await requestAdmin<{ boardingCode?: string }>(
        `/api/sessions/${encodeURIComponent(entry.sessionId)}/boarding-code`,
        { method: "POST" },
      );
      if (!result.boardingCode) throw new Error("Boarding code was not returned.");
      setBoardingCodes((current) => ({ ...current, [entry.sessionId as string]: result.boardingCode as string }));
    } catch (error) {
      setArmStatus(errorMessage(error));
    }
  };

  return (
    <div className="relative h-full flex flex-col lg:flex-row w-full overflow-y-auto lg:overflow-hidden">
      {/* â”€â”€ Map â”€â”€ */}
      <div className="flex-1 relative min-h-[300px] lg:min-h-0">
        <GoogleMap
          mapId={MAPS_MAP_ID}
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={12}
          style={{ width: "100%", height: "100%" }}
          {...MAP_OPTIONS}
        >
          <TrafficLayer />
          <MapCenter center={mapCenter} />
          {activeRouteOverlays.map((route) => (
            <DirectionsRoute
              key={route.key}
              routeId={route.routeId}
              stops={route.stops}
              polyline={route.polyline}
              polylineQuality={route.polylineQuality}
              color={route.color || "#3b82f6"}
              hasBuses
              direction={route.direction}
            />
          ))}
          {activeEntries.map(entry => (
            <BusMarker
              key={`${entry.busId}_${entry.routeId}`}
              entry={entry}
              onClick={() => handleSelectBus(entry)}
            />
          ))}
        </GoogleMap>

        {/* Map overlay stats */}
        <div className="absolute top-3 left-3 right-3 flex flex-col items-start gap-2 pointer-events-none">
          {(busesError || routesError) && (
            <div
              className="pointer-events-auto flex w-full max-w-lg items-start gap-2 rounded-xl border border-red-400/20 bg-zinc-950/95 px-3 py-2 text-xs text-red-300 shadow-lg"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">Fleet metadata is unavailable. {busesError || routesError}</span>
              <button
                type="button"
                onClick={() => {
                  if (busesError) retryBuses();
                  if (routesError) retryRoutes();
                }}
                className="rounded-md bg-white/10 px-2 py-1 font-semibold text-white"
              >
                Retry
              </button>
            </div>
          )}
          {isResuming && (
            <div
              className="flex items-center gap-2 rounded-xl border border-amber-400/20 bg-zinc-950/95 px-3 py-2 text-xs font-semibold text-amber-300 shadow-lg"
              role="status"
              aria-live="polite"
            >
              <WifiOff className="size-4 shrink-0" aria-hidden="true" />
              <span>Offline / reconnecting to live data...</span>
            </div>
          )}
          <div className="flex items-center gap-2 bg-[#09090b]/90 backdrop-blur-sm border border-white/10 rounded-xl px-3 py-2">
            <span className={`w-2 h-2 rounded-full ${!isResuming && activeEntries.length > 0 ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
            <span className="text-[10px] font-black uppercase tracking-widest text-white/70">
              {isResuming ? "Live data unavailable" : `${activeEntries.length} Bus${activeEntries.length !== 1 ? "es" : ""} Live`}
            </span>
          </div>
        </div>
      </div>

      {/* â”€â”€ Sidebar â”€â”€ */}
      <div className="w-full lg:w-[360px] shrink-0 flex flex-col border-t lg:border-t-0 lg:border-l border-white/5 overflow-hidden">
        <section className="shrink-0 border-b border-white/5 p-3">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-white">Arm a ride</h2>
              <p className="mt-0.5 text-[10px] text-white/35">GNSS starts and completes the ride automatically.</p>
            </div>
            <Play className="size-4 text-white/30" aria-hidden="true" />
          </div>
          <div className="grid gap-2">
            <CustomSelect
              ariaLabel="Operator"
              value={driverId}
              onChange={selectDriver}
              options={[
                { value: "", label: "Select operator…" },
                ...drivers.map((driver) => ({ value: driver.id, label: `${driver.name} (${driver.id})` })),
              ]}
              placeholder="Select operator…"
            />
            <CustomSelect
              ariaLabel="Assigned vehicle"
              value={busId}
              onChange={() => undefined}
              disabled
              options={[
                { value: "", label: "No assigned vehicle" },
                ...buses.map((bus) => ({ value: bus.id, label: `${bus.name} (${bus.id})` })),
              ]}
              placeholder="Assigned vehicle"
            />
            <CustomSelect
              ariaLabel="Route"
              value={routeId}
              onChange={setRouteId}
              disabled={!busId}
              options={[
                { value: "", label: "Select route…" },
                ...allowedRoutes.map((route) => ({ value: route.id, label: route.name })),
              ]}
              placeholder="Select route…"
            />
          </div>
          <p className="text-xs text-white/45">
            Travel direction is inferred from fresh stopped GPS at route endpoint A or Z.
            After completion, the opposite trip is armed automatically following the turnaround dwell.
          </p>
          <button
            type="button"
            onClick={() => void armRide()}
            disabled={armPending || !driverId || !busId || !routeId}
            className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-xs font-bold text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {armPending ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" />}
            Arm ride
          </button>
          {armStatus && <p className="mt-2 text-xs text-white/65" role="status">{armStatus}</p>}
        </section>
        {/* Stats row */}
        <div className="grid grid-cols-4 border-b border-white/5 shrink-0">
          {[
            { label: "In Service", value: inService,  color: "text-emerald-400", Icon: Activity },
            { label: "Moving",     value: moving,     color: "text-blue-400",    Icon: TrendingUp },
            { label: "Not Armed", value: awaitingStart, color: "text-white/50", Icon: Clock },
            { label: "GPS Lost",   value: gpsLost,    color: "text-amber-400",   Icon: AlertTriangle },
          ].map(({ label, value, color, Icon }) => (
            <div key={label} className="flex flex-col items-center justify-center gap-0.5 py-3 border-r border-white/5 last:border-0">
              <Icon className={`w-3 h-3 ${color}`} />
              <span className={`text-lg font-black tabular-nums ${color}`}>{value}</span>
              <span className="text-[8px] font-black uppercase tracking-wide text-white/25">{label}</span>
            </div>
          ))}
        </div>

        {/* Fleet list */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          <p className="text-[9px] font-black uppercase tracking-[0.25em] text-white/25 px-1">Live Fleet</p>
          {activeEntries.length === 0 ? (
            <div className={`flex flex-col items-center justify-center py-16 text-center gap-2 ${isResuming ? "text-amber-300" : "opacity-30"}`}>
              {isResuming ? <WifiOff className="w-8 h-8" /> : <Wifi className="w-8 h-8" />}
              <p className="text-xs font-semibold uppercase tracking-widest">
                {isResuming ? "Live data unavailable" : "No buses active"}
              </p>
            </div>
          ) : (
            activeEntries.map(entry => (
              <FleetCard
                key={`${entry.busId}_${entry.routeId}`}
                entry={entry}
                buses={buses}
                routes={routes}
                drivers={drivers}
                selected={selectedBusId === entry.busId}
                onSelect={() => handleSelectBus(entry)}
                onChangeDelay={(ride, delta) => void changeDelay(ride, delta)}
                delayPending={delayPending === `${entry.busId}_${entry.routeId}`}
                boardingCode={entry.sessionId ? boardingCodes[entry.sessionId] : undefined}
                onLoadBoardingCode={(ride) => void loadBoardingCode(ride)}
                onOpenChat={setChatEntry}
                canChat={Boolean(user?.uid)}
              />
            ))
          )}
        </div>
      </div>
      {chatEntry && isLiveChatDeviceOnline(chatEntry) && user?.uid && (
        <div className="fixed inset-0 z-[250] bg-black/70 pt-10 sm:p-10">
          <div className="mx-auto h-full max-w-2xl">
            <MessagingPanel
              sessionId={chatEntry.sessionId ?? ""}
              currentUserRole="admin"
              currentUserId={user.uid}
              isOverlay
              onClose={() => setChatEntry(null)}
              unavailableMessage={chatEntry.sessionId ? undefined : "Arm this online bus to create the protected ride chat session."}
            />
          </div>
        </div>
      )}
    </div>
  );
}
