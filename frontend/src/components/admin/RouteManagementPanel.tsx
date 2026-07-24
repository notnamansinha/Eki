"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Map as GoogleMap, AdvancedMarker, useMap,
} from "@vis.gl/react-google-maps";
import DirectionsRoute from "@/components/maps/DirectionsRoute";
import { useRoutes, RouteData, RouteStop } from "@/hooks/useRoutes";
import { doc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  Trash2, Plus, X, CheckCircle, MapPin, Loader2, Search,
  Pencil, GripVertical, Save,
  ChevronDown, ChevronUp, ArrowLeft,
} from "lucide-react";
import { MAP_OPTIONS, MAPS_MAP_ID, DEFAULT_CENTER } from "@/config/maps";
import { errorMessage } from "@/lib/errors";


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

/* ── Google Maps Places Autocomplete search box ─────────────────────────── */
function PlacesSearchBox({ onPlaceSelect }: { onPlaceSelect: (p: { name: string; lat: number; lng: number }) => void }) {
  const [value, setValue] = useState("");
  const [predictions, setPredictions] = useState<google.maps.places.AutocompletePrediction[]>([]);
  const [searching, setSearching] = useState(false);
  const [ready, setReady] = useState(false);
  const autocompleteRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesRef = useRef<google.maps.places.PlacesService | null>(null);
  const dummyRef = useRef<HTMLDivElement>(null);

  // Poll until google.maps.places is loaded (handles any mount timing)
  useEffect(() => {
    const check = () => {
      if (typeof window !== "undefined" && window.google?.maps?.places && dummyRef.current) {
        autocompleteRef.current = new window.google.maps.places.AutocompleteService();
        placesRef.current = new window.google.maps.places.PlacesService(dummyRef.current);
        setReady(true);
        return true;
      }
      return false;
    };
    if (check()) return;
    const id = setInterval(() => { if (check()) clearInterval(id); }, 300);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (value.length < 3 || !ready) { setPredictions([]); return; }
    const svc = autocompleteRef.current;
    if (!svc) return;
    setSearching(true);
    svc.getPlacePredictions({ input: value }, (results, status) => {
      setSearching(false);
      if (status === google.maps.places.PlacesServiceStatus.OK && results) {
        setPredictions(results);
      } else {
        setPredictions([]);
      }
    });
  }, [value, ready]);

  const handleSelect = (pred: google.maps.places.AutocompletePrediction) => {
    const svc = placesRef.current;
    if (!svc) return;
    setValue("");
    setPredictions([]);
    svc.getDetails({ placeId: pred.place_id, fields: ["geometry", "name"] }, (place, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
        onPlaceSelect({
          name: place.name ?? pred.description,
          lat: place.geometry.location.lat(),
          lng: place.geometry.location.lng(),
        });
      }
    });
  };

  return (
    <div className="relative flex-1">
      <div ref={dummyRef} style={{ display: "none" }} />
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 pointer-events-none">
        {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
      </div>
      <input
        type="text" value={value} onChange={e => setValue(e.target.value)}
        placeholder={ready ? "Search for a stop (Google Maps)…" : "Loading Maps…"}
        disabled={!ready}
        className="w-full h-9 bg-[#09090b] border border-white/10 rounded-xl pl-10 pr-4 text-sm text-white focus:outline-none focus:border-white/30 transition-colors placeholder:text-white/20 font-medium disabled:opacity-40"
      />
      {value.length >= 3 && predictions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#0f0f12] border border-white/10 rounded-xl overflow-hidden z-50 shadow-2xl">
          {predictions.map((pred) => (
            <button key={pred.place_id} className="w-full text-left p-3 hover:bg-white/5 text-xs text-white border-b border-white/5 last:border-0 transition-colors" onClick={() => handleSelect(pred)}>
              <span className="font-semibold">{pred.structured_formatting.main_text}</span>
              <span className="text-white/40 ml-1">{pred.structured_formatting.secondary_text}</span>
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
          <button onClick={onEdit} className="p-2 rounded-lg text-white/30 hover:text-blue-400 hover:bg-blue-500/10 transition-all" title="Edit route">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(route.id)} className="p-2 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-all" title="Delete route">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="px-4 pb-3 flex items-center gap-2">
        <button onClick={() => setStopsOpen(o => !o)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 text-[9px] font-black tracking-widest text-white/50 uppercase hover:text-white/60 transition-colors">
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
          className="flex-1 h-8 bg-white/5 border border-white/20 rounded-lg px-2 text-sm text-white focus:outline-none focus:border-white/40"
        />
      ) : (
        <span
          className="flex-1 text-sm text-white/80 font-medium truncate cursor-text min-w-0"
          onClick={() => setEditing(true)}
          title="Click to rename"
        >
          {stop.name}
        </span>
      )}
      <button onClick={() => onRemove(index)} className="p-1.5 rounded-lg text-white/15 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all shrink-0">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/* â”€â”€ Route editor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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

  const setField = <K extends keyof EditorState>(k: K, v: EditorState[K]) =>
    setState(s => ({ ...s, [k]: v }));

  const handlePlaceSelect = (place: { name: string; lat: number; lng: number }) => {
    const stop: RouteStop = {
      id: `stop-${Date.now()}`,
      name: place.name,
      shortName: place.name.split(",")[0],
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
      stops[i] = { ...stops[i], name, shortName: name.split(",")[0] };
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

  const updateStopPosition = (i: number, lat: number, lng: number) =>
    setState(s => {
      const stops = [...s.stops];
      stops[i] = { ...stops[i], lat, lng };
      return { ...s, stops, polyline: undefined };
    });

  const handleSave = async () => {
    if (!state.routeId || !state.name || state.stops.length < 2) {
      alert("Route ID, name, and at least 2 stops are required.");
      return;
    }
    if (state.stops.length > 27) {
      alert("A route can have at most 27 stops.");
      return;
    }
    setSaving(true);

    try {
      const waypoints = state.stops.map(s => ({ lat: s.lat, lng: s.lng }));
      if (state.mode === "create") {
        const { getDoc } = await import("firebase/firestore");
        const existing = await getDoc(doc(db, "routes", state.routeId));
        if (existing.exists()) {
          alert(`A route with ID "${state.routeId}" already exists. Choose a different ID.`);
          return;
        }
      }

      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
      const currentUser = auth.currentUser;
      if (!backendUrl || !currentUser) {
        throw new Error("Route geometry service is unavailable. Sign in again and retry.");
      }

      const token = await currentUser.getIdToken(true);
      const geometryResponse = await fetch(`${backendUrl}/api/routes/compute-polyline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ waypoints }),
      });
      if (!geometryResponse.ok) {
        throw new Error("Unable to compute route geometry. The route was not saved.");
      }
      const geometry = await geometryResponse.json() as {
        polyline?: string;
        distanceMeters?: number;
        duration?: string;
      };
      if (!geometry.polyline || typeof geometry.distanceMeters !== "number" || typeof geometry.duration !== "string") {
        throw new Error("Route geometry service returned an invalid result.");
      }

      const routeData: Partial<RouteData> = {
        id: state.routeId,
        name: state.name,
        color: state.color,
        type: state.type,
        stops: state.stops,
        waypoints,
        polyline: geometry.polyline,
        distanceMeters: geometry.distanceMeters,
        duration: geometry.duration,
      };

      if (state.mode === "create") {
        // Guard against duplicate route IDs — check existence first
        await setDoc(doc(db, "routes", state.routeId), routeData as RouteData);
      } else {
        // Edit mode — persist the freshly computed geometry with the changed stops.
        await updateDoc(doc(db, "routes", state.routeId), routeData);
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
        <button onClick={onCancel} className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors shrink-0 self-center">
          <ArrowLeft className="w-4 h-4 text-white/60" />
        </button>

        <div className="flex flex-col gap-1 min-w-[110px]">
          <label className="text-[9px] text-white/30 font-black uppercase tracking-widest px-1">Route ID</label>
          <input
            value={state.routeId}
            onChange={e => setField("routeId", e.target.value)}
            disabled={state.mode === "edit"}
            placeholder="route_101"
            className="h-9 bg-[#09090b] border border-white/10 rounded-xl px-3 text-sm text-white focus:outline-none focus:border-white/30 placeholder:text-white/15 font-medium disabled:opacity-40"
          />
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
          <label className="text-[9px] text-white/30 font-black uppercase tracking-widest px-1">Search Stop</label>
          <PlacesSearchBox onPlaceSelect={handlePlaceSelect} />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[9px] text-white/30 font-black uppercase tracking-widest px-1">Type</label>
          <select
            value={state.type}
            onChange={e => setField("type", e.target.value as EditorState["type"])}
            className="h-9 bg-[#09090b] border border-white/10 rounded-xl px-3 text-sm text-white focus:outline-none focus:border-white/30 font-medium appearance-none cursor-pointer"
          >
            <option value="circular">Circular</option>
            <option value="up">Up</option>
            <option value="down">Down</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[9px] text-white/30 font-black uppercase tracking-widest px-1">Colour</label>
          <div className="flex items-center gap-1.5 h-9">
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
            className="h-9 px-5 rounded-xl bg-white text-[#09090b] font-black text-xs uppercase tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 hover:bg-white/90 shadow-lg"
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
                onDragEnd={(e: google.maps.MapMouseEvent) => {
                  if (e.latLng) updateStopPosition(i, e.latLng.lat(), e.latLng.lng());
                }}
                title={`Drag to move stop ${stopLabel(i)}`}
              >
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", cursor: "grab" }}>
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
              className="w-full h-9 bg-[#0f0f12] border border-white/10 rounded-xl px-3 text-sm text-white focus:outline-none focus:border-white/30 placeholder:text-white/15 font-medium"
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
    </div>
  );
}

/* â”€â”€ Main Route Management Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export default function RouteManagementPanel() {
  const { routes, loading } = useRoutes();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [successMsg, setSuccessMsg] = useState("");

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
    setTimeout(() => setSuccessMsg(""), 4000);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete route "${routes.find(r => r.id === id)?.name ?? id}"? This cannot be undone.`)) return;
    try { await deleteDoc(doc(db, "routes", id)); }
    catch (error: unknown) { alert("Failed to delete: " + errorMessage(error)); }
  };

  if (editor) {
    return <RouteEditor initial={editor} onSaved={handleSaved} onCancel={() => setEditor(null)} />;
  }

  return (
    <div className="w-full max-w-4xl mx-auto p-4 md:p-6 flex flex-col gap-4 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-xl text-white">Routes</h2>
          <p className="text-xs text-white/30 mt-0.5">Manage bus routes and stops</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#09090b] font-bold text-sm hover:bg-white/90 transition-colors shadow-lg"
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
        {loading ? (
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
    </div>
  );
}
