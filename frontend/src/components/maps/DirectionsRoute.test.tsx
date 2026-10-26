// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DirectionsRoute from "./DirectionsRoute";
interface ObservedLine { options: google.maps.PolylineOptions; map: google.maps.Map | null | undefined }
const state = vi.hoisted(() => ({ request: vi.fn(), map: null as unknown, lines: [] as ObservedLine[] }));
vi.mock("@vis.gl/react-google-maps", () => ({ useMap: () => state.map }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: { currentUser: { getIdToken: async () => "token" } } }));
vi.mock("@/lib/apiClient", () => ({ apiRequest: state.request }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); state.map = null; state.lines = []; });
it("shows all upcoming road blue, then keeps only confirmed grey road when a detour replaces it", () => {
  state.map = {};
  vi.stubGlobal("google", { maps: { Polyline: class {
    constructor(options: google.maps.PolylineOptions) { Object.assign(this, { options, map: options.map }); state.lines.push(this as unknown as ObservedLine); }
    setMap(map: google.maps.Map | null) { Object.assign(this, { map }); }
  } } });
  const stops = [{ lat: 23, lng: 72 }, { lat: 23.01, lng: 72.01 }, { lat: 23.02, lng: 72.02 }];
  const props = { stops, polyline: "_ekkC_omvLo}@o}@o}@o}@", direction: "forward" as const, progressContext: "session:one" };
  const view = render(<DirectionsRoute {...props} nextStopIndices={[1]} progressDistanceM={500} />);
  const visible = () => state.lines.filter(line => line.map);
  expect(visible().some(line => line.options.strokeColor === "#22c55e")).toBe(false);
  expect(visible().find(line => line.options.zIndex === 21)?.options.strokeColor).toBe("#3b82f6");
  const covered = visible().find(line => line.options.strokeColor === "#71717a")?.options.path;
  expect(covered).toHaveLength(2);
  // A confidence/quality gap must not erase a previously confirmed partial leg.
  for (const unavailable of [undefined, NaN, Infinity, -1, 1e9]) {
    view.rerender(<DirectionsRoute {...props} nextStopIndices={[1]} progressDistanceM={unavailable} />);
    expect(visible().find(line => line.options.strokeColor === "#71717a")?.options.path).toEqual(covered);
    view.rerender(<DirectionsRoute {...props} nextStopIndices={[]} completedStopIndex={1} hideRemaining />);
    expect(visible()).toHaveLength(1);
    expect(visible()[0].options.strokeColor).toBe("#71717a");
    expect(visible()[0].options.path).toEqual(covered);
  }
  // Authoritative next-stop changes still replace retained partial-leg paint.
  view.rerender(<DirectionsRoute {...props} nextStopIndices={[2]} />);
  view.rerender(<DirectionsRoute {...props} nextStopIndices={[]} completedStopIndex={2} hideRemaining />);
  expect(visible()[0].options.path).toEqual(stops.slice(0, 2));
  view.rerender(<DirectionsRoute {...props} nextStopIndices={[1]} progressDistanceM={500} />);
  // Neither a new session nor changed geometry may inherit old partial progress.
  view.rerender(<DirectionsRoute {...props} progressContext="session:two" nextStopIndices={[]} completedStopIndex={1} hideRemaining />);
  expect(visible()).toHaveLength(0);
  view.rerender(<DirectionsRoute {...props} nextStopIndices={[1]} progressDistanceM={500} />);
  expect(visible().filter(line => line.options.strokeColor === "#71717a")).toHaveLength(1);
  view.rerender(<DirectionsRoute {...props} polyline="_ekkC_omvLgEgEgEgE" nextStopIndices={[]} completedStopIndex={1} hideRemaining />);
  expect(visible()).toHaveLength(0);
  view.unmount(); vi.unstubAllGlobals();
});
it("reports unavailable geometry, then publishes authenticated repaired road geometry", async () => {
  state.request.mockResolvedValue({ forwardPolyline: "_ekkC_omvLo}@o}@" });
  const ready = vi.fn();
  render(<DirectionsRoute routeId="repair" stops={[]} direction="forward" onGeometryReady={ready} />);
  expect(ready).toHaveBeenCalledWith([]);
  await waitFor(() => expect(ready).toHaveBeenLastCalledWith([
    { lat: 23, lng: 72 }, { lat: 23.01, lng: 72.01 },
  ]));
  expect(state.request).toHaveBeenCalledWith("/api/routes/repair/geometry", expect.objectContaining({
    headers: { Authorization: "Bearer token" },
  }));
});

