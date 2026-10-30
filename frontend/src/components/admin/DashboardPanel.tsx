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
import { useBusLocations } from "@/hooks/useBusLocations";
import { useAuth } from "@/hooks/useAuth";
import {
  hasValidBusCoordinates,
  isLiveBusSignalLost,
  liveBusFreshnessTimestamp,
} from "@/lib/liveBusFreshness";
import { MAP_OPTIONS, MAPS_MAP_ID, DEFAULT_CENTER } from "@/config/maps";
import { errorMessage } from "@/lib/errors";
import { serverNow } from "@/lib/serverClock";
import {
  Activity, Navigation2, Clock, AlertTriangle,
  TrendingUp, X, ChevronDown, ChevronUp,
  Eye, Wifi, WifiOff, MessageCircle, TicketCheck,
} from "lucide-react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { apiRequest, isApiRecord, acknowledgedField, type ApiRequestOptions } from "@/lib/apiClient";
import MessagingPanel from "@/components/shared/MessagingPanel";
import DirectionsRoute from "@/components/maps/DirectionsRoute";
import TrafficLayer from "@/components/maps/TrafficLayer";
import { normalizeHeading, unwrapHeading } from "@/lib/markerHeading";
import { useTelemetryRenderTrace } from "@/hooks/useTelemetryRenderTrace";
import { useLiveBusMarkerPosition } from "@/hooks/useLiveBusMarkerPosition";
import { useSmoothPosition } from "@/hooks/useSmoothPosition";
import { publishedStopIndex } from "@/lib/publishedStopIndex";
import {
  countActiveServices,
  devicePresence,
  isActiveService,
  isLiveChatDeviceOnline,
  rideServiceState,
  withLastKnownLocations,
} from "@/lib/activeBusEntries";
import {
  directionLabelState,
  isRideDirection,
  normalizeRideDirection,
  routeInRideDirectionState,
} from "@/lib/rideDirection";

