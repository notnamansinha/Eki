"use client";

import { useState, useEffect, useRef, useMemo, useId } from "react";
import {
  Map as GoogleMap, AdvancedMarker, useMap, type MapMouseEvent as VisMapMouseEvent,
} from "@vis.gl/react-google-maps";
import DirectionsRoute from "@/components/maps/DirectionsRoute";
import TrafficLayer from "@/components/maps/TrafficLayer";
import { useRoutes, RouteData, RouteStop } from "@/hooks/useRoutes";
import { auth } from "@/lib/firebaseAuth";
import {
  Trash2, Plus, X, CheckCircle, MapPin, Loader2, Search,
  Pencil, Save,
  ChevronDown, ChevronUp, ArrowLeft, ArrowLeftRight, Crosshair,
} from "lucide-react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import AlertModal from "@/components/ui/AlertModal";
import { MAP_OPTIONS, MAPS_MAP_ID, DEFAULT_CENTER } from "@/config/maps";
import { errorMessage } from "@/lib/errors";
import { ApiError, apiRequest, acknowledgedField, isApiRecord } from "@/lib/apiClient";
import { placeSearchErrorMessage } from "@/lib/placeSearchErrors";
import { newRouteSaveId, saveRoute } from "@/lib/routeSaveClient";
import { useUnsavedChanges } from "@/lib/unsavedChanges";
import {
  prepareRouteSavePayload,
  reorderRouteStops,
  routeIdFromName,
  stopShortName,
  swapRouteEndpoints,
} from "@/lib/routeStopPayload";
import { stopLabel } from "@/lib/stopLabel";