it("keeps future road blue and paints only covered road grey", () => {
  state.map = {};
  vi.stubGlobal("google", { maps: { Polyline: class {
    options: google.maps.PolylineOptions; map: google.maps.Map | null | undefined;
    constructor(options: google.maps.PolylineOptions) { this.options = options; this.map = options.map; state.lines.push(this); }
    setMap(map: google.maps.Map | null) { this.map = map; }
  } } });
  const stops = [{ lat: 23, lng: 72 }, { lat: 23.01, lng: 72.01 }, { lat: 23.02, lng: 72.02 }];
  const props = { routeId: "stored", stops, color: "#ec4899", polyline: "_ekkC_omvLo}@o}@o}@o}@", polylineQuality: "HIGH_QUALITY" as const, direction: "forward" as const };
  const view = render(<DirectionsRoute {...props} nextStopIndices={[1]} />);
  const active = () => state.lines.filter(line => line.map && line.options.strokeColor === "#3b82f6" && line.options.zIndex === 23);
  const grey = () => state.lines.filter(line => line.map && line.options.strokeColor === "#71717a");
  expect(grey()).toHaveLength(0);
  expect(state.lines.filter(line => line.map && line.options.zIndex === 21)[0].options.path).toEqual(stops);
  expect(state.lines.find(line => line.map && line.options.zIndex === 21)?.options.strokeColor).toBe("#3b82f6");
  expect(active()[0].options.path).toEqual(stops.slice(0, 2));
  const count = state.lines.length;
  view.rerender(<DirectionsRoute {...props} nextStopIndices={[1, 1]} />);
  expect(state.lines).toHaveLength(count); // ordinary telemetry ticks do no Maps work
  view.rerender(<DirectionsRoute {...props} nextStopIndices={[2]} />);
  expect(grey()[0].options.path).toEqual(stops.slice(0, 2));
  expect(active()).toHaveLength(1);
  expect(active()[0].options.path).toEqual(stops.slice(1));
  view.rerender(<DirectionsRoute {...props} nextStopIndices={[1, 2]} />);
  expect(active()).toHaveLength(2); // fleet view preserves both buses' own legs
  expect(grey()).toHaveLength(0); // there is no single fleet-wide completed distance
  view.rerender(<DirectionsRoute {...props} nextStopIndices={[]} />);
  expect(active()).toHaveLength(0);
  expect(grey()).toHaveLength(0);
  expect(state.lines.filter(line => line.map && line.options.strokeColor === props.color)).toHaveLength(0);
  view.rerender(<DirectionsRoute {...props} nextStopIndices={[]} completedStopIndex={2} />);
  expect(grey()[0].options.path).toEqual(stops.slice(0, 2));
  expect(active()).toHaveLength(0); // active road belongs to the separately rendered dynamic geometry
  view.rerender(<DirectionsRoute {...props} />);
  expect(grey()).toHaveLength(0);
  expect(state.lines.filter(line => line.map && line.options.strokeColor === props.color)).toHaveLength(1);
  view.rerender(<DirectionsRoute {...props} color="#22c55e" />);
  expect(state.lines.filter(line => line.map && line.options.strokeColor === "#22c55e")).toHaveLength(1);
  expect(state.lines.filter(line => line.map && line.options.strokeColor === props.color)).toHaveLength(0);
  expect(state.request).not.toHaveBeenCalled();
  view.unmount();
  expect(state.lines.filter(line => line.map)).toHaveLength(0);
  vi.unstubAllGlobals();
});

it.each([[], [-1], [1.5], [3], [Number.MAX_SAFE_INTEGER]].map(indices => ({ indices })))("does not claim covered road or an active leg without valid progress for $indices", ({ indices: nextStopIndices }) => {
  state.map = {};
  vi.stubGlobal("google", { maps: { Polyline: class {
    constructor(options: google.maps.PolylineOptions) { Object.assign(this, { options, map: options.map }); state.lines.push(this as unknown as ObservedLine); }
    setMap(map: google.maps.Map | null) { Object.assign(this, { map }); }
  } } });
  render(<DirectionsRoute stops={[{ lat: 23, lng: 72 }, { lat: 23.01, lng: 72.01 }, { lat: 23.02, lng: 72.02 }]} polyline="_ekkC_omvLo}@o}@o}@o}@" direction="forward" color="#3b82f6" nextStopIndices={nextStopIndices} hasBuses />);
  expect(state.lines.filter(line => line.map && line.options.strokeColor === "#71717a")).toHaveLength(0);
  expect(state.lines.filter(line => line.map && line.options.strokeColor === "#22c55e")).toHaveLength(0);
  expect(state.lines.filter(line => line.map && line.options.strokeColor === "#3b82f6")).toHaveLength(1);
  expect(state.request).not.toHaveBeenCalled();
  cleanup(); vi.unstubAllGlobals();
});
it("keeps failed or corrupt repair unavailable", async () => {
  state.request.mockResolvedValue({ reversePolyline: "~" });
  const ready = vi.fn();
  render(<DirectionsRoute routeId="corrupt" stops={[{lat: 23, lng: 72}]} direction="reverse" onGeometryReady={ready} />);
  await waitFor(() => expect(state.request).toHaveBeenCalled());
  expect(ready).toHaveBeenLastCalledWith([]);
});
it("replaces a repaired fallback when the route later publishes trusted road geometry", async () => {
  state.request.mockResolvedValue({ forwardPolyline: "_ekkC_omvLo}@o}@" });
  const ready = vi.fn();
  const stops = [{ lat: 23, lng: 72 }, { lat: 23.02, lng: 72.02 }];
  const view = render(<DirectionsRoute routeId="edited" stops={stops} direction="forward" onGeometryReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenLastCalledWith([{ lat: 23, lng: 72 }, { lat: 23.01, lng: 72.01 }]));
  view.rerender(<DirectionsRoute routeId="edited" stops={stops} direction="forward" onGeometryReady={ready}
    polyline="_ekkC_omvLo}@o}@o}@o}@" polylineQuality="HIGH_QUALITY" />);
  expect(ready).toHaveBeenLastCalledWith([{ lat: 23, lng: 72 }, { lat: 23.01, lng: 72.01 }, { lat: 23.02, lng: 72.02 }]);
});
