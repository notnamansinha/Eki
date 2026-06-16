export interface UniStop {
  id: string;
  name: string;        // Human-readable stop name e.g. "St. Xavier's College, Navrangpura"
  shortName: string;   // Short name for UI e.g. "Navrangpura Stop A"
  lat: number;
  lng: number;
}

export interface UniRoute {
  id: string;
  name: string;
  stops: UniStop[];  // Ordered list of stops along the route
  waypoints: { lat: number; lng: number }[];  // Dense waypoints for smooth simulation
}

export const SIMULATION_SPEED_MS = 1800;

// Coordinates from Point B (Nehrunagar Depot) to Point A (St. Xavier's College, Navrangpura)
// Path: Satellite Rd -> 132 Feet Ring Rd -> Ambawadi -> C.G. Road -> Navrangpura
const WAYPOINTS_B_TO_A = [
  { lat: 23.02740, lng: 72.54220 }, // Point B: Near GSRTC Bus Stop, Nehrunagar
  { lat: 23.02685, lng: 72.54270 }, // 132 Ft Ring Rd Turn
  { lat: 23.02490, lng: 72.54460 }, // Panjrapole Cross Road
  { lat: 23.02325, lng: 72.54710 }, // Ambawadi Circle
  { lat: 23.02400, lng: 72.55100 }, // Parimal Garden approach
  { lat: 23.02630, lng: 72.55390 }, // Enter C.G. Road South
  { lat: 23.02950, lng: 72.55550 }, // C.G. Road mid
  { lat: 23.03310, lng: 72.55620 }, // Swastik Cross Road
  { lat: 23.03600, lng: 72.55660 }, // Navrangpura
  { lat: 23.03810, lng: 72.55690 }, // Navrangpura Char Rasta
  { lat: 23.03950, lng: 72.55710 }, // Point A: St. Xavier's College, Navrangpura
];

export const UNI_ROUTES: UniRoute[] = [
  {
    id: "route-uni-1",
    name: "Nehrunagar Depot to Navrangpura",
    stops: [
      {
        id: "stop-b",
        name: "GSRTC Bus Stop, Nehrunagar",
        shortName: "Nehrunagar Depot",
        lat: 23.02740,
        lng: 72.54220,
      },
      {
        id: "stop-a",
        name: "St. Xavier's College, Navrangpura",
        shortName: "Navrangpura Stop A",
        lat: 23.03950,
        lng: 72.55710,
      },
    ],
    waypoints: WAYPOINTS_B_TO_A,
  },
];