/* ────────────────────────────────────────────────────────────────────────────────────────────────── */
const ROUTE_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#14B8A6", "#F97316",
];
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
  const [searchNotice, setSearchNotice] = useState("");

  useEffect(() => {
    if (value.trim().length < 3) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setSearchError("Place search is unavailable. Sign in again and retry.");
        return;
      }
      setSearching(true);
      setSearchError("");
      setSearchNotice("");
      try {
        const token = await currentUser.getIdToken();
        if (controller.signal.aborted) return;
        const payload = await apiRequest<{ results?: PlacePrediction[] }>(
          `/api/places/search?q=${encodeURIComponent(value)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
            fallbackError: "Place search is temporarily unavailable.",
          },
        );
        if (controller.signal.aborted) return;
        if (!isApiRecord(payload)) throw new Error("Place search is temporarily unavailable.");
        const results = Array.isArray(payload.results) ? payload.results : [];
        setPredictions(results);
        setSearchNotice(results.length === 0 ? "No matching places found. Try a more specific search." : "");
      } catch (error) {
        if (!controller.signal.aborted) {
          setPredictions([]);
          setSearchError(placeSearchErrorMessage(error));
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
    setSearching(false);
    setSearchError("");
    setSearchNotice("");
    onPlaceSelect(prediction);
  };

  return (
    <div className="relative flex-1">
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ui-quiet pointer-events-none">
        {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
      </div>
      <input
        type="search"
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          setValue(nextValue);
          setSearching(false);
          setPredictions([]);
          setSearchError("");
          setSearchNotice("");
        }}
        placeholder="Search for a stop"
        aria-label="Search for a stop"
        aria-describedby={searchError
          ? "place-search-error"
          : searchNotice
            ? "place-search-notice"
            : undefined}
        className="w-full h-11 bg-ui-paper border border-ui-line rounded-xl pl-10 pr-4 text-sm text-ui-ink focus:outline-none focus:border-ui-control transition-colors placeholder:text-ui-quiet font-medium"
      />
      {searchError && (
        <p id="place-search-error" className="mt-1 text-xs text-ui-danger" role="alert">
          {searchError}
        </p>
      )}
      {searchNotice && !searchError && (
        <p id="place-search-notice" className="mt-1 text-xs text-ui-quiet" role="status">
          {searchNotice}
        </p>
      )}
      {value.length >= 3 && predictions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-ui-paper border border-ui-line rounded-xl overflow-hidden z-50 shadow-2xl">
          {predictions.map((prediction) => (
            <button
              key={`${prediction.lat}-${prediction.lng}-${prediction.name}`}
              type="button"
              className="w-full text-left p-3 hover:bg-ui-soft text-xs text-ui-ink border-b border-ui-line last:border-0 transition-colors"
              onClick={() => handleSelect(prediction)}
            >
              <span className="font-semibold text-pretty">{prediction.name}</span>
              {prediction.address && (
                <span className="mt-0.5 block text-ui-quiet text-pretty">{prediction.address}</span>
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
    <div className="group bg-ui-paper border border-ui-line rounded-2xl overflow-hidden hover:border-ui-line transition-all">
      <div className="p-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-3 h-3 rounded-full shrink-0" style={{ background: route.color || "#3B82F6" }} />
          <div className="min-w-0">
            <p className="font-semibold text-ui-ink truncate">{route.name}</p>
            <p className="text-xs text-ui-quiet tabular-nums tracking-widest">{route.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <button type="button" onClick={onEdit} aria-label={`Edit route ${route.name}`} className="flex size-11 items-center justify-center rounded-lg text-ui-quiet hover:text-brand-accent hover:bg-brand-accent/10 transition-all" title="Edit route">
            <Pencil className="size-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => onDelete(route.id)} aria-label={`Delete route ${route.name}`} className="flex size-11 items-center justify-center rounded-lg text-ui-quiet hover:text-ui-danger hover:bg-ui-danger/10 transition-all" title="Delete route">
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="px-4 pb-3 flex items-center gap-2">
        <button onClick={() => setStopsOpen(o => !o)} aria-expanded={stopsOpen} className="min-h-11 flex items-center gap-1.5 px-3 rounded-full bg-ui-soft text-xs font-bold tracking-widest text-ui-muted uppercase hover:text-ui-muted transition-colors">
          <MapPin className="w-2.5 h-2.5" />
          {route.stops?.length ?? 0} Stops
          {stopsOpen ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
        </button>
        {route.distanceMeters && (
          <span className="text-xs text-ui-quiet tabular-nums">{(route.distanceMeters / 1000).toFixed(1)} km</span>
        )}
      </div>
      {stopsOpen && route.stops && route.stops.length > 0 && (
        <div className="border-t border-ui-line px-4 py-3 flex flex-col gap-0">
          {route.stops.map((stop, i) => (
            <div key={stop.id} className="flex items-stretch gap-3">
              <div className="flex flex-col items-center shrink-0">
                <div className="w-6 h-6 rounded-lg bg-ui-success/20 border border-ui-success/30 flex items-center justify-center text-ui-success font-bold text-xs shrink-0">
                  {stopLabel(i)}
                </div>
                {i < route.stops!.length - 1 && <div className="flex-1 w-px my-0.5 bg-ui-hover min-h-[12px]" />}
              </div>
              <div className="pb-2.5 flex flex-col justify-center min-w-0">
                <span className="text-sm font-medium text-ui-ink leading-tight truncate">{stop.name}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* â”€â”€ Stop list item (draggable in editor) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function StopItem({ stop, index, onRemove, onNameChange, onMoveUp, onMoveDown, canMoveUp, canMoveDown }: {
  stop: RouteStop; index: number;
  onRemove: (i: number) => void;
  onNameChange: (i: number, name: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(stop.name);
  const [nameError, setNameError] = useState("");
  const nameErrorId = useId();
  const committedRef = useRef(false);
  const commitName = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const nextName = val.trim();
    if (!nextName) {
      setVal(stop.name);
      setNameError("Stop name cannot be blank. Previous name kept.");
      setEditing(false);
      return;
    }
    setNameError("");
    onNameChange(index, nextName);
    setEditing(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ui-line bg-ui-paper p-1 sm:flex-nowrap">
      <span className="w-6 h-6 rounded-lg bg-ui-success/20 text-ui-success font-bold text-xs flex items-center justify-center shrink-0">
        {stopLabel(index)}
      </span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            value={val}
            onChange={e => setVal(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); commitName(); }
              else if (e.key === "Escape") {
                e.preventDefault();
                // Fence a blur from the removed input so it cannot save the draft.
                committedRef.current = true;
                setVal(stop.name);
                setEditing(false);
              }
            }}
            autoFocus
            aria-label={`Rename stop ${stop.name}`}
            className="w-full min-w-0 h-11 bg-ui-soft border border-ui-control rounded-lg px-2 text-sm text-ui-ink focus:outline-none focus:border-ui-control"
          />
        ) : (
          <button
            type="button"
            className="w-full min-h-11 text-left cursor-text min-w-0"
            onClick={() => { committedRef.current = false; setNameError(""); setVal(stop.name); setEditing(true); }}
            aria-describedby={nameError ? nameErrorId : undefined}
            title="Click to rename"
          >
            <span className="block truncate text-sm text-ui-ink font-medium">{stop.name}</span>
            <span className="block text-xs tabular-nums text-ui-quiet">
              {Number(stop.lat).toFixed(6)}, {Number(stop.lng).toFixed(6)}
            </span>
          </button>
        )}
        {nameError && <p id={nameErrorId} role="alert" className="mt-1 text-pretty text-xs text-ui-danger">{nameError}</p>}
      </div>
      <div className="ml-8 flex shrink-0 items-center gap-1 sm:ml-0">
        <button type="button" onClick={onMoveUp} disabled={!canMoveUp} aria-label={`Move stop ${stop.name} up`} className="size-11 rounded-lg text-ui-muted hover:bg-ui-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-success disabled:cursor-not-allowed disabled:text-ui-quiet">
          <ChevronUp className="mx-auto size-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={onMoveDown} disabled={!canMoveDown} aria-label={`Move stop ${stop.name} down`} className="size-11 rounded-lg text-ui-muted hover:bg-ui-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-success disabled:cursor-not-allowed disabled:text-ui-quiet">
          <ChevronDown className="mx-auto size-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => onRemove(index)} aria-label={`Remove stop ${stop.name}`} className="size-11 rounded-lg text-ui-danger hover:bg-ui-danger/10 hover:text-ui-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-danger">
          <X className="mx-auto size-4" aria-hidden="true" />
        </button>
      </div>
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
  stops: RouteStop[];
  polyline?: string;
  configVersion: number;
}

const EMPTY_EDITOR: EditorState = {
  mode: "create",
  routeId: "",
  name: "",
  color: "#3B82F6",
  stops: [],
  configVersion: 0,
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
  const [placingManualStop, setPlacingManualStop] = useState(false);
  const [routeIdEdited, setRouteIdEdited] = useState(Boolean(initial.routeId));
  const saveOperationRef = useRef<{ payload: string; saveId: string } | null>(null);
  const editorId = useId();
  const draftKey = (draft: EditorState) => JSON.stringify([draft.routeId, draft.name, draft.color, draft.stops]);
  useUnsavedChanges(draftKey(state) !== draftKey(initial));

  const setField = <K extends keyof EditorState>(k: K, v: EditorState[K]) =>
    setState(s => ({ ...s, [k]: v }));

  const handlePlaceSelect = (place: { name: string; lat: number; lng: number }) => {
    if (state.stops.length >= 100) {
      setEditorAlertMsg("A route can have at most 100 stops.");
      return;
    }
    if (!place.name.trim() || !Number.isFinite(place.lat) || place.lat < -90 || place.lat > 90 || !Number.isFinite(place.lng) || place.lng < -180 || place.lng > 180) {
      setEditorAlertMsg("That search result does not include valid map coordinates. Pick another result or use Pick on Map.");
      return;
    }
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

  const handleMapClick = (event: VisMapMouseEvent) => {
    if (!placingManualStop || !event.detail.latLng) return;
    event.stop();
    if (state.stops.length >= 100) {
      setEditorAlertMsg("A route can have at most 100 stops.");
      setPlacingManualStop(false);
      return;
    }
    const { lat, lng } = event.detail.latLng;
    setState(current => {
      const label = stopLabel(current.stops.length);
      const name = `Map stop ${label}`;
      const stop: RouteStop = {
        id: `stop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        shortName: name,
        lat,
        lng,
      };
      setPositionMessage(`Stop ${label} added at ${lat.toFixed(6)}, ${lng.toFixed(6)}. Click its name to rename it.`);
      return { ...current, stops: [...current.stops, stop], polyline: undefined };
    });
    setPlacingManualStop(false);
    setMapCenter({ lat, lng });
  };

  const updateRouteName = (name: string) => {
    setState(current => ({
      ...current,
      name,
      routeId: current.mode === "create" && !routeIdEdited
        ? routeIdFromName(name)
        : current.routeId,
    }));
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
    setState(s => ({
      ...s,
      stops: reorderRouteStops(s.stops, from, to),
      polyline: undefined,
    }));
  };

  const swapEndpoints = () => setState(s => ({
    ...s,
    stops: swapRouteEndpoints(s.stops),
    polyline: undefined,
  }));

  const updateStopPosition = (i: number, lat: number, lng: number) => {
    setState(s => {
      const stops = [...s.stops];
      stops[i] = { ...stops[i], lat, lng };
      return { ...s, stops, polyline: undefined };
    });
    setPositionMessage(`Stop ${stopLabel(i)} moved. Save the route to publish the new location.`);
  };

  const handleSave = async () => {
    const prepared = prepareRouteSavePayload(state);
    if (!prepared.ok) {
      setEditorAlertMsg(prepared.error);
      return;
    }
    const { routeId, body } = prepared.value;
    setSaving(true);

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("Route geometry service is unavailable. Sign in again and retry.");
      }

      const token = await currentUser.getIdToken(true);
      const operationBody = { ...body, expectedVersion: state.configVersion };
      const payload = JSON.stringify({ routeId, ...operationBody });
      if (saveOperationRef.current?.payload !== payload) {
        saveOperationRef.current = { payload, saveId: newRouteSaveId() };
      }
      await saveRoute(
        routeId,
        saveOperationRef.current.saveId,
        operationBody,
        token,
      );

      onSaved();
    } catch (error: unknown) {
      if (!(error instanceof ApiError) || !error.outcomeUnknown) {
        saveOperationRef.current = null;
      }
      setEditorAlertMsg("Failed to save: " + errorMessage(error));
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
      <div className="shrink-0 border-b border-ui-line bg-ui-paper backdrop-blur-2xl px-4 py-3 flex flex-wrap gap-3 items-end relative z-10 overflow-visible">
        <button onClick={onCancel} aria-label="Cancel route editing" className="w-11 h-11 rounded-xl bg-ui-soft flex items-center justify-center hover:bg-ui-hover transition-colors shrink-0 self-center">
          <ArrowLeft className="w-4 h-4 text-ui-muted" />
        </button>

        <div className="flex flex-col gap-1 min-w-[110px]">
          <label htmlFor={`${editorId}-route-id`} className="text-xs text-ui-quiet font-bold uppercase tracking-widest px-1">Route ID</label>
          <input
            id={`${editorId}-route-id`}
            value={state.routeId}
            onChange={e => {
              setRouteIdEdited(true);
              setField("routeId", e.target.value);
            }}
            disabled={state.mode === "edit"}
            placeholder="Generated from name"
            className="h-11 bg-ui-paper border border-ui-line rounded-xl px-3 text-sm text-ui-ink focus:outline-none focus:border-ui-control placeholder:text-ui-quiet font-medium disabled:opacity-40"
          />
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
          <span className="text-xs text-ui-quiet font-bold uppercase tracking-widest px-1">Search Stop</span>
          <PlacesSearchBox onPlaceSelect={handlePlaceSelect} />
        </div>

        <div className="flex flex-col gap-1">
          <span id={`${editorId}-colour`} className="text-xs text-ui-quiet font-bold uppercase tracking-widest px-1">Colour</span>
          <div role="group" aria-labelledby={`${editorId}-colour`} className="flex items-center gap-1.5 h-11">
            {ROUTE_COLORS.map(c => (
              <button
                key={c}
                type="button"
                aria-label={`Route colour ${c}`}
                aria-pressed={state.color === c}
                onClick={() => setField("color", c)}
                className="w-6 h-6 rounded-full border-2 transition-all"
                style={{ background: c, borderColor: state.color === c ? "white" : "transparent" }}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-2 shrink-0 self-end">
          <button
            type="button"
            onClick={() => {
              setPlacingManualStop(active => {
                const next = !active;
                setPositionMessage(next
                  ? "Click any point or visible place on the map to add a stop."
                  : "Drag any map pin to fine-tune a stop's location.");
                return next;
              });
            }}
            className={`h-11 px-4 rounded-xl border font-bold text-xs uppercase tracking-widest transition-all flex items-center gap-2 ${placingManualStop ? "border-ui-success bg-ui-success/15 text-ui-success" : "border-ui-line bg-ui-soft text-ui-muted hover:bg-ui-hover"}`}
          >
            <Crosshair className="w-3.5 h-3.5" /> {placingManualStop ? "Click Map" : "Pick on Map"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || state.stops.length < 2}
            className="h-11 px-5 rounded-xl bg-brand-accent text-ui-on-accent font-bold text-xs uppercase tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 hover:bg-ui-accent-hover shadow-lg"
          >
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : <><Save className="w-3.5 h-3.5" /> {state.mode === "edit" ? "Update" : "Deploy"}</>}
          </button>
        </div>
      </div>



      {/* Body: map + stop list */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        {/* Map */}
        <div className="flex-1 relative min-h-[260px]">
          <GoogleMap mapId={MAPS_MAP_ID} reuseMaps defaultCenter={DEFAULT_CENTER} defaultZoom={13} style={{ width: "100%", height: "100%" }} onClick={handleMapClick} {...MAP_OPTIONS}>
            <TrafficLayer />
            <MapCenter center={mapCenter} />
            <DirectionsRoute
              stops={routeStops}
              polyline={state.mode === "edit" ? state.polyline : undefined}
              color={state.color}
              hasBuses={false}
              direction="forward"
            />
            {state.stops.map((stop, i) => (
              <AdvancedMarker
                key={stop.id}
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
                    background: state.color, border: "3px solid var(--surface-1)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "var(--accent-contrast)", fontSize: 12, fontWeight: 700,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                  }}>{stopLabel(i)}</div>
                  <div style={{
                    marginTop: 3, padding: "2px 6px", background: "var(--surface-1)",
                    border: "1px solid var(--border-subtle)", color: "var(--text-primary)",
                    borderRadius: 5, fontSize: 12, fontWeight: 800,
                    whiteSpace: "nowrap", letterSpacing: "0.08em",
                  }}>{stop.shortName}</div>
                </div>
              </AdvancedMarker>
            ))}
          </GoogleMap>
          <p
            className="absolute bottom-3 left-3 right-3 rounded-lg border border-ui-line bg-ui-paper px-3 py-2 text-xs font-medium text-ui-muted shadow-lg pointer-events-none"
            role="status"
            aria-live="polite"
          >
            {positionMessage}
          </p>
        </div>

        {/* Stop list sidebar */}
        <div className="w-full lg:w-[300px] shrink-0 flex flex-col border-t lg:border-t-0 lg:border-l border-ui-line bg-ui-paper backdrop-blur-xl">
          {/* Display Name field */}
          <div className="px-4 pt-4 pb-3 border-b border-ui-line">
            <label htmlFor={`${editorId}-route-name`} className="text-xs text-ui-quiet font-bold uppercase tracking-widest block mb-1.5">Display Name</label>
            <input
              id={`${editorId}-route-name`}
              value={state.name}
              onChange={e => updateRouteName(e.target.value)}
              placeholder="e.g. Shela to LD"
              className="w-full h-11 bg-ui-paper border border-ui-line rounded-xl px-3 text-sm text-ui-ink focus:outline-none focus:border-ui-control placeholder:text-ui-quiet font-medium"
            />
          </div>
          <div className="px-4 py-3 flex items-center justify-between bg-ui-paper backdrop-blur-xl border-b border-ui-line">
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-ui-success" />
              <span className="text-xs font-bold uppercase tracking-widest text-ui-success">Stops</span>
            </div>
            <div className="flex items-center gap-2">
              {state.stops.length === 2 && (
                <button
                  type="button"
                  onClick={swapEndpoints}
                  className="min-h-9 rounded-lg border border-ui-line bg-ui-soft px-2.5 text-xs font-bold uppercase tracking-wider text-ui-muted hover:bg-ui-hover"
                  title="Swap route origin and destination"
                >
                  <ArrowLeftRight className="mr-1 inline h-3 w-3" /> Swap A &amp; B
                </button>
              )}
              <span className="text-xs font-bold text-ui-success bg-ui-success/10 px-2 py-0.5 rounded-full">{state.stops.length}</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5">
            {state.stops.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-ui-quiet gap-2">
                <Search className="w-6 h-6" />
                <p className="text-xs font-semibold uppercase tracking-widest leading-relaxed">Search to add stops</p>
              </div>
            ) : (
              state.stops.map((stop, i) => (
                <div key={stop.id}>
                  <StopItem
                    stop={stop}
                    index={i}
                    onRemove={removeStop}
                    onNameChange={renameStop}
                    onMoveUp={() => moveStop(i, i - 1)}
                    onMoveDown={() => moveStop(i, i + 1)}
                    canMoveUp={i > 0}
                    canMoveDown={i < state.stops.length - 1}
                  />
                </div>
              ))
            )}
          </div>
          {state.stops.length < 2 && (
            <p className="text-center text-xs text-ui-quiet font-semibold uppercase tracking-widest py-2 border-t border-ui-line">
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
      stops: route.stops ?? [],
      polyline: route.polyline,
      configVersion: Number.isSafeInteger(route.configVersion)
        ? Number(route.configVersion)
        : 0,
    });

  const handleSaved = (savedEditor: EditorState) => {
    // A save that outlives its cancelled editor must not close a newer draft.
    setEditor(current => current === savedEditor ? null : current);
    setSuccessMsg(savedEditor.mode === "edit" ? "Route updated!" : "Route deployed!");
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
        validateResponse: value => acknowledgedField(value, "deleted"),
      });
      setDeleteRouteId(null);
    } catch (error: unknown) {
      // Close the confirmation so its backdrop does not cover the error dialog.
      setDeleteRouteId(null);
      setPanelAlertMsg("Failed to delete: " + errorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  };

  if (editor) {
    return <RouteEditor initial={editor} onSaved={() => handleSaved(editor)} onCancel={() => setEditor(null)} />;
  }

  const selectedRouteName = deleteRouteId ? (routes.find(r => r.id === deleteRouteId)?.name ?? deleteRouteId) : "";

  return (
    <div className="w-full max-w-4xl mx-auto p-4 md:p-6 flex flex-col gap-4 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-xl text-ui-ink">Routes</h2>
          <p className="text-xs text-ui-quiet mt-0.5">Manage bus routes and stops</p>
        </div>
        <button
          onClick={openCreate}
          className="min-h-11 flex items-center gap-2 px-4 py-3 rounded-xl bg-brand-accent text-ui-on-accent font-bold text-sm hover:bg-ui-accent-hover transition-colors shadow-lg"
        >
          <Plus className="w-4 h-4" /> Add Route
        </button>
      </div>

      {successMsg && (
        <div className="flex items-center gap-2 bg-ui-success/10 border border-ui-success/20 text-ui-success rounded-xl px-4 py-2.5 text-sm font-semibold animate-slide-up">
          <CheckCircle className="w-4 h-4 shrink-0" /> {successMsg}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {routesError ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-ui-danger/20 bg-ui-danger/5 py-16 text-center text-ui-danger" role="alert">
            <span className="text-sm font-semibold">Couldn&apos;t load routes.</span>
            <span className="mt-1 text-xs text-ui-danger">{routesError}</span>
            <button
              type="button"
              onClick={retryRoutes}
              className="mt-4 rounded-lg bg-ui-hover px-4 py-2 text-xs font-semibold text-ui-ink"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-ui-quiet gap-3">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-xs font-semibold uppercase tracking-widest">Loading routes…</span>
          </div>
        ) : routes.length === 0 ? (
          <div className="text-center py-16 text-ui-quiet text-sm font-semibold">No routes yet. Click &ldquo;Add Route&rdquo; to create one.</div>
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
