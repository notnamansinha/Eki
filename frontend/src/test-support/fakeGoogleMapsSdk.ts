// Test-only fake of the Google Maps JS SDK boundary. Never import from app code.
//
// The REAL @vis.gl/react-google-maps APIProvider/Map run against it: the
// library's bootstrap appends <script src="https://maps.googleapis.com/maps/api/js?...">,
// the interceptor installs this namespace and calls the pending callback, so
// `mapsConstructed` counts the exact `new google.maps.Map(...)` calls vis.gl
// makes. These are constructions, not Google billing evidence (OBS07).
import { expect } from "vitest";

export const sdkCounters = { mapsConstructed: 0, mapsReused: 0, mapsTornDown: 0, scriptLoads: 0 };

type LatLngLiteral = { lat: number; lng: number };
type Handler = (...args: unknown[]) => void;
export interface FakeMapsEventListener { remove(): void }
export interface OptionsEntry { options: Record<string, unknown>; reuse: boolean; seq: number }

// One ordering clock for options, camera and fit calls across all instances.
let seq = 0;
let nextMapId = 1;
let nextListenerToken = 1;
const maps: FakeMap[] = [];
const overlays: FakeOverlay[] = [];

class FakeLatLng {
  constructor(private readonly value: LatLngLiteral) {}
  lat() { return this.value.lat; }
  lng() { return this.value.lng; }
  toJSON() { return this.value; }
}

function toLiteral(position: LatLngLiteral | FakeLatLng): LatLngLiteral {
  return position instanceof FakeLatLng ? position.toJSON() : { lat: position.lat, lng: position.lng };
}

export class FakeMap {
  readonly id = nextMapId++;
  readonly listeners = new Map<number, { event: string; handler: Handler; once: boolean }>();
  readonly optionsHistory: OptionsEntry[] = [];
  readonly fitBoundsCalls: { bounds: unknown; padding: unknown; seq: number }[] = [];
  readonly panToCalls: (LatLngLiteral & { seq: number })[] = [];
  readonly setZoomCalls: { zoom: number; seq: number }[] = [];
  private lastParent: Element | null;
  private center = new FakeLatLng({ lat: 23, lng: 72 });
  private zoom = 15;

  constructor(private readonly div: HTMLElement, options: Record<string, unknown> = {}) {
    sdkCounters.mapsConstructed++;
    // vis.gl appends the div to its container before constructing the map.
    this.lastParent = div.parentElement;
    this.optionsHistory.push({ options: { ...options }, reuse: false, seq: ++seq });
    this.applyCamera(options);
    maps.push(this);
  }

  /**
   * vis.gl reattaches a cached map by moving its div into the new <Map>
   * container and calling setOptions, so a parent change counts exactly one
   * reuse. Option updates, GPS ticks and unmount cleanups (detached div) do not.
   */
  setOptions(options: Record<string, unknown>) {
    const parent = this.div.parentElement;
    const reuse = parent !== null && parent !== this.lastParent;
    if (reuse) {
      sdkCounters.mapsReused++;
      this.lastParent = parent;
    }
    this.optionsHistory.push({ options: { ...options }, reuse, seq: ++seq });
    this.applyCamera(options);
  }

  private applyCamera(options: Record<string, unknown>) {
    if (options.center) this.center = new FakeLatLng(toLiteral(options.center as LatLngLiteral));
    if (typeof options.zoom === "number") this.zoom = options.zoom;
  }

  getDiv() { return this.div; }
  moveCamera(camera: Record<string, unknown>) { this.applyCamera(camera); }
  panTo(position: LatLngLiteral | FakeLatLng) {
    const literal = toLiteral(position);
    this.panToCalls.push({ ...literal, seq: ++seq });
    this.center = new FakeLatLng(literal);
  }
  setZoom(zoom: number) {
    this.setZoomCalls.push({ zoom, seq: ++seq });
    this.zoom = zoom;
  }
  fitBounds(bounds: unknown, padding?: unknown) { this.fitBoundsCalls.push({ bounds, padding, seq: ++seq }); }
  panBy() {}
  getCenter() { return this.center; }
  getZoom() { return this.zoom; }
  getHeading() { return 0; }
  getTilt() { return 0; }
  getBounds() { return { toJSON: () => ({ north: 1, south: 0, east: 1, west: 0 }) }; }
  getProjection() { return undefined; }
  getRenderingType() { return "RASTER"; }
  addListener(event: string, handler: Handler) { return addListener(this, event, handler); }
  get(key: string) { void key; return undefined; }
  set() {}
}

export class FakeOverlay {
  readonly setMapHistory: (FakeMap | null)[] = [];
  private map: FakeMap | null = null;

