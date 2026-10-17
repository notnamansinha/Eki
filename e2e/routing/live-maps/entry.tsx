import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { useApiIsLoaded, useMapsLibrary } from "@vis.gl/react-google-maps";
import MapProviders from "@/components/MapProviders";
import PassengerMap from "@/components/maps/PassengerMap";
import DashboardPanel from "@/components/admin/DashboardPanel";
import { routeInRideDirection } from "@/lib/rideDirection";
import { getDistanceMeters } from "@/lib/mapUtils";
import { route, publish, paths, useSimulation } from "./store";
import "./style.css";

// Observe the real SDK objects created by the unchanged application components.
// No Maps API, map, polyline, marker, selector or animation is mocked.
function MapsReady({ children }: { children: ReactNode }) {
  const loaded = useApiIsLoaded(), maps = useMapsLibrary("maps"), marker = useMapsLibrary("marker");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!loaded || !maps || !marker) return;
    const lines: google.maps.Polyline[] = [], markers: google.maps.marker.AdvancedMarkerElement[] = [];
    const loadedMaps = new Map<google.maps.Map, { tilesLoaded: boolean; tileLoads: number }>();
    const OriginalLine = google.maps.Polyline, OriginalMarker = google.maps.marker.AdvancedMarkerElement;
    google.maps.Polyline = class extends OriginalLine { constructor(options?: google.maps.PolylineOptions) {
      super(options); lines.push(this);
      const map = options?.map;
      if (map instanceof google.maps.Map && !loadedMaps.has(map)) {
        const state = { tilesLoaded: false, tileLoads: 0 }; loadedMaps.set(map, state);
        google.maps.event.addListener(map, "tilesloaded", () => { state.tilesLoaded = true; state.tileLoads++; });
      }
    } };
    // importLibrary returns a frozen exports object. Observe the real marker's
    // public position setter rather than replacing that module's constructor.
    const positionDescriptor = Object.getOwnPropertyDescriptor(OriginalMarker.prototype, "position")!;
    Object.defineProperty(OriginalMarker.prototype, "position", { ...positionDescriptor,
      set(this: google.maps.marker.AdvancedMarkerElement, value: unknown) {
        if (!markers.includes(this)) markers.push(this);
        positionDescriptor.set!.call(this, value);
      },
    });
    (window as any).__ekiInAppMaps = { snapshot: () => ({
      sdkLoaded: true, observedMarkerCount: markers.length, observedPolylineCount: lines.length,
      maps: [...loadedMaps].filter(([map]) => document.contains(map.getDiv())).map(([map, state]) => ({
        view: map.getDiv().closest("section")?.getAttribute("aria-label"), tilesLoaded: state.tilesLoaded, tileLoads: state.tileLoads,
        renderingType: map.getRenderingType(), zoom: map.getZoom(),
      })),
      lines: lines.filter(line => line.getMap()).map(line => ({ view: (line.getMap() as google.maps.Map).getDiv().closest("section")?.getAttribute("aria-label"), color: line.get("strokeColor"), path: line.getPath().getArray().map(point => point.toJSON()) })),
      markers: markers.filter(item => item.map).map(item => {
        const map = item.map as google.maps.Map, div = map.getDiv(), bounds = div.getBoundingClientRect();
        const position = item.position ? { lat: typeof item.position.lat === "function" ? item.position.lat() : item.position.lat,
          lng: typeof item.position.lng === "function" ? item.position.lng() : item.position.lng } : null;
        const content = item.content as HTMLElement | null;
        const labelled = content?.querySelector<HTMLElement>("[title]") ?? content;
        const glyph = labelled?.firstElementChild?.getBoundingClientRect();
        const projection = map.getProjection(), center = map.getCenter();
        const world = position && projection?.fromLatLngToPoint(position);
        const worldCenter = center && projection?.fromLatLngToPoint(center);
        const scale = 2 ** (map.getZoom() ?? 0);
        const visualOffsetPx = glyph && world && worldCenter ? Math.hypot(
          glyph.x + glyph.width / 2 - (bounds.x + div.clientWidth / 2 + (world.x - worldCenter.x) * scale),
          glyph.y + glyph.height / 2 - (bounds.y + div.clientHeight / 2 + (world.y - worldCenter.y) * scale),
        ) : null;
        return { position, view: div.closest("section")?.getAttribute("aria-label"),
          title: labelled?.getAttribute("title") ?? "", visualOffsetPx,
          anchorLeft: item.anchorLeft, anchorTop: item.anchorTop };
      }),
    }) };
    setReady(true);
    return () => { google.maps.Polyline = OriginalLine; Object.defineProperty(OriginalMarker.prototype, "position", positionDescriptor); };
  }, [loaded, maps, marker]);
  return ready ? children : <p role="status">Loading the real Google Maps JavaScript API…</p>;
}
function App() {
  const state = useSimulation(), directed = routeInRideDirection(route, state.direction);
  const [playing, setPlaying] = useState(false);
  const reachNextStop = () => {
    setPlaying(false);
    const reached = Math.max(1, state.bus.currentStopIndex ?? 1);
    const stop = directed.stops[reached], path = paths[state.direction];
    const index = path.reduce((best, point, candidate) => getDistanceMeters(point, stop) < getDistanceMeters(path[best], stop) ? candidate : best, 0);
    publish(state.direction, index, true, undefined, Math.min(reached + 1, directed.stops.length - 1));
  };
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => publish(state.direction, Math.min(state.index + 1, paths[state.direction].length - 1)), 1000);
    return () => clearInterval(timer);
  }, [playing, state.direction, state.index]);
  return <><header className="replay-toolbar"><h1>Eki · in-app Google Maps replay</h1>
    <p>Real passenger and Live Ops components + Google Maps SDK. Only bus/store inputs are simulated.</p>
    <nav><button onClick={() => { setPlaying(false); publish("forward", 20); }}>A → B</button>
      <button onClick={() => { setPlaying(false); publish("reverse", 20); }}>B → A</button>
      <button onClick={() => setPlaying(value => !value)}>{playing ? "Pause replay" : "Play simulated GNSS"}</button>
      <button onClick={() => publish(state.direction, Math.min(state.index + 1, paths[state.direction].length - 1))}>Next fix</button>
      <button onClick={reachNextStop}>Reach next stop</button>
      <button onClick={() => { setPlaying(false); publish(state.direction, state.index, false); }}>Low-confidence fix</button>
      <button onClick={() => publish(state.direction, Math.min(state.index + 10, paths[state.direction].length - 1), true, 1)}>Delayed old revision</button></nav>
    <output data-testid="simulation-state">{state.direction} · fix {state.bus.seq} · route v{state.bus.routeVersion}</output>
  </header><MapProviders><MapsReady><main className="replay-grid">
    <section aria-label="Eki passenger map"><h2>PassengerMap</h2><div className="replay-pane">
      <MapProviders><PassengerMap route={directed} targetStop={directed.stops.at(-1)!} selectedBusKey={`session:simulated-${state.direction}`} /></MapProviders>
    </div></section>
    <section aria-label="Eki admin map"><h2>DashboardPanel · Live Ops</h2><div className="replay-pane"><MapProviders><DashboardPanel /></MapProviders></div></section>
  </main></MapsReady></MapProviders></>;
}
createRoot(document.getElementById("root")!).render(<App />);
