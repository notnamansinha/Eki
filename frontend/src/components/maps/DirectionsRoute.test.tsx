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

it("keeps the whole road grey and advances only the blue leg without provider calls", () => {
  state.map = {};
  vi.stubGlobal("google", { maps: { Polyline: class {
    options: google.maps.PolylineOptions; map: google.maps.Map | null | undefined;
    constructor(options: google.maps.PolylineOptions) { this.options = options; this.map = options.map; state.lines.push(this); }
    setMap(map: google.maps.Map | null) { this.map = map; }
  } } });
  const stops = [{ lat: 23, lng: 72 }, { lat: 23.01, lng: 72.01 }, { lat: 23.02, lng: 72.02 }];
  const props = { routeId: "stored", stops, polyline: "_ekkC_omvLo}@o}@o}@o}@", polylineQuality: "HIGH_QUALITY" as const, direction: "forward" as const };
  const view = render(<DirectionsRoute {...props} nextStopIndices={[1]} />);
  const active = () => state.lines.filter(line => line.map && line.options.strokeColor === "#3b82f6");
  const grey = () => state.lines.filter(line => line.map && line.options.strokeColor === "#71717a");
  expect(grey()[0].options.path).toEqual(stops);
  expect(active()[0].options.path).toEqual(stops.slice(0, 2));
  const count = state.lines.length;
  view.rerender(<DirectionsRoute {...props} nextStopIndices={[1, 1]} />);
  expect(state.lines).toHaveLength(count); // ordinary telemetry ticks do no Maps work
  view.rerender(<DirectionsRoute {...props} nextStopIndices={[2]} />);
  expect(active()).toHaveLength(1);
  expect(active()[0].options.path).toEqual(stops.slice(1));
  view.rerender(<DirectionsRoute {...props} nextStopIndices={[1, 2]} />);
  expect(active()).toHaveLength(2); // fleet view preserves both buses' own legs
  view.rerender(<DirectionsRoute {...props} nextStopIndices={[]} />);
  expect(active()).toHaveLength(0);
  expect(grey()).toHaveLength(1);
  expect(state.request).not.toHaveBeenCalled();
  view.unmount();
  expect(state.lines.filter(line => line.map)).toHaveLength(0);
  vi.unstubAllGlobals();
});
it("keeps failed or corrupt repair unavailable", async () => {
  state.request.mockResolvedValue({ reversePolyline: "~" });
  const ready = vi.fn();
  render(<DirectionsRoute routeId="corrupt" stops={[{lat: 23, lng: 72}]} direction="reverse" onGeometryReady={ready} />);
  await waitFor(() => expect(state.request).toHaveBeenCalled());
  expect(ready).toHaveBeenLastCalledWith([]);
});