  constructor(readonly kind: "Polyline" | "TrafficLayer", options: { map?: FakeMap | null } = {}) {
    if (options.map) {
      this.map = options.map;
      this.setMapHistory.push(options.map);
    }
    overlays.push(this);
  }

  setMap(map: FakeMap | null | undefined) {
    this.map = map ?? null;
    this.setMapHistory.push(this.map);
  }
  getMap() { return this.map; }
  setOptions() {}
  setPath() {}
  get(key: string) { void key; return undefined; }
}

class FakePolyline extends FakeOverlay {
  constructor(options: { map?: FakeMap | null } = {}) { super("Polyline", options); }
}

class FakeTrafficLayer extends FakeOverlay {
  constructor(options: { map?: FakeMap | null } = {}) { super("TrafficLayer", options); }
}

function addListener(target: unknown, event: string, handler: Handler, once = false): FakeMapsEventListener {
  if (!(target instanceof FakeMap)) return { remove() {} };
  const token = nextListenerToken++;
  target.listeners.set(token, { event, handler, once });
  return { remove: () => { target.listeners.delete(token); } };
}

const event = {
  addListener: (target: unknown, name: string, handler: Handler) => addListener(target, name, handler),
  addListenerOnce: (target: unknown, name: string, handler: Handler) => addListener(target, name, handler, true),
  trigger(target: unknown, name: string, ...args: unknown[]) {
    if (!(target instanceof FakeMap)) return;
    for (const [token, entry] of [...target.listeners]) {
      if (entry.event !== name) continue;
      if (entry.once) target.listeners.delete(token);
      entry.handler(...args);
    }
  },
  clearInstanceListeners(target: unknown) {
    sdkCounters.mapsTornDown++;
    if (target instanceof FakeMap) target.listeners.clear();
  },
  removeListener(listener: FakeMapsEventListener | null | undefined) { listener?.remove(); },
};

function installNamespace() {
  const g = globalThis as unknown as { google: { maps: Record<string, unknown> } };
  g.google ??= { maps: {} };
  g.google.maps ??= {};
  Object.assign(g.google.maps, {
    Map: FakeMap,
    Polyline: FakePolyline,
    TrafficLayer: FakeTrafficLayer,
    LatLng: FakeLatLng,
    // Read by the vis.gl APIProvider for usage attribution.
    Settings: { getInstance: () => ({}) },
    event,
    importLibrary: async () => ({ Map: FakeMap, Polyline: FakePolyline, TrafficLayer: FakeTrafficLayer }),
  });
}

/**
 * Leave `google.maps.importLibrary` undefined so the library's real bootstrap
 * runs and appends the Maps script. Intercept that append, install the fake
 * namespace, then invoke the bootstrap callback exactly like the real script.
 * Returns the uninstall function.
 */
export function installScriptInterceptingFakeSdk() {
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof HTMLScriptElement && node.src.includes("maps.googleapis.com/maps/api/js")) {
        sdkCounters.scriptLoads++;
        const pending = (globalThis as unknown as { google: { maps: { __ib__?: () => void } } }).google.maps.__ib__;
        installNamespace();
        pending?.();
      }
    }
  });
  observer.observe(document.head, { childList: true });
  return () => observer.disconnect();
}

export const allMaps = (): readonly FakeMap[] => maps;
export const lastMap = (): FakeMap | undefined => maps.at(-1);
export const allOverlays = (): readonly FakeOverlay[] => overlays;
export function snapshotCounters() { return { ...sdkCounters }; }
export type CounterSnapshot = ReturnType<typeof snapshotCounters>;

/** Clears counters only; vis.gl's private CachedMapStack lives until the module is reloaded. */
export function resetFakeGoogleMapsCounters() {
  sdkCounters.mapsConstructed = 0;
  sdkCounters.mapsReused = 0;
  sdkCounters.mapsTornDown = 0;
  sdkCounters.scriptLoads = 0;
}

/** The remount reattached `before` into `container` without constructing another map. */
export function expectReusedInto(before: FakeMap, beforeCounters: CounterSnapshot, container: Element | null) {
  expect(sdkCounters.mapsConstructed - beforeCounters.mapsConstructed).toBe(0);
  expect(sdkCounters.mapsReused - beforeCounters.mapsReused).toBe(1);
  expect(lastMap()).toBe(before);
  expect(before.getDiv().isConnected).toBe(true);
  expect(container).not.toBeNull();
  expect(container!.contains(before.getDiv())).toBe(true);
}

/** The options vis.gl applied when it last reattached this cached instance. */
export function reuseCall(map: FakeMap): OptionsEntry | undefined {
  return map.optionsHistory.filter(entry => entry.reuse).at(-1);
}