/* â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const TRIP_STATE: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  not_armed:     { label: "Service setup pending", color: "text-white/40", bg: "bg-white/5", dot: "bg-white/20" },
  direction_pending: { label: "Direction Pending", color: "text-amber-300", bg: "bg-amber-500/10", dot: "bg-amber-300" },
  pre_departure: { label: "Awaiting Stop 1", color: "text-white/50", bg: "bg-white/5", dot: "bg-white/30" },
  in_service:    { label: "In Service", color: "text-emerald-400", bg: "bg-emerald-500/10", dot: "bg-emerald-400" },
  completed:     { label: "Completed",  color: "text-blue-400",    bg: "bg-blue-500/10",    dot: "bg-blue-400" },
};
const MOTION_STATE: Record<string, { label: string; color: string }> = {
  moving:    { label: "Moving",  color: "text-emerald-400" },
  stopped:   { label: "Stopped", color: "text-amber-400" },
  uncertain: { label: "Motion uncertain",  color: "text-amber-400" },
};
function servicePresentation(entry: ActiveBusEntry) {
  if (!entry.sessionId) {
    const label = entry.automaticServicePaused || entry.automaticServiceState === "paused" ? "Tracking paused"
      : entry.automaticServiceState === "assignment_required" ? "Assignment required"
      : entry.automaticServiceState === "awaiting_return" ? "Awaiting return service" : null;
    if (label) return {label,color:"text-amber-300",bg:"bg-amber-500/10",dot:"bg-amber-300"};
    if (devicePresence(entry) !== "online") return {label:"Offline",color:"text-white/40",bg:"bg-white/5",dot:"bg-white/30"};
  }
  if (entry.sessionId && entry.tripState !== "completed" && (entry.deviceState === "offline" || isLiveBusSignalLost(liveBusFreshnessTimestamp(entry)))) {
    return {label:"Service paused",color:"text-amber-300",bg:"bg-amber-500/10",dot:"bg-amber-300"};
  }
  return TRIP_STATE[rideServiceState(entry)];
}
function timeSince(t?: string | number): string {
  if (!t) return "—";
  const ms = typeof t === "number" ? serverNow() - t : serverNow() - new Date(t).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}
function headingLabel(d?: number): string {
  if (d == null) return "—";
  const dirs = ["N","NE","E","SE","S","SW","W","NW","N"];
  return dirs[Math.round(d / 45) % 8] + ` ${Math.round(d)}°`;
}



async function requestAdmin<T>(path: string, init: ApiRequestOptions): Promise<T> {
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
  nextStopIndex,
  onClose,
}: {
  entry: ActiveBusEntry;
  routeName: string;
  nextStopIndex: number | undefined;
  onClose: () => void;
}) {
  const directionState = normalizeRideDirection(entry.direction);
  const directionPending = directionState === "pending";
  const [msg, setMsg] = useState("");
  const presence = devicePresence(entry);
  const locationDelayed = isLiveBusSignalLost(liveBusFreshnessTimestamp(entry));
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
        { method: "DELETE", validateResponse: value => isApiRecord(value) && Number.isSafeInteger(value.deleted) && Number(value.deleted) >= 0 },
      );
      setMsg("Messages cleared ✓");
      clearMessageLater();
      setShowWipeConfirm(false);
    } catch (error: unknown) {
      // Close the confirmation so the reason, shown behind it, is visible.
      setShowWipeConfirm(false);
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
              <p className="mt-1 text-sm font-semibold text-white">{servicePresentation(entry).label}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-black">Signal</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {presence === "online"
                  ? locationDelayed ? "Live location updates delayed" : "Connected"
                  : presence === "offline"
                    ? "Offline"
                    : "Unknown / stale"}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-black">Next stop</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {nextStopIndex !== undefined
                  ? nextStopIndex + 1
                  : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-black">Delay</p>
              <p className="mt-1 text-sm font-semibold text-white">{Math.max(0, Number(entry.delayMinutes ?? 0))} min</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-black">Route matching</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {directionPending ? "Direction pending" : entry.routeState ?? "Pending"}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-black">Match confidence</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {directionPending || entry.matchConfidence == null
                  ? "—"
                  : `${Math.round(entry.matchConfidence * 100)}%`}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-black">Route context</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {directionPending
                  ? "Direction pending"
                  : `v${entry.routeVersion ?? "—"} · ${entry.routeSource ?? "configured"}`}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-black">Distance to route</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {directionPending || entry.distanceToActiveRoute == null
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
              Matched: {!directionPending && entry.matchedLocation
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
          <button disabled={!entry.sessionId} title={entry.sessionId ? undefined : "Messages are available after service starts"} onClick={() => setShowWipeConfirm(true)} className="h-11 flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-colors">
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
  onClick: (position: { lat: number; lng: number }) => void;
}) {
  const ts = servicePresentation(entry);
  const serviceState = rideServiceState(entry);
  const markerColor =
    serviceState === "in_service"
      ? entry.motionState === "moving" ? "#34D399" : "#FBBF24"
      : devicePresence(entry) !== "online" || entry.motionState === "uncertain" ? "#FB923C" : "#94949C";

  const markerSelection = useLiveBusMarkerPosition(entry);
  const markerPoint = useSmoothPosition(markerSelection.position);
  useTelemetryRenderTrace(entry, "admin", markerPoint !== null, { position: markerPoint, selection: markerSelection });

  const [displayHeading, setDisplayHeading] = useState(() =>
    normalizeHeading(entry.heading),
  );
  const displayHeadingRef = useRef(displayHeading);
  useEffect(() => {
    if (entry.motionState !== "moving" || (entry.speed ?? 0) < 3 || entry.deviceState !== "online") return;
    const nextHeading = unwrapHeading(entry.heading, displayHeadingRef.current);
    displayHeadingRef.current = nextHeading;
    setDisplayHeading(nextHeading);
  }, [entry.heading, entry.motionState, entry.speed, entry.deviceState]);

  if (!markerPoint) return null;
  return (
    <AdvancedMarker position={markerPoint} anchorLeft="-50%" anchorTop="-50%" onClick={() => onClick(markerPoint)}>
      <div
        style={{ position: "relative", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        title={`${entry.busId} — ${ts.label}${markerSelection.decision === "match_pending" ? " — updating route position" : markerSelection.uncertain ? " — approximate GNSS position" : ""}`}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 18,
          background: markerColor,
          border: "3px solid #09090b",
          borderStyle: markerSelection.uncertain ? "dashed" : "solid",
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
          position: "absolute", top: 40, left: "50%", transform: "translateX(-50%)", padding: "2px 6px", borderRadius: 5,
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
  onEndRide,
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
  onEndRide: (entry: ActiveBusEntry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const bus = buses.find(b => b.id === entry.busId);
  const route = routes.find(r => r.id === entry.routeId);
  const directionState = normalizeRideDirection(entry.direction);
  const directedRoute = routeInRideDirectionState(route, directionState);
  const driver = drivers.find(d => d.id === entry.driverId);
  const ts = servicePresentation(entry);
  const ms = MOTION_STATE[entry.motionState ?? "uncertain"] ?? MOTION_STATE.uncertain;
  const stopCount = directedRoute?.stops?.length ?? 0;
  const nextStopIndex = isActiveService(entry)
    ? publishedStopIndex(entry.currentStopIndex, stopCount) : undefined;
  const nextStop = nextStopIndex !== undefined ? directedRoute?.stops[nextStopIndex] : undefined;
  const followingStop = nextStopIndex !== undefined ? directedRoute?.stops[nextStopIndex + 1] : undefined;
  const serviceState = rideServiceState(entry);
  const locationDelayed = entry.deviceState === "offline" || isLiveBusSignalLost(liveBusFreshnessTimestamp(entry));
  // An offline bus keeps its last reported location; its last motion is not live.
  const offline = devicePresence(entry) !== "online";
  const canEndRide = Boolean(
    entry.sessionId && entry.driverId && entry.routeId &&
    (serviceState === "direction_pending" ||
      serviceState === "pre_departure" ||
      serviceState === "in_service"),
  );

  return (
    <>
      {detailsOpen && (
        <LiveDetailsDrawer
          entry={entry}
          routeName={route?.name ?? entry.routeId ?? "—"}
          nextStopIndex={nextStopIndex}
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
              <span className={`w-2 h-2 rounded-full ${ts.dot} ${entry.motionState === "moving" && !offline ? "animate-pulse" : ""}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white text-sm truncate">{bus?.name ?? entry.busId}</p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className={`text-[9px] font-black uppercase tracking-wider ${ts.color}`}>{ts.label}</span>
                {locationDelayed && <span className="text-[9px] font-semibold text-amber-400">{offline ? `Last seen ${timeSince(liveBusFreshnessTimestamp(entry))}` : "Live location updates delayed"}</span>}
                {!offline && <span className={`text-[9px] font-semibold ${ms.color}`}>{ms.label}</span>}
                {entry.speed != null && !offline && <span className="text-[9px] text-white/30 tabular-nums">{Math.round(entry.speed)} km/h</span>}
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
                { label: "Last Update", value: timeSince(liveBusFreshnessTimestamp(entry)) },
                { label: "Next stop", value: nextStopIndex !== undefined ? `${nextStopIndex + 1}/${stopCount}` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white/3 border border-white/5 rounded-lg p-2 flex flex-col gap-0.5">
                  <span className="text-[8px] font-black uppercase tracking-wider text-white/25">{label}</span>
                  <span className="text-xs font-semibold text-white tabular-nums">{value}</span>
                </div>
              ))}
            </div>
            {nextStopIndex !== undefined && rideServiceState(entry) === "in_service" && (
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-[8px] font-black uppercase tracking-wider text-white/25">Route Progress</span>
                  <span className="text-[9px] text-white/30 tabular-nums">{nextStopIndex}/{stopCount} passed</span>
                </div>
                <div className="h-1 bg-white/5 rounded-full">
                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.round((nextStopIndex / stopCount) * 100)}%` }} />
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {nextStop && (
                    <div>
                      <span className="text-[8px] text-white/25 uppercase font-black">Next Stop</span>
                      <p className="text-[10px] font-semibold text-white truncate">{nextStop.name}</p>
                    </div>
                  )}
                  {followingStop && (
                    <div>
                      <span className="text-[8px] text-white/25 uppercase font-black">Following Stop</span>
                      <p className="text-[10px] font-semibold text-white/60 truncate">{followingStop.name}</p>
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
                {route && isRideDirection(entry.direction) ? (
                  <p className="text-[9px] text-white/40">
                    {directionLabelState(directionState, route.stops)}
                  </p>
                ) : route ? (
                  <p className="text-[9px] text-amber-300/70">Direction pending</p>
                ) : null}
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
                  disabled={
                    delayPending ||
                    !isActiveService(entry) ||
                    !entry.routeId ||
                    !entry.driverId
                  }
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
                disabled={!isActiveService(entry) || !entry.sessionId}
                onClick={() => onLoadBoardingCode(entry)}
                className="flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-bold text-white disabled:opacity-40"
              >
                <TicketCheck className="size-4" />
                {boardingCode ? `${boardingCode.slice(0, 4)}-${boardingCode.slice(4)}` : "Boarding code"}
              </button>
              {canEndRide && (
                <button
                  type="button"
                  onClick={() => onEndRide(entry)}
                  className="flex min-h-10 items-center gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-3 text-xs font-bold text-red-300 hover:bg-red-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                >
                  <X className="size-4" aria-hidden="true" />
                  End ride early
                </button>
              )}
            </div>
            {hasValidBusCoordinates(entry.lat, entry.lng) && (
              <p className="text-[9px] text-white/20 tabular-nums">
                {entry.lat!.toFixed(5)}, {entry.lng!.toFixed(5)}
                {entry.lastKnownLocationAt !== undefined && ` · last known ${timeSince(entry.lastKnownLocationAt)}`}
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
  const [liveReadFailed, setLiveReadFailed] = useState(false);
  const onLiveReadError = useCallback(() => setLiveReadFailed(true), []);
  const onLiveReadRecovered = useCallback(() => setLiveReadFailed(false), []);
  const {
    isResuming,
    connectionGeneration,
    resumeGeneration,
    markSnapshotReceived,
  } = useRTDBResume();
  const liveFleet = useActiveBuses({
    connectionGeneration,
    resumeGeneration,
    markSnapshotReceived,
    onReadError: onLiveReadError,
    onReadRecovered: onLiveReadRecovered,
  });
  const { busLocations, error: busLocationsError, retry: retryBusLocations } = useBusLocations();
  const activeEntries = useMemo(
    () => withLastKnownLocations(liveFleet, busLocations),
    [liveFleet, busLocations],
  );
  const { buses, error: busesError, retry: retryBuses } = useBuses();
  const activeEntriesMap = useMemo(
    () => new Map(activeEntries.map((entry) => [entry.busId, entry])),
    [activeEntries],
  );
  const dynamicGeometries = useDynamicRouteGeometries(activeEntriesMap);
  const { drivers, error: driversError, retry: retryDrivers, loading: driversLoading } = useDrivers();
  const { routes, error: routesError, retry: retryRoutes } = useRoutes();
  const activeRouteOverlays = useMemo(() => {
    const overlays = new Map<string, {
      key: string;
      routeId: string;
      color: string;
      polyline?: string;
      polylineQuality?: "HIGH_QUALITY";
      direction: "forward" | "reverse";
      stops: Array<{ lat: number; lng: number }>;
      nextStopIndices: number[];
      firstStopIndex?: number;
    }>();
    for (const entry of activeEntries) {
      if (!entry.routeId || !isActiveService(entry) || !isRideDirection(entry.direction)) continue;
      const route = routes.find((candidate) => candidate.id === entry.routeId);
      if (!route) continue;
      const direction = entry.direction;
      const hasDirectionalGeometry = Boolean(
        route.forwardPolyline && route.reversePolyline,
      );
      const geometry =
        entry.routeSource === "dynamic-reroute"
          ? dynamicGeometries.get(entry.busId)
          : undefined;
      const hasDynamic = Boolean(geometry);
      const overlayKey = `${route.id}:${direction}`;
      const existing = overlays.get(overlayKey);
      const naturalStops = route.stops ?? route.waypoints ?? [];
      const nextStopIndex = publishedStopIndex(entry.currentStopIndex, naturalStops.length);
      const indices = nextStopIndex === undefined ? [] : [nextStopIndex];
      const orderedStops = (direction === "reverse" ? [...naturalStops].reverse() : naturalStops).map(({ lat, lng }) => ({ lat, lng }));
      if (existing) {
        if (entry.routeSource !== "dynamic-reroute") existing.nextStopIndices.push(...indices);
      } else overlays.set(overlayKey, {
        key: overlayKey,
        routeId: route.id,
        color: route.color,
        polyline: (direction === "reverse"
              ? route.reversePolyline
              : route.forwardPolyline ?? route.polyline),
        polylineQuality: hasDirectionalGeometry
            ? route.polylineQuality
            : undefined,
        direction,
        stops: orderedStops,
        nextStopIndices: entry.routeSource === "dynamic-reroute" ? [] : [...indices],
      });
      if (hasDynamic && geometry) {
        const key = `${overlayKey}:${entry.busId}:${entry.routeVersion}`;
        overlays.set(key, { key, routeId: route.id, color: route.color, polyline: geometry.polyline,
          polylineQuality: "HIGH_QUALITY", direction, stops: orderedStops,
          nextStopIndices: indices, firstStopIndex: geometry.firstStopIndex ?? -1 });
      }
    }
    return [...overlays.values()];
  }, [activeEntries, routes, dynamicGeometries]);
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [, setFreshnessNow] = useState(() => serverNow());
  const [armStatus, setArmStatus] = useState("");
  const [resumePending, setResumePending] = useState(false);
  const resumeInFlight = useRef(false);
  const resumeKeys = useRef(new Map<string, string>());
  // Per ride: one bus finishing must not unlock another bus's in-flight change.
  const [delayPending, setDelayPending] = useState<ReadonlySet<string>>(() => new Set());
  const [boardingCodes, setBoardingCodes] = useState<Record<string, string>>({});
  const [chatEntry, setChatEntry] = useState<ActiveBusEntry | null>(null);
  const [endRideEntry, setEndRideEntry] = useState<ActiveBusEntry | null>(null);
  const [endRidePending, setEndRidePending] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => setFreshnessNow(serverNow()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  // â”€â”€ Traffic layer rendered imperatively â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const liveEntries = activeEntries.filter(entry => entry.deviceState === "online" && !isLiveBusSignalLost(liveBusFreshnessTimestamp(entry)));
  const inService = countActiveServices(liveEntries, "in_service");
  const awaitingStart = countActiveServices(liveEntries, "pre_departure");
  const directionPending = new Set(
    liveEntries
      .filter((entry) => rideServiceState(entry) === "direction_pending")
      .map((entry) => entry.sessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
  ).size;
  const devicesOnline = activeEntries.filter(
    (entry) => devicePresence(entry) === "online",
  ).length;
  const unavailableDevices = activeEntries.filter(
    (entry) => devicePresence(entry) !== "online",
  ).length;
  const activeServices = countActiveServices(liveEntries);

  const handleSelectBus = useCallback((
    entry: ActiveBusEntry,
    displayedPosition?: { lat: number; lng: number },
  ) => {
    setSelectedBusId(prev => prev === entry.busId ? null : entry.busId);
    const markerPoint = displayedPosition ?? (
      hasValidBusCoordinates(entry.lat, entry.lng)
        ? { lat: entry.lat as number, lng: entry.lng as number }
        : null
    );
    if (markerPoint) setMapCenter(markerPoint);
  }, []);

  const resumeAutomaticService = async (entry: ActiveBusEntry) => {
    if (resumeInFlight.current || !entry.routeId) return;
    if (driversLoading) { setArmStatus("Operators are still loading. Try again in a moment."); return; }
    if (driversError) { setArmStatus(driversError); return; }
    const operators = drivers.filter(driver => driver.assignedBusId === entry.busId);
    if (operators.length !== 1) { setArmStatus("Assign exactly one operator before resuming tracking."); return; }
    resumeInFlight.current = true;
    setResumePending(true);
    const identity = JSON.stringify([operators[0].id, entry.busId, entry.routeId]);
    const key = resumeKeys.current.get(identity) ?? crypto.randomUUID();
    resumeKeys.current.set(identity, key);
    try {
      await requestAdmin("/api/v2/ride-sessions", { method: "POST", headers: { "Idempotency-Key": key },
        body: JSON.stringify({ driverId: operators[0].id, busId: entry.busId, routeId: entry.routeId }),
        validateResponse: value => isApiRecord(value) && typeof value.sessionId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value.sessionId),
      });
      resumeKeys.current.delete(identity);
      setArmStatus(`Automatic tracking resumed for ${entry.busId}.`);
    } catch (error) { setArmStatus(errorMessage(error)); }
    finally { resumeInFlight.current = false; setResumePending(false); }
  };

  const changeDelay = async (entry: ActiveBusEntry, delta: number) => {
    if (!entry.routeId || !entry.driverId) return;
    const operationId = `${entry.busId}_${entry.routeId}`;
    const delayMinutes = Math.max(0, Number(entry.delayMinutes ?? 0) + delta);
    setDelayPending(current => new Set(current).add(operationId));
    setArmStatus("");
    try {
      await requestAdmin<{ delayMinutes: number }>("/api/shifts/delay", {
        validateResponse: value => acknowledgedField(value, "saved") && isApiRecord(value) && value.delayMinutes === delayMinutes,
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
      setDelayPending(current => {
        const next = new Set(current);
        next.delete(operationId);
        return next;
      });
    }
  };

  const loadBoardingCode = async (entry: ActiveBusEntry) => {
    if (!entry.sessionId) return;
    try {
      const result = await requestAdmin<{ boardingCode?: string }>(
        `/api/sessions/${encodeURIComponent(entry.sessionId)}/boarding-code`,
        { method: "POST", validateResponse: value => isApiRecord(value) && value.sessionId === entry.sessionId && typeof value.boardingCode === "string" && /^[A-Z0-9]{8}$/.test(value.boardingCode) },
      );
      if (!result.boardingCode) throw new Error("Boarding code was not returned.");
      setBoardingCodes((current) => ({ ...current, [entry.sessionId as string]: result.boardingCode as string }));
    } catch (error) {
      setArmStatus(errorMessage(error));
    }
  };

  const endRideEarly = async () => {
    const entry = endRideEntry;
    if (!entry?.sessionId || !entry.routeId || !entry.driverId) return;
    setEndRidePending(true);
    setArmStatus("");
    try {
      await requestAdmin("/api/shifts/stop", {
        validateResponse: value => acknowledgedField(value, "stopped"),
        method: "POST",
        body: JSON.stringify({
          busId: entry.busId,
          routeId: entry.routeId,
          driverId: entry.driverId,
          sessionId: entry.sessionId,
        }),
      });
      setArmStatus(`Ride ${entry.sessionId} ended early and was saved to history.`);
      setEndRideEntry(null);
    } catch (error) {
      // Close the confirmation so the reason in the sidebar is visible.
      setEndRideEntry(null);
      setArmStatus(errorMessage(error));
    } finally {
      setEndRidePending(false);
    }
  };

  // Follow the open chat's receiver live; the clicked entry is only a snapshot.
  const liveChatEntry = chatEntry
    ? activeEntries.find(entry => entry.busId === chatEntry.busId && entry.routeId === chatEntry.routeId)
    : undefined;
  // While live data is unavailable a missing receiver is unknown, not gone, so
  // the chat stays on its last snapshot instead of closing for good.
  const liveDataUnavailable = isResuming || liveReadFailed;
  const chatReceiver = liveChatEntry ?? (liveDataUnavailable ? chatEntry ?? undefined : undefined);
  // A chat whose receiver went offline, or whose ride was replaced, ends instead
  // of reopening later over whatever the admin is doing.
  const chatOpen = Boolean(chatReceiver && (liveDataUnavailable || (isLiveChatDeviceOnline(chatReceiver)
    && (!chatEntry?.sessionId || chatReceiver.sessionId === chatEntry.sessionId))));
  if (chatEntry && !chatOpen) setChatEntry(null);

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden lg:flex-row">
      {/* â”€â”€ Map â”€â”€ */}
      <div className="flex-1 relative min-h-[300px] lg:min-h-0">
        <GoogleMap
          mapId={MAPS_MAP_ID}
          reuseMaps
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
              nextStopIndices={route.nextStopIndices}
              firstStopIndex={route.firstStopIndex}
              direction={route.direction}
            />
          ))}
          {activeEntries.map(entry => (
            <BusMarker
              key={`${entry.busId}_${entry.routeId}`}
              entry={entry}
              onClick={(position) => handleSelectBus(entry, position)}
            />
          ))}
        </GoogleMap>

        {/* Map overlay stats */}
        <div className="absolute top-3 left-3 right-3 flex flex-col items-start gap-2 pointer-events-none">
          {liveReadFailed && (
            <div className="pointer-events-auto w-full max-w-lg rounded-xl border border-amber-400/20 bg-zinc-950/95 px-3 py-2 text-xs text-amber-300 shadow-lg" role="alert">
              Live vehicle updates are unavailable. Check your connection and reload to retry.
            </div>
          )}
          {(busesError || routesError || driversError || busLocationsError) && (
            <div
              className="pointer-events-auto flex w-full max-w-lg items-start gap-2 rounded-xl border border-red-400/20 bg-zinc-950/95 px-3 py-2 text-xs text-red-300 shadow-lg"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">{busesError || routesError || driversError
                ? `Fleet metadata is unavailable. ${busesError || routesError || driversError}`
                : `Last known locations of offline buses are unavailable. ${busLocationsError}`}</span>
              <button
                type="button"
                onClick={() => {
                  if (busesError) retryBuses();
                  if (routesError) retryRoutes();
            if (driversError) retryDrivers();
                  if (busLocationsError) retryBusLocations();
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
            <span className={`w-2 h-2 rounded-full ${!isResuming && devicesOnline > 0 ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
            <span className="text-[10px] font-black uppercase tracking-widest text-white/70">
              {isResuming
                ? "Live data unavailable"
                : `${devicesOnline} device${devicesOnline === 1 ? "" : "s"} online · ${activeServices} service${activeServices === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>
      </div>

      {/* â”€â”€ Sidebar â”€â”€ */}
      <div className="flex max-h-[55%] min-h-0 w-full shrink-0 flex-col overflow-y-auto overscroll-contain border-t border-white/5 lg:max-h-none lg:w-[360px] lg:overflow-hidden lg:border-l lg:border-t-0">
        <section className="shrink-0 border-b border-white/5 p-4">
          <h2 className="text-sm font-bold text-white">Automatic service</h2>
          <p className="mt-2 text-pretty text-xs text-white/60">Services start automatically when an assigned receiver sends a fresh, reliable GPS fix. Direction resolves at an endpoint or after a qualified departure.</p>
          <p className="mt-2 text-pretty text-xs text-white/45">An offline session is retained for recovery. Movement, stop arrivals and return services follow GNSS evidence.</p>
          {activeEntries.filter(entry => (entry.automaticServicePaused || entry.automaticServiceState === "paused") && devicePresence(entry) === "online").map(entry => <button key={`${entry.busId}_${entry.routeId}`} type="button"
            aria-label={`Resume automatic tracking for ${entry.busId}`} disabled={resumePending}
            onClick={() => void resumeAutomaticService(entry)}
            className="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-zinc-950 disabled:opacity-50">Resume tracking · {entry.busId}</button>)}
          {armStatus && <p className="mt-2 text-xs text-white/65" role="status">{armStatus}</p>}
        </section>
        {/* Stats row */}
        <div className="grid grid-cols-5 border-b border-white/5 shrink-0">
          {[
            { label: "In Service", value: inService,  color: "text-emerald-400", Icon: Activity },
            { label: "Awaiting Start", value: awaitingStart, color: "text-white/50", Icon: Clock },
            { label: "Direction Pending", value: directionPending, color: "text-amber-300", Icon: TrendingUp },
            { label: "Devices Online", value: devicesOnline, color: "text-blue-400", Icon: Wifi },
            { label: "Offline / Unknown", value: unavailableDevices, color: "text-amber-400", Icon: AlertTriangle },
          ].map(({ label, value, color, Icon }) => (
            <div key={label} className="flex flex-col items-center justify-center gap-0.5 py-3 border-r border-white/5 last:border-0">
              <Icon className={`w-3 h-3 ${color}`} />
              <span className={`text-lg font-black tabular-nums ${color}`}>{value}</span>
              <span className="text-[8px] font-black uppercase tracking-wide text-white/25">{label}</span>
            </div>
          ))}
        </div>

        {/* Fleet list */}
        <div className="flex shrink-0 flex-col gap-2 p-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
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
                delayPending={delayPending.has(`${entry.busId}_${entry.routeId}`)}
                boardingCode={entry.sessionId ? boardingCodes[entry.sessionId] : undefined}
                onLoadBoardingCode={(ride) => void loadBoardingCode(ride)}
                onOpenChat={setChatEntry}
                canChat={Boolean(user?.uid)}
                onEndRide={setEndRideEntry}
              />
            ))
          )}
        </div>
      </div>
      {chatReceiver && chatOpen && user?.uid && (
        <div className="fixed inset-0 z-[250] bg-black/70 pt-10 sm:p-10">
          <div className="mx-auto h-full max-w-2xl">
            <MessagingPanel
              sessionId={chatReceiver.sessionId ?? ""}
              currentUserRole="admin"
              currentUserId={user.uid}
              isOverlay
              onClose={() => setChatEntry(null)}
              unavailableMessage={chatReceiver.sessionId ? undefined : "Waiting for automatic service setup for this assigned receiver."}
            />
          </div>
        </div>
      )}
      <ConfirmModal
        isOpen={Boolean(endRideEntry)}
        title="End ride early?"
        description="This immediately ends the current service, removes it from passenger tracking, and saves the partial ride in history."
        confirmText="End ride"
        cancelText="Keep running"
        variant="warning"
        loading={endRidePending}
        onConfirm={() => void endRideEarly()}
        onCancel={() => setEndRideEntry(null)}
      />
    </div>
  );
}
