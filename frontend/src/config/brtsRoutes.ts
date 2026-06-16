export interface BRTSStop {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lng: number;
}

export interface BRTSRoute {
  id: string;
  name: string;
  color: string;
  stops: BRTSStop[];
  waypoints: { lat: number; lng: number }[];
}

export const SIMULATION_SPEED_MS = 1600;
export const REROUTE_DEVIATION_METERS = 55;

export const BRTS_ROUTES: BRTSRoute[] = [
  {
    id: 'route-navrangpura-1',
    name: 'Ring Road → Navrangpura',
    color: '#4285F4',
    stops: [
      {
        id: 'stop-b',
        name: 'Amdavad Ni Gufa Bus Stop, 132 Feet Ring Road',
        shortName: 'Ring Road - Stop B',
        lat: 23.0352,
        lng: 72.5413,
      },
      {
        id: 'stop-a',
        name: "St. Xavier's College, Navrangpura",
        shortName: 'Navrangpura - Stop A',
        lat: 23.0372,
        lng: 72.5560,
      },
    ],
    waypoints: [
      { "lat": 23.03521, "lng": 72.54136 },
      { "lat": 23.0349,  "lng": 72.54142 },
      { "lat": 23.03459, "lng": 72.54145 },
      { "lat": 23.03472, "lng": 72.54193 },
      { "lat": 23.035,   "lng": 72.54294 },
      { "lat": 23.0351,  "lng": 72.54328 },
      { "lat": 23.03532, "lng": 72.5443 },
      { "lat": 23.03537, "lng": 72.54502 },
      { "lat": 23.03559, "lng": 72.54729 },
      { "lat": 23.03574, "lng": 72.54862 },
      { "lat": 23.03576, "lng": 72.54876 },
      { "lat": 23.03543, "lng": 72.54884 },
      { "lat": 23.03427, "lng": 72.54906 },
      { "lat": 23.03374, "lng": 72.5492 },
      { "lat": 23.03312, "lng": 72.54942 },
      { "lat": 23.03284, "lng": 72.54953 },
      { "lat": 23.03285, "lng": 72.54961 },
      { "lat": 23.03286, "lng": 72.54969 },
      { "lat": 23.03292, "lng": 72.54999 },
      { "lat": 23.03329, "lng": 72.55205 },
      { "lat": 23.03343, "lng": 72.55282 },
      { "lat": 23.03358, "lng": 72.55374 },
      { "lat": 23.03368, "lng": 72.55448 },
      { "lat": 23.03376, "lng": 72.55496 },
      { "lat": 23.03397, "lng": 72.55496 },
      { "lat": 23.03401, "lng": 72.55496 },
      { "lat": 23.03404, "lng": 72.55498 },
      { "lat": 23.0351,  "lng": 72.55493 },
      { "lat": 23.03561, "lng": 72.55493 },
      { "lat": 23.03636, "lng": 72.55489 },
      { "lat": 23.03659, "lng": 72.55486 },
      { "lat": 23.03671, "lng": 72.55482 },
      { "lat": 23.03677, "lng": 72.55481 },
      { "lat": 23.0368,  "lng": 72.5548 },
      { "lat": 23.03679, "lng": 72.55484 },
      { "lat": 23.03678, "lng": 72.55514 },
      { "lat": 23.03677, "lng": 72.55535 },
      { "lat": 23.03681, "lng": 72.55598 }
    ],
  },
];
