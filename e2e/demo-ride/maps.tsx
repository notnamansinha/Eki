import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

// A synthetic stand-in for the Google Maps SDK so the demo ride runs without a
// key: a Web Mercator camera the real MapCenterer drives (fitBounds, panTo,
// setZoom), markers placed by projection, and the real DirectionsRoute's
// google.maps.Polyline calls drawn as SVG. The paper basemap only suggests the
// streets around the demo route; it is not map data.

type LatLng = { lat: number; lng: number };
type Camera = { center: LatLng; zoom: number; width: number; height: number };

const TILE = 256;
const project = ({ lat, lng }: LatLng, zoom: number) => {
  const scale = TILE * 2 ** zoom;
  const sin = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
};

class SyntheticMap {
  camera: Camera = { center: { lat: 23.0455, lng: 72.53 }, zoom: 14, width: 390, height: 844 };
  div: HTMLDivElement | null = null;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.camera;
  private set(next: Partial<Camera>) { this.camera = { ...this.camera, ...next }; this.listeners.forEach(listener => listener()); }
  resize(width: number, height: number) { if (width !== this.camera.width || height !== this.camera.height) this.set({ width, height }); }
  getDiv() { return this.div; }
  panTo(center: LatLng) { this.set({ center: { lat: center.lat, lng: center.lng } }); }
  setZoom(zoom: number) { this.set({ zoom }); }
  setCenter(center: LatLng) { this.panTo(center); }
  fitBounds(bounds: { north: number; south: number; east: number; west: number }, padding: { top: number; bottom: number; left: number; right: number }) {
    const { width, height } = this.camera;
    const spanX = (zoom: number) => project({ lat: 0, lng: bounds.east }, zoom).x - project({ lat: 0, lng: bounds.west }, zoom).x;
    const spanY = (zoom: number) => project({ lat: bounds.south, lng: 0 }, zoom).y - project({ lat: bounds.north, lng: 0 }, zoom).y;
    let zoom = 18;
    while (zoom > 3 && (spanX(zoom) > width - padding.left - padding.right || spanY(zoom) > height - padding.top - padding.bottom)) zoom -= 0.25;
    const centreX = (project({ lat: 0, lng: bounds.west }, zoom).x + project({ lat: 0, lng: bounds.east }, zoom).x) / 2 - (padding.right - padding.left) / 2;
    const centreY = (project({ lat: bounds.north, lng: 0 }, zoom).y + project({ lat: bounds.south, lng: 0 }, zoom).y) / 2 + (padding.bottom - padding.top) / 2;
    this.set({ zoom, center: unproject(centreX, centreY, zoom) });
  }
  toScreen(point: LatLng) {
    const { center, zoom, width, height } = this.camera;
    const a = project(point, zoom);
    const c = project(center, zoom);
    return { x: a.x - c.x + width / 2, y: a.y - c.y + height / 2 };
  }
}

function unproject(x: number, y: number, zoom: number): LatLng {
  const scale = TILE * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng };
}

const map = new SyntheticMap();
const MapContext = createContext<SyntheticMap | null>(null);

// ── google.maps.Polyline, as the real DirectionsRoute calls it ──────────────
const polylines = new Set<ObservedPolyline>();
const polylineListeners = new Set<() => void>();
let polylineRevision = 0;
const notifyPolylines = () => { polylineRevision += 1; polylineListeners.forEach(listener => listener()); };
class ObservedPolyline {
  options: { path: LatLng[]; strokeColor: string; strokeWeight: number; strokeOpacity?: number; zIndex?: number };
  constructor(options: ObservedPolyline["options"] & { map?: unknown }) {
    this.options = options;
    polylines.add(this);
    notifyPolylines();
  }
  setMap(value: unknown) { if (value === null) { polylines.delete(this); notifyPolylines(); } }
}
Object.assign(globalThis, { google: { maps: { Polyline: ObservedPolyline } } });

function useCamera() {
  return useSyncExternalStore(map.subscribe, map.snapshot);
}

export function APIProvider({ children }: { children: ReactNode }) { return <>{children}</>; }
export function useMap() { return useContext(MapContext); }

