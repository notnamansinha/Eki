"use client";

import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRoutes, RouteData, RouteStop } from "@/hooks/useRoutes";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Trash2, Plus, X, CheckCircle, MapPin,
  Loader2, Search, ChevronDown, ChevronUp,
} from "lucide-react";
let L: any;
if (typeof window !== "undefined") {
  L = require("leaflet");
}
import "leaflet/dist/leaflet.css";

if (typeof window !== "undefined" && L) {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});
}

const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), { ssr: false });

function stopLabel(index: number): string {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (index < 26) return alpha[index];
  return alpha[Math.floor(index / 26) - 1] + alpha[index % 26];
}

interface PlaceResult {
  name: string;
  lat: number;
  lng: number;
}

interface SearchBoxProps {
  onPlaceSelect: (place: PlaceResult) => void;
}

function SearchBox({ onPlaceSelect }: SearchBoxProps) {
  const [inputValue, setInputValue] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (inputValue.length > 2) {
        setIsSearching(true);
        fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(inputValue)}&limit=5`)
          .then(res => res.json())
          .then(data => {
            setResults(data);
            setIsSearching(false);
          })
          .catch(() => setIsSearching(false));
      } else {
        setResults([]);
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [inputValue]);

  return (
    <div className="relative flex-1">
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 pointer-events-none">
        {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
      </div>
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder="Search for a stop..."
        className="w-full h-10 bg-brand-dark border border-white/10 rounded-xl pl-10 pr-4 text-sm text-white focus:outline-none focus:border-white/40 transition-colors placeholder:text-white/20 font-bold"
      />
      {results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-brand-dark border border-white/10 rounded-xl overflow-hidden z-50">
          {results.map((r, i) => (
            <div 
              key={i} 
              className="p-3 hover:bg-white/10 cursor-pointer text-xs text-white border-b border-white/5 last:border-0"
              onClick={() => {
                onPlaceSelect({
                  name: r.display_name,
                  lat: parseFloat(r.lat),
                  lng: parseFloat(r.lon)
                });
                setInputValue("");
                setResults([]);
              }}
            >
              {r.display_name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RouteCard({ route, onDelete }: { route: RouteData; onDelete: (id: string) => void; }) {
  const [stopsOpen, setStopsOpen] = useState(false);

  return (
    <div className="group bg-brand-dark/30 border border-white/5 rounded-[1.2rem] overflow-hidden hover:bg-white/5 transition-all duration-300">
      <div className="flex justify-between items-start p-4 gap-3">
        <div className="space-y-1 min-w-0">
          <h3 className="font-bold text-white tracking-tight truncate">{route.name}</h3>
          <div className="text-[10px] text-white/20 font-mono tracking-widest uppercase">{route.id}</div>
        </div>
        <button
          onClick={() => onDelete(route.id)}
          className="p-2 rounded-xl bg-white/5 text-red-400 hover:bg-red-500 hover:text-white transition-all opacity-0 group-hover:opacity-100 shadow-xl shrink-0"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setStopsOpen((o) => !o)}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/5 text-[9px] font-black tracking-widest text-white/50 uppercase hover:bg-white/10 hover:text-white/80 transition-all"
        >
          <MapPin className="w-2.5 h-2.5" />
          {route.stops?.length || 0} Stops
          {stopsOpen ? <ChevronUp className="w-2.5 h-2.5 ml-0.5" /> : <ChevronDown className="w-2.5 h-2.5 ml-0.5" />}
        </button>
      </div>

      {stopsOpen && route.stops && route.stops.length > 0 && (
        <div className="border-t border-white/5 px-4 py-3 flex flex-col gap-0">
          {route.stops.map((stop, i) => (
            <div key={i} className="flex items-stretch gap-3">
              <div className="flex flex-col items-center shrink-0">
                <div className="w-7 h-7 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-black text-[10px] shrink-0">
                  {stopLabel(i)}
                </div>
                {i < route.stops!.length - 1 && <div className="flex-1 w-px my-1 bg-white/10 min-h-[14px]" />}
              </div>
              <div className="pb-3 flex flex-col justify-center min-w-0">
                <span className="text-sm font-bold text-white/80 leading-tight truncate">{stop.name}</span>
                {stop.shortName && stop.shortName !== stop.name && (
                  <span className="text-[9px] text-white/30 font-mono tracking-widest truncate">{stop.shortName}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MapControls({ center }: { center: {lat: number, lng: number} | null }) {
  const [useMap, setUseMap] = useState<any>(null);

  useEffect(() => {
    import('react-leaflet').then((mod) => {
      setUseMap(() => mod.useMap);
    });
  }, []);

  if (useMap) {
    const MapHook = () => {
      const map = useMap();
      useEffect(() => {
        if (center && map) {
          map.panTo([center.lat, center.lng]);
          map.setZoom(15);
        }
      }, [center, map]);
      return null;
    };
    return <MapHook />;
  }
  return null;
}

export default function RouteManagementPanel() {
  const { routes, loading } = useRoutes();
  const [isCreating, setIsCreating] = useState(false);
  const [newRouteId, setNewRouteId] = useState("");
  const [newRouteName, setNewRouteName] = useState("");
  const [newStops, setNewStops] = useState<RouteStop[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [polylineBakeError, setPolylineBakeError] = useState<string | null>(null);
  
  const [mapCenter, setMapCenter] = useState<{lat: number, lng: number} | null>(null);

  const handlePlaceSelect = (place: PlaceResult) => {
    const name = place.name || "Unknown Stop";
    const stop: RouteStop = {
      id: `stop-${Date.now()}`,
      name,
      shortName: name.split(",")[0],
      lat: place.lat,
      lng: place.lng,
    };
    setNewStops((prev) => [...prev, stop]);
    setMapCenter({ lat: place.lat, lng: place.lng });
  };

  const handleRemoveStop = (index: number) => setNewStops((prev) => prev.filter((_, i) => i !== index));

  const handleSaveRoute = async () => {
    if (!newRouteId || !newRouteName || newStops.length < 2) {
      alert("Please provide an ID, Name, and at least 2 stops.");
      return;
    }
    setIsSaving(true);
    setPolylineBakeError(null);

    const waypointsForBake = newStops.map((s) => ({ lat: s.lat, lng: s.lng }));
    let bakedPolyline: string | undefined;

    try {
      const { auth } = await import("@/lib/firebase");
      const { getIdToken } = await import("firebase/auth");
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Must be logged in to create routes");
      const token = await getIdToken(currentUser);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
      const polyRes = await fetch(`${backendUrl}/api/routes/compute-polyline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ waypoints: waypointsForBake }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!polyRes.ok) {
        const errData = (await polyRes.json().catch(() => ({}))) as Record<string, string>;
        throw new Error(errData.error || `HTTP ${polyRes.status}`);
      }
      const polyData = (await polyRes.json()) as { polyline: string };
      bakedPolyline = polyData.polyline;
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      const msg = isTimeout ? "Backend unreachable (timeout)" : err instanceof Error ? err.message : "Unknown error";
      console.warn("⚠️ Polyline bake failed:", msg);
      setPolylineBakeError(`⚠️ Polyline bake skipped (${msg}). Route saved with straight-line fallback.`);
    }

    try {
      const routeData: RouteData = {
        id: newRouteId,
        name: newRouteName,
        stops: newStops,
        waypoints: waypointsForBake,
        color: "#3b82f6",
        ...(bakedPolyline ? { polyline: bakedPolyline } : {}),
      };
      await setDoc(doc(db, "routes", newRouteId), routeData);

      setIsCreating(false);
      setNewRouteId("");
      setNewRouteName("");
      setNewStops([]);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 5000);
    } catch (err) {
      console.error("Error saving route:", err);
      alert("Failed to save route to Firestore. Check your admin permissions and try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteRoute = async (id: string) => {
    if (confirm("Are you sure you want to delete this route?")) {
      try { await deleteDoc(doc(db, "routes", id)); } catch (e) { console.error(e); }
    }
  };

  if (!isCreating) {
    return (
      <div className="w-full max-w-4xl mx-auto p-3 md:p-6 flex flex-col gap-4 animate-slide-up">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-xl tracking-tight" style={{ fontFamily: "Outfit" }}>Infrastructure</h2>
            <p className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-black mt-0.5">Saved Routes</p>
          </div>
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-brand-dark hover:bg-white/90 transition shadow-xl text-xs font-black uppercase tracking-widest"
          >
            <Plus className="w-3.5 h-3.5" /> ADD ROUTE
          </button>
        </div>

        {showSuccess && (
          <div className="flex items-center gap-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-widest animate-slide-up">
            <CheckCircle className="w-4 h-4 shrink-0" /> Route deployed successfully!
          </div>
        )}

        <div className="flex flex-col gap-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-white/20">
              <Loader2 className="w-6 h-6 animate-spin mb-3" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Querying routes…</span>
            </div>
          ) : routes.length === 0 ? (
            <div className="text-white/20 text-xs font-bold text-center py-16 uppercase tracking-widest">No active routes.</div>
          ) : (
            routes.map((route) => <RouteCard key={route.id} route={route} onDelete={handleDeleteRoute} />)
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full animate-slide-up" style={{ height: "calc(100vh - 56px)" }}>
      <div className="shrink-0 border-b border-white/5 bg-brand-surface/90 backdrop-blur-2xl z-10 shadow-lg px-3 md:px-5 py-3 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1 flex-1 min-w-[130px]">
            <label className="text-[9px] text-white/20 font-black uppercase tracking-[0.2em] px-1">Route ID</label>
            <input type="text" value={newRouteId} onChange={(e) => setNewRouteId(e.target.value)} placeholder="e.g. route_101" className="h-9 bg-brand-dark border border-white/10 rounded-xl px-3 text-sm text-white focus:outline-none focus:border-white/40 transition-colors placeholder:text-white/10 font-bold" />
          </div>
          <div className="flex flex-col gap-1 flex-[2] min-w-[160px]">
            <label className="text-[9px] text-white/20 font-black uppercase tracking-[0.2em] px-1">Display Name</label>
            <input type="text" value={newRouteName} onChange={(e) => setNewRouteName(e.target.value)} placeholder="e.g. Downtown Express" className="h-9 bg-brand-dark border border-white/10 rounded-xl px-3 text-sm text-white focus:outline-none focus:border-white/40 transition-colors placeholder:text-white/10 font-bold" />
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={handleSaveRoute} disabled={isSaving || newStops.length < 2} className="h-9 px-4 rounded-xl bg-white text-brand-dark font-black transition disabled:opacity-20 disabled:cursor-not-allowed shadow-2xl text-xs uppercase tracking-[0.15em] flex items-center gap-2">
              {isSaving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Baking…</> : "Deploy"}
            </button>
            <button onClick={() => setIsCreating(false)} className="h-9 px-4 rounded-xl border border-white/10 text-white/40 hover:text-white hover:border-white/20 transition-all text-xs font-black uppercase tracking-widest">Cancel</button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <SearchBox onPlaceSelect={handlePlaceSelect} />
          <span className="hidden md:inline text-[9px] text-white/20 font-black uppercase tracking-widest shrink-0">Min. 2 stops to deploy</span>
        </div>
        {polylineBakeError && (
          <div className="flex items-center gap-2 bg-amber-500/20 border border-amber-500/30 text-amber-400 rounded-xl px-4 py-2 text-xs font-bold animate-slide-up">
            <span className="flex-1">{polylineBakeError}</span>
            <button onClick={() => setPolylineBakeError(null)} className="shrink-0 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        <div className="w-full h-[55vw] min-h-[260px] max-h-[460px] lg:h-auto lg:max-h-none lg:flex-1 relative z-0">
          {typeof window !== 'undefined' && (
            <MapContainer center={[23.0347, 72.5483]} zoom={13} style={{ width: "100%", height: "100%" }}>
              <TileLayer attribution='&copy; OSM' url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
              <MapControls center={mapCenter} />
              {newStops.map((stop, i) => (
                <Marker key={`stop-${i}`} position={[stop.lat, stop.lng]} icon={L.divIcon({
                  className: "route-creator-stop-icon",
                  html: `
                    <div class="relative group">
                      <div style="width:36px; height:36px; border-radius:16px; background:#10b981; border:4px solid #1a1a2e; display:flex; align-items:center; justify-content:center; color:white; font-size:10px; font-weight:900; box-shadow:0 0 15px rgba(0,0,0,0.3)">
                        ${stopLabel(i)}
                      </div>
                      <div class="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-1 bg-brand-dark/90 backdrop-blur-md rounded-lg border border-white/10 text-[9px] font-black text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity uppercase tracking-widest z-50">
                        ${stop.shortName}
                      </div>
                    </div>
                  `,
                  iconSize: [36, 36],
                  iconAnchor: [18, 18]
                })} />
              ))}
            </MapContainer>
          )}
        </div>

        <div className="w-full lg:w-[320px] shrink-0 flex flex-col border-t lg:border-t-0 lg:border-l border-white/5 bg-brand-surface/30 backdrop-blur-2xl overflow-y-auto">
          <div className="px-4 py-3 bg-emerald-500/5 flex items-center justify-between sticky top-0 backdrop-blur-xl z-10">
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">Route Stops</span>
            </div>
            <span className="text-[9px] font-black text-emerald-400/50 bg-emerald-400/10 px-2 py-0.5 rounded-md">{newStops.length}</span>
          </div>
          <div className="p-3 flex flex-col gap-0">
            {newStops.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center opacity-20">
                <Search className="w-6 h-6 mb-2" />
                <p className="text-[9px] font-bold uppercase tracking-widest leading-relaxed">Search to add stops</p>
              </div>
            ) : (
              newStops.map((stop, i) => (
                <div key={i} className="flex items-stretch gap-3">
                  <div className="flex flex-col items-center shrink-0 pt-1">
                    <span className="w-7 h-7 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-black shadow-lg text-[10px]">{stopLabel(i)}</span>
                    {i < newStops.length - 1 && <div className="flex-1 w-px my-1 bg-emerald-500/20 min-h-[10px]" />}
                  </div>
                  <div className="flex-1 pb-3 flex items-start justify-between group min-w-0 pt-1">
                    <div className="flex flex-col overflow-hidden pr-2">
                      <span className="text-white font-bold text-xs truncate tracking-tight">{stop.name}</span>
                      <span className="text-emerald-400/40 font-mono text-[8px] uppercase tracking-widest">{stop.shortName}</span>
                    </div>
                    <button onClick={() => handleRemoveStop(i)} className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100 shrink-0"><X className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
