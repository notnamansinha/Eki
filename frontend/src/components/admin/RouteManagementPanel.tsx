"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Map as GoogleMap, AdvancedMarker, useMap,
} from "@vis.gl/react-google-maps";
import DirectionsRoute from "@/components/maps/DirectionsRoute";
import { useRoutes, RouteData, RouteStop } from "@/hooks/useRoutes";
import { auth } from "@/lib/firebaseAuth";
import {
  Trash2, Plus, X, CheckCircle, MapPin, Loader2, Search,
  Pencil, GripVertical, Save,
  ChevronDown, ChevronUp, ArrowLeft,
} from "lucide-react";
import CustomSelect from "@/components/ui/CustomSelect";
import ConfirmModal from "@/components/ui/ConfirmModal";
import AlertModal from "@/components/ui/AlertModal";
import { MAP_OPTIONS, MAPS_MAP_ID, DEFAULT_CENTER } from "@/config/maps";
import { errorMessage } from "@/lib/errors";
import { apiRequest } from "@/lib/apiClient";


/* ────────────────────────────────────────────────────────────────────────────────────────────────── */
function stopLabel(i: number): string {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (i < 26) return a[i];
  return a[Math.floor(i / 26) - 1] + a[i % 26];
}

const ROUTE_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#14B8A6", "#F97316",
];
const SAFE_ROUTE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_ROUTE_COLOR = /^#[0-9a-fA-F]{6}$/;
const ROUTE_TYPES = new Set<EditorState["type"]>(["up", "down", "circular"]);

function stopShortName(name: string): string {
  return name.split(",", 1)[0].trim().slice(0, 32);
}

interface PlacePrediction {
  name: string;
  address?: string;
  lat: number;
  lng: number;
}