// Streets and places around the demo corridor, for orientation only.
const STREETS: { path: LatLng[]; major?: boolean; highway?: boolean }[] = [
  { highway: true, path: [{ lat: 23.0727, lng: 72.5240 }, { lat: 23.0527, lng: 72.5183 }, { lat: 23.0486, lng: 72.5167 }, { lat: 23.0422, lng: 72.5137 }, { lat: 23.0300, lng: 72.5085 }] },
  { major: true, path: [{ lat: 23.0390, lng: 72.5120 }, { lat: 23.0395, lng: 72.5300 }, { lat: 23.0398, lng: 72.5440 }] },
  { major: true, path: [{ lat: 23.0600, lng: 72.5420 }, { lat: 23.0452, lng: 72.5419 }, { lat: 23.0320, lng: 72.5400 }] },
  { major: true, path: [{ lat: 23.0560, lng: 72.5349 }, { lat: 23.0459, lng: 72.5349 }, { lat: 23.0330, lng: 72.5340 }] },
  { major: true, path: [{ lat: 23.0480, lng: 72.5530 }, { lat: 23.0389, lng: 72.5525 }, { lat: 23.0300, lng: 72.5520 }] },
];
const PLACES: { name: string; at: LatLng }[] = [
  { name: "THALTEJ", at: { lat: 23.0540, lng: 72.5060 } },
  { name: "BODAKDEV", at: { lat: 23.0420, lng: 72.5230 } },
  { name: "MEMNAGAR", at: { lat: 23.0520, lng: 72.5400 } },
  { name: "VASTRAPUR", at: { lat: 23.0400, lng: 72.5360 } },
  { name: "NAVRANGPURA", at: { lat: 23.0345, lng: 72.5570 } },
];
const PARKS: { at: LatLng; rx: number; ry: number; water?: boolean; name?: string }[] = [
  { at: { lat: 23.0384, lng: 72.5289 }, rx: 260, ry: 170, water: true, name: "Vastrapur Lake" },
  { at: { lat: 23.0505, lng: 72.5290 }, rx: 180, ry: 120 },
  { at: { lat: 23.0440, lng: 72.5480 }, rx: 150, ry: 110 },
];

function Basemap() {
  const camera = useCamera();
  const metresPerPixel = (156543.03392 * Math.cos((camera.center.lat * Math.PI) / 180)) / 2 ** camera.zoom;
  const block = 140 / metresPerPixel;
  const origin = map.toScreen({ lat: 23.04, lng: 72.52 });
  const offsetX = ((origin.x % block) + block) % block;
  const offsetY = ((origin.y % block) + block) % block;
  const line = (path: LatLng[]) => path.map(point => { const { x, y } = map.toScreen(point); return `${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ");
  return <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }} aria-hidden="true">
    <defs>
      <pattern id="demo-blocks" width={block} height={block} patternUnits="userSpaceOnUse" x={offsetX} y={offsetY}>
        <rect width={block} height={block} fill="#f1eee9" />
        <rect x={block * 0.12} y={block * 0.12} width={block * 0.76} height={block * 0.76} rx={2} fill="#e9e5df" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#demo-blocks)" />
    {PARKS.map(park => { const { x, y } = map.toScreen(park.at); return <g key={`${park.at.lat}`}>
      <ellipse cx={x} cy={y} rx={park.rx / metresPerPixel} ry={park.ry / metresPerPixel} fill={park.water ? "#b9d3e8" : "#d4e5c9"} />
      {park.name && <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fontStyle="italic" fill="#5b7a93" fontFamily="Roboto, sans-serif">{park.name}</text>}
    </g>; })}
    {STREETS.map((street, index) => <g key={index}>
      <polyline points={line(street.path)} fill="none" stroke={street.highway ? "#e8c36a" : "#ffffff"} strokeWidth={street.highway ? 9 : street.major ? 7 : 4} strokeLinecap="round" strokeLinejoin="round" />
      {street.highway && <polyline points={line(street.path)} fill="none" stroke="#f3d98f" strokeWidth={5} strokeLinecap="round" />}
    </g>)}
    {PLACES.map(place => { const { x, y } = map.toScreen(place.at); return <text key={place.name} x={x} y={y} textAnchor="middle" fontSize={11} letterSpacing={2} fill="#8a8580" fontFamily="Roboto, sans-serif">{place.name}</text>; })}
  </svg>;
}

function Polylines() {
  useCamera();
  useSyncExternalStore(listener => { polylineListeners.add(listener); return () => { polylineListeners.delete(listener); }; }, () => polylineRevision);
  return <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true" data-road-overlays>
    {[...polylines].sort((a, b) => (a.options.zIndex ?? 0) - (b.options.zIndex ?? 0)).map((polyline, index) =>
      <polyline key={index} data-road-color={polyline.options.strokeColor}
        points={polyline.options.path.map(point => { const { x, y } = map.toScreen(point); return `${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ")}
        fill="none" stroke={polyline.options.strokeColor} strokeOpacity={polyline.options.strokeOpacity ?? 1}
        strokeWidth={polyline.options.strokeWeight} strokeLinecap="round" strokeLinejoin="round" />)}
  </svg>;
}

export function Map({ children, defaultCenter, defaultZoom }: { children?: ReactNode; defaultCenter?: LatLng; defaultZoom?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    map.div = element;
    if (defaultCenter) map.panTo(defaultCenter);
    if (defaultZoom) map.setZoom(defaultZoom);
    const measure = () => map.resize(element.clientWidth, element.clientHeight);
    measure();
    setReady(true);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // The camera starts where the first mount asks; later moves come from MapCenterer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={ref} aria-label="Synthetic map" style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#f1eee9" }}>
    <Basemap />
    <Polylines />
    <MapContext.Provider value={map}>{ready && children}</MapContext.Provider>
  </div>;
}

export function AdvancedMarker({ children, position, zIndex = 30 }: { children: ReactNode; position: LatLng; zIndex?: number }) {
  useCamera();
  const { x, y } = map.toScreen(position);
  return <div data-position-marker="true" style={{ position: "absolute", left: x, top: y, transform: "translate(-50%, -50%)", zIndex }}>{children}</div>;
}