function PlacesSearchBox({ onPlaceSelect }: { onPlaceSelect: (p: { name: string; lat: number; lng: number }) => void }) {
  const [value, setValue] = useState("");
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    if (value.length < 3) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setSearchError("Place search is unavailable. Sign in again and retry.");
        return;
      }
      setSearching(true);
      setSearchError("");
      try {
        const token = await currentUser.getIdToken();
        const payload = await apiRequest<{ results?: PlacePrediction[] }>(
          `/api/places/search?q=${encodeURIComponent(value)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
            fallbackError: "Place search is temporarily unavailable.",
          },
        );
        setPredictions(Array.isArray(payload.results) ? payload.results : []);
      } catch (error) {
        if (!controller.signal.aborted) {
          setPredictions([]);
          setSearchError(errorMessage(error));
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  const handleSelect = (prediction: PlacePrediction) => {
    setValue("");
    setPredictions([]);
    setSearchError("");
    onPlaceSelect(prediction);
  };

  return (
    <div className="relative flex-1">
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 pointer-events-none">
        {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
      </div>
      <input
        type="search"
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          setValue(nextValue);
          setSearchError("");
          if (nextValue.length < 3) setPredictions([]);
        }}
        placeholder="Search for a stop"
        aria-label="Search for a stop"
        aria-describedby={searchError ? "place-search-error" : undefined}
        className="w-full h-11 bg-[#09090b] border border-white/10 rounded-xl pl-10 pr-4 text-sm text-white focus:outline-none focus:border-white/30 transition-colors placeholder:text-white/20 font-medium"
      />
      {searchError && (
        <p id="place-search-error" className="mt-1 text-xs text-red-400" role="alert">
          {searchError}
        </p>
      )}
      {value.length >= 3 && predictions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#0f0f12] border border-white/10 rounded-xl overflow-hidden z-50 shadow-2xl">
          {predictions.map((prediction) => (
            <button
              key={`${prediction.lat}-${prediction.lng}-${prediction.name}`}
              type="button"
              className="w-full text-left p-3 hover:bg-white/5 text-xs text-white border-b border-white/5 last:border-0 transition-colors"
              onClick={() => handleSelect(prediction)}
            >
              <span className="font-semibold text-pretty">{prediction.name}</span>
              {prediction.address && (
                <span className="mt-0.5 block text-white/40 text-pretty">{prediction.address}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* â”€â”€ Map centering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function MapCenter({ center }: { center: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => { if (center && map) { map.panTo(center); map.setZoom(15); } }, [center, map]);
  return null;
}

/* â”€â”€ Route list card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function RouteCard({ route, onEdit, onDelete }: { route: RouteData; onEdit: () => void; onDelete: (id: string) => void }) {
  const [stopsOpen, setStopsOpen] = useState(false);
  return (
    <div className="group bg-white/3 border border-white/8 rounded-2xl overflow-hidden hover:border-white/15 transition-all">
      <div className="p-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-3 h-3 rounded-full shrink-0" style={{ background: route.color || "#3B82F6" }} />
          <div className="min-w-0">
            <p className="font-semibold text-white truncate">{route.name}</p>
            <p className="text-[10px] text-white/30 tabular-nums tracking-widest">{route.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <button onClick={onEdit} aria-label={`Edit route ${route.name}`} className="w-11 h-11 rounded-lg text-white/30 hover:text-blue-400 hover:bg-blue-500/10 transition-all" title="Edit route">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(route.id)} aria-label={`Delete route ${route.name}`} className="w-11 h-11 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-all" title="Delete route">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="px-4 pb-3 flex items-center gap-2">
        <button onClick={() => setStopsOpen(o => !o)} aria-expanded={stopsOpen} className="min-h-11 flex items-center gap-1.5 px-3 rounded-full bg-white/5 text-[9px] font-black tracking-widest text-white/50 uppercase hover:text-white/60 transition-colors">
          <MapPin className="w-2.5 h-2.5" />
          {route.stops?.length ?? 0} Stops
          {stopsOpen ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
        </button>
        {route.type && (
          <span className="px-2 py-0.5 rounded-full bg-white/5 text-[9px] font-black text-white/30 uppercase">{route.type}</span>
        )}
        {route.distanceMeters && (
          <span className="text-[9px] text-white/20 tabular-nums">{(route.distanceMeters / 1000).toFixed(1)} km</span>
        )}
      </div>
      {stopsOpen && route.stops && route.stops.length > 0 && (
        <div className="border-t border-white/5 px-4 py-3 flex flex-col gap-0">
          {route.stops.map((stop, i) => (
            <div key={i} className="flex items-stretch gap-3">
              <div className="flex flex-col items-center shrink-0">
                <div className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-black text-[9px] shrink-0">
                  {stopLabel(i)}
                </div>
                {i < route.stops!.length - 1 && <div className="flex-1 w-px my-0.5 bg-white/10 min-h-[12px]" />}
              </div>
              <div className="pb-2.5 flex flex-col justify-center min-w-0">
                <span className="text-sm font-medium text-white/80 leading-tight truncate">{stop.name}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* â”€â”€ Stop list item (draggable in editor) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function StopItem({ stop, index, onRemove, onNameChange }: {
  stop: RouteStop; index: number;
  onRemove: (i: number) => void;
  onNameChange: (i: number, name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(stop.name);
  return (
    <div className="flex items-center gap-2 group">
      <GripVertical className="w-4 h-4 text-white/15 shrink-0 cursor-grab" />
      <span className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 font-black text-[9px] flex items-center justify-center shrink-0">
        {stopLabel(index)}
      </span>
      {editing ? (
        <input
          value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={() => { onNameChange(index, val); setEditing(false); }}
          onKeyDown={e => e.key === "Enter" && (onNameChange(index, val), setEditing(false))}
          autoFocus
          aria-label={`Rename stop ${stop.name}`}
          className="flex-1 h-11 bg-white/5 border border-white/20 rounded-lg px-2 text-sm text-white focus:outline-none focus:border-white/40"
        />
      ) : (
        <button
          type="button"
          className="flex-1 min-h-11 text-left text-sm text-white/80 font-medium truncate cursor-text min-w-0"
          onClick={() => setEditing(true)}
          title="Click to rename"
        >
          {stop.name}
        </button>
      )}
      <button onClick={() => onRemove(index)} aria-label={`Remove stop ${stop.name}`} className="w-11 h-11 rounded-lg text-white/15 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all shrink-0">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────── */
type EditorMode = "create" | "edit";

interface EditorState {
  mode: EditorMode;
  routeId: string;
  name: string;
  color: string;
  type: "up" | "down" | "circular";
  stops: RouteStop[];
  polyline?: string;
}

const EMPTY_EDITOR: EditorState = {
  mode: "create",
  routeId: "",
  name: "",
  color: "#3B82F6",
  type: "circular",
  stops: [],
};

function RouteEditor({
  initial,
  onSaved,
  onCancel,
}: {
  initial: EditorState;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [state, setState] = useState<EditorState>(initial);
  const [saving, setSaving] = useState(false);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [editorAlertMsg, setEditorAlertMsg] = useState<string | null>(null);
  const [positionMessage, setPositionMessage] = useState("Drag any map pin to fine-tune a stop's location.");

  // ── Traffic layer rendered imperatively ──────────────────────────────────
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

  const setField = <K extends keyof EditorState>(k: K, v: EditorState[K]) =>
    setState(s => ({ ...s, [k]: v }));

  const handlePlaceSelect = (place: { name: string; lat: number; lng: number }) => {
    const name = place.name.trim();
    const stop: RouteStop = {
      id: `stop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      shortName: stopShortName(name),
      lat: place.lat,
      lng: place.lng,
    };
    setState(s => ({ ...s, stops: [...s.stops, stop], polyline: undefined }));
    setMapCenter({ lat: place.lat, lng: place.lng });
  };

  const removeStop = (i: number) =>
    setState(s => ({ ...s, stops: s.stops.filter((_, idx) => idx !== i), polyline: undefined }));

  const renameStop = (i: number, name: string) =>
    setState(s => {
      const stops = [...s.stops];
      const trimmedName = name.trim();
      stops[i] = { ...stops[i], name: trimmedName, shortName: stopShortName(trimmedName) };
      return { ...s, stops, polyline: undefined };
    });

  const moveStop = (from: number, to: number) => {
    if (to < 0 || to >= state.stops.length) return;
    setState(s => {
      const stops = [...s.stops];
      const [item] = stops.splice(from, 1);
      stops.splice(to, 0, item);
      return { ...s, stops, polyline: undefined };
    });
  };

  const updateStopPosition = (i: number, lat: number, lng: number) => {
    setState(s => {
      const stops = [...s.stops];
      stops[i] = { ...stops[i], lat, lng };
      return { ...s, stops, polyline: undefined };
    });
    setPositionMessage(`Stop ${stopLabel(i)} moved. Save the route to publish the new location.`);
  };

  const handleSave = async () => {
    const routeId = state.routeId.trim();
    const routeName = state.name.trim();
    if (!routeId || !routeName || state.stops.length < 2) {
      setEditorAlertMsg("Route ID, name, and at least 2 stops are required.");
      return;
    }
    if (!SAFE_ROUTE_ID.test(routeId)) {
      setEditorAlertMsg("Route ID may contain only letters, numbers, hyphens, and underscores (max 128 characters).");
      return;
    }
    if (routeName.length > 100) {
      setEditorAlertMsg("Route name must be 100 characters or fewer.");
      return;
    }
    if (!SAFE_ROUTE_COLOR.test(state.color) || !ROUTE_TYPES.has(state.type)) {
      setEditorAlertMsg("Choose a valid route colour and type.");
      return;
    }
    if (state.stops.length > 27) {
      setEditorAlertMsg("A route can have at most 27 stops.");
      return;
    }
    const stops = state.stops.map(stop => ({
      ...stop,
      id: stop.id.trim(),
      name: stop.name.trim(),
      shortName: stopShortName(stop.name),
    }));
    const stopIds = new Set(stops.map(stop => stop.id));
    const invalidStop = stops.find(stop =>
      !SAFE_ROUTE_ID.test(stop.id) ||
      !stop.name ||
      stop.name.length > 100 ||
      !stop.shortName ||
      !Number.isFinite(stop.lat) || stop.lat < -90 || stop.lat > 90 ||
      !Number.isFinite(stop.lng) || stop.lng < -180 || stop.lng > 180
    );
    if (stopIds.size !== stops.length) {
      setEditorAlertMsg("Each stop must be added only once.");
      return;
    }
    if (invalidStop) {
      setEditorAlertMsg("Each stop needs a name and valid map coordinates.");
      return;
    }
    setSaving(true);

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("Route geometry service is unavailable. Sign in again and retry.");
      }

      const token = await currentUser.getIdToken(true);
      const geometry = await apiRequest<{
        polyline?: string;
        distanceMeters?: number;
        duration?: string;
      }>(`/api/routes/${encodeURIComponent(routeId)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: routeName,
          color: state.color,
          type: state.type,
          mode: state.mode,
          stops,
        }),
        fallbackError: "Unable to compute route geometry. The route was not saved.",
      });
      if (!geometry.polyline || typeof geometry.distanceMeters !== "number" || typeof geometry.duration !== "string") {
        throw new Error("Route geometry service returned an invalid result.");
      }

      onSaved();
    } catch (error: unknown) {
      alert("Failed to save: " + errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const routeStops = useMemo(() => {
    return state.stops.map(s => ({ lat: s.lat, lng: s.lng }));
  }, [state.stops]);

  return (
    <div className="h-full flex flex-col w-full overflow-y-auto lg:overflow-hidden animate-slide-up">
      {/* Toolbar */}
      <div className="shrink-0 border-b border-white/5 bg-[#0f0f12]/90 backdrop-blur-2xl px-4 py-3 flex flex-wrap gap-3 items-end relative z-10 overflow-visible">
        <button onClick={onCancel} aria-label="Cancel route editing" className="w-11 h-11 rounded-xl bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors shrink-0 self-center">
          <ArrowLeft className="w-4 h-4 text-white/60" />
        </button>

        <div className="flex flex-col gap-1 min-w-[110px]">
          <label className="text-[9px] text-white/30 font-black uppercase tracking-widest px-1">Route ID</label>
          <input
            value={state.routeId}
            onChange={e => setField("routeId", e.target.value)}
            disabled={state.mode === "edit"}
            placeholder="route_101"
            className="h-11 bg-[#09090b] border border-white/10 rounded-xl px-3 text-sm text-white focus:outline-none focus:border-white/30 placeholder:text-white/15 font-medium disabled:opacity-40"
          />
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
          <label className="text-[9px] text-white/30 font-black uppercase tracking-widest px-1">Search Stop</label>
          <PlacesSearchBox onPlaceSelect={handlePlaceSelect} />
        </div>

        <div className="flex flex-col gap-1 min-w-[110px]">
          <label className="text-[9px] text-white/30 font-black uppercase tracking-widest px-1">Type</label>
          <CustomSelect
            ariaLabel="Route type"
            value={state.type}
            onChange={(val) => setField("type", val as EditorState["type"])}
            options={[
              { value: "circular", label: "Circular" },
              { value: "up", label: "Up" },
              { value: "down", label: "Down" },
            ]}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[9px] text-white/30 font-black uppercase tracking-widest px-1">Colour</label>
          <div className="flex items-center gap-1.5 h-11">
            {ROUTE_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setField("color", c)}
                className="w-6 h-6 rounded-full border-2 transition-all"
                style={{ background: c, borderColor: state.color === c ? "white" : "transparent" }}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-2 shrink-0 self-end">
          <button
            onClick={handleSave}
            disabled={saving || state.stops.length < 2}
            className="h-11 px-5 rounded-xl bg-white text-[#09090b] font-black text-xs uppercase tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 hover:bg-white/90 shadow-lg"
          >
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : <><Save className="w-3.5 h-3.5" /> {state.mode === "edit" ? "Update" : "Deploy"}</>}
          </button>
        </div>
      </div>



      {/* Body: map + stop list */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        {/* Map */}
        <div className="flex-1 relative min-h-[260px]">
          <GoogleMap mapId={MAPS_MAP_ID} defaultCenter={DEFAULT_CENTER} defaultZoom={13} style={{ width: "100%", height: "100%" }} {...MAP_OPTIONS}>
            <TrafficLayer />
            <MapCenter center={mapCenter} />
            <DirectionsRoute
              stops={routeStops}
              polyline={state.mode === "edit" ? state.polyline : undefined}
              color={state.color}
              hasBuses={false}
            />
            {state.stops.map((stop, i) => (
              <AdvancedMarker
                key={`s-${i}`}
                position={{ lat: stop.lat, lng: stop.lng }}
                draggable
                onDragStart={() => setPositionMessage(`Moving stop ${stopLabel(i)}…`)}
                onDragEnd={(e: google.maps.MapMouseEvent) => {
                  if (e.latLng) updateStopPosition(i, e.latLng.lat(), e.latLng.lng());
                }}
                title={`Drag to move stop ${stopLabel(i)}`}
              >
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", cursor: "grab", userSelect: "none", touchAction: "none" }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 12,
                    background: state.color, border: "3px solid #09090b",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "white", fontSize: 9, fontWeight: 900,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                  }}>{stopLabel(i)}</div>
                  <div style={{
                    marginTop: 3, padding: "2px 6px", background: "rgba(9,9,11,0.9)",
                    border: "1px solid rgba(255,255,255,0.1)", color: "white",
                    borderRadius: 5, fontSize: 8, fontWeight: 800,
                    whiteSpace: "nowrap", letterSpacing: "0.08em",
                  }}>{stop.shortName}</div>
                </div>
              </AdvancedMarker>
            ))}
          </GoogleMap>
          <p
            className="absolute bottom-3 left-3 right-3 rounded-lg border border-white/10 bg-[#09090b]/90 px-3 py-2 text-xs font-medium text-white/70 shadow-lg pointer-events-none"
            role="status"
            aria-live="polite"
          >
            {positionMessage}
          </p>
        </div>

        {/* Stop list sidebar */}
        <div className="w-full lg:w-[300px] shrink-0 flex flex-col border-t lg:border-t-0 lg:border-l border-white/5 bg-[#09090b]/40 backdrop-blur-xl">
          {/* Display Name field */}
          <div className="px-4 pt-4 pb-3 border-b border-white/5">
            <label className="text-[9px] text-white/30 font-black uppercase tracking-widest block mb-1.5">Display Name</label>
            <input
              value={state.name}
              onChange={e => setField("name", e.target.value)}
              placeholder="e.g. Shela to LD"
              className="w-full h-11 bg-[#0f0f12] border border-white/10 rounded-xl px-3 text-sm text-white focus:outline-none focus:border-white/30 placeholder:text-white/15 font-medium"
            />
          </div>
          <div className="px-4 py-3 flex items-center justify-between bg-[#0f0f12]/80 backdrop-blur-xl border-b border-white/5">
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Stops</span>
            </div>
            <span className="text-[9px] font-black text-emerald-400/50 bg-emerald-500/10 px-2 py-0.5 rounded-full">{state.stops.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5">
            {state.stops.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center opacity-20 gap-2">
                <Search className="w-6 h-6" />
                <p className="text-xs font-semibold uppercase tracking-widest leading-relaxed">Search to add stops</p>
              </div>
            ) : (
              state.stops.map((stop, i) => (
                <div key={`${stop.id}-${i}`}>
                  <StopItem stop={stop} index={i} onRemove={removeStop} onNameChange={renameStop} />
                  <div className="flex items-center gap-1.5 pl-6 my-0.5">
                    <div className="w-px h-4 bg-emerald-500/15 mx-2" />
                    <div className="flex gap-1">
                      <button
                        onClick={() => moveStop(i, i - 1)}
                        disabled={i === 0}
                        className="w-5 h-5 rounded hover:bg-white/5 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move up"
                      >
                        <ChevronUp className="w-3 h-3 text-white/20" />
                      </button>
                      <button
                        onClick={() => moveStop(i, i + 1)}
                        disabled={i === state.stops.length - 1}
                        className="w-5 h-5 rounded hover:bg-white/5 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move down"
                      >
                        <ChevronDown className="w-3 h-3 text-white/20" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          {state.stops.length < 2 && (
            <p className="text-center text-[9px] text-white/20 font-semibold uppercase tracking-widest py-2 border-t border-white/5">
              Min. 2 stops to save
            </p>
          )}
        </div>
      </div>

      <AlertModal
        isOpen={Boolean(editorAlertMsg)}
        message={editorAlertMsg || ""}
        onClose={() => setEditorAlertMsg(null)}
      />
    </div>
  );
}

/* â”€â”€ Main Route Management Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export default function RouteManagementPanel() {
  const { routes, loading, error: routesError, retry: retryRoutes } = useRoutes();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [successMsg, setSuccessMsg] = useState("");
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deleteRouteId, setDeleteRouteId] = useState<string | null>(null);
  const [panelAlertMsg, setPanelAlertMsg] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  const openCreate = () => setEditor({ ...EMPTY_EDITOR, mode: "create" });

  const openEdit = (route: RouteData) =>
    setEditor({
      mode: "edit",
      routeId: route.id,
      name: route.name,
      color: route.color || "#3B82F6",
      type: (route.type as EditorState["type"]) || "circular",
      stops: route.stops ?? [],
      polyline: route.polyline,
    });

  const handleSaved = () => {
    setEditor(null);
    setSuccessMsg(editor?.mode === "edit" ? "Route updated!" : "Route deployed!");
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => setSuccessMsg(""), 4000);
  };

  const handleDelete = (id: string) => {
    setDeleteRouteId(id);
  };

  const confirmDeleteRoute = async () => {
    if (!deleteRouteId) return;
    const id = deleteRouteId;
    setIsDeleting(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Route service is unavailable.");
      const token = await currentUser.getIdToken();
      await apiRequest(`/api/routes/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        fallbackError: "Unable to delete route.",
      });
      setDeleteRouteId(null);
    } catch (error: unknown) {
      setPanelAlertMsg("Failed to delete: " + errorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  };

  if (editor) {
    return <RouteEditor initial={editor} onSaved={handleSaved} onCancel={() => setEditor(null)} />;
  }

  const selectedRouteName = deleteRouteId ? (routes.find(r => r.id === deleteRouteId)?.name ?? deleteRouteId) : "";

  return (
    <div className="w-full max-w-4xl mx-auto p-4 md:p-6 flex flex-col gap-4 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-xl text-white">Routes</h2>
          <p className="text-xs text-white/30 mt-0.5">Manage bus routes and stops</p>
        </div>
        <button
          onClick={openCreate}
          className="min-h-11 flex items-center gap-2 px-4 py-3 rounded-xl bg-white text-[#09090b] font-bold text-sm hover:bg-white/90 transition-colors shadow-lg"
        >
          <Plus className="w-4 h-4" /> Add Route
        </button>
      </div>

      {successMsg && (
        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl px-4 py-2.5 text-sm font-semibold animate-slide-up">
          <CheckCircle className="w-4 h-4 shrink-0" /> {successMsg}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {routesError ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/5 py-16 text-center text-red-300" role="alert">
            <span className="text-sm font-semibold">Couldn&apos;t load routes.</span>
            <span className="mt-1 text-xs text-red-300/70">{routesError}</span>
            <button
              type="button"
              onClick={retryRoutes}
              className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-white/20 gap-3">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-xs font-semibold uppercase tracking-widest">Loading routes…</span>
          </div>
        ) : routes.length === 0 ? (
          <div className="text-center py-16 text-white/20 text-sm font-semibold">No routes yet. Click &ldquo;Add Route&rdquo; to create one.</div>
        ) : (
          routes.map(route => (
            <RouteCard key={route.id} route={route} onEdit={() => openEdit(route)} onDelete={handleDelete} />
          ))
        )}
      </div>

      <ConfirmModal
        isOpen={Boolean(deleteRouteId)}
        title="Delete Route?"
        description={`Are you sure you want to delete route "${selectedRouteName}"? This action cannot be undone.`}
        confirmText="Delete Route"
        cancelText="Cancel"
        variant="danger"
        loading={isDeleting}
        onConfirm={confirmDeleteRoute}
        onCancel={() => setDeleteRouteId(null)}
      />

      <AlertModal
        isOpen={Boolean(panelAlertMsg)}
        message={panelAlertMsg || ""}
        onClose={() => setPanelAlertMsg(null)}
      />
    </div>
  );
}
