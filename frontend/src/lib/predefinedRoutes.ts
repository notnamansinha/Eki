export interface PredefinedRoute {
  id: string;
  name: string;
  /** [lng, lat] for each waypoint — OSRM format */
  waypoints: [number, number][];
  /** Default color for display */
  color: string;
}

/** A named, plannable stop along a BRTS route */
export interface PredefinedStop {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lng: number;
  /** 0-based index in the route's waypoints array — used for polyline slicing */
  waypointIndex: number;
}

export interface PredefinedRouteWithStops extends PredefinedRoute {
  stops: PredefinedStop[];
}

export const PREDEFINED_ROUTES: PredefinedRouteWithStops[] = [
  {
    id: "route_au_samras",
    name: "Ahmedabad University → Samras Boys Hostel",
    color: "#3b82f6",
    waypoints: [
      [72.5566, 23.0335], // 0 — Ahmedabad University
      [72.5510, 23.0339], // 1 — Commerce Six Roads
      [72.5450, 23.0345], // 2 — Vijay Cross Roads
      [72.5425, 23.0350], // 3 — Helmet Circle
      [72.5400, 23.0360], // 4 — Samras Boys Hostel
    ],
    stops: [
      { id: "au",    name: "Ahmedabad University",  shortName: "AU",   lat: 23.0335, lng: 72.5566, waypointIndex: 0 },
      { id: "csr",   name: "Commerce Six Roads",     shortName: "CSR",  lat: 23.0339, lng: 72.5510, waypointIndex: 1 },
      { id: "vcr",   name: "Vijay Cross Roads",      shortName: "VCR",  lat: 23.0345, lng: 72.5450, waypointIndex: 2 },
      { id: "hc",    name: "Helmet Circle",           shortName: "HC",   lat: 23.0350, lng: 72.5425, waypointIndex: 3 },
      { id: "sbh",   name: "Samras Boys Hostel",     shortName: "SBH",  lat: 23.0360, lng: 72.5400, waypointIndex: 4 },
    ],
  },
  {
    id: "route_au_iim",
    name: "Ahmedabad University → IIM Ahmedabad",
    color: "#10b981",
    waypoints: [
      [72.5566, 23.0335], // 0 — Ahmedabad University
      [72.5501, 23.0371], // 1 — Navrangpura
      [72.5413, 23.0354], // 2 — Gujarat University
      [72.5356, 23.0298], // 3 — Panjrapole
      [72.5312, 23.0333], // 4 — ATIRA
      [72.5270, 23.0270], // 5 — IIM Ahmedabad
    ],
    stops: [
      { id: "au",   name: "Ahmedabad University", shortName: "AU",  lat: 23.0335, lng: 72.5566, waypointIndex: 0 },
      { id: "nvp",  name: "Navrangpura",           shortName: "NVP", lat: 23.0371, lng: 72.5501, waypointIndex: 1 },
      { id: "gu",   name: "Gujarat University",    shortName: "GU",  lat: 23.0354, lng: 72.5413, waypointIndex: 2 },
      { id: "pnj",  name: "Panjrapole",            shortName: "PNJ", lat: 23.0298, lng: 72.5356, waypointIndex: 3 },
      { id: "atr",  name: "ATIRA",                 shortName: "ATR", lat: 23.0333, lng: 72.5312, waypointIndex: 4 },
      { id: "iim",  name: "IIM Ahmedabad",         shortName: "IIM", lat: 23.0270, lng: 72.5270, waypointIndex: 5 },
    ],
  },
  {
    id: "route_rto_iskon",
    name: "RTO Circle → ISKCON Temple",
    color: "#f59e0b",
    waypoints: [
      [72.5715, 23.0645], // 0 — RTO Circle
      [72.5645, 23.0598], // 1 — Ranip
      [72.5596, 23.0487], // 2 — Wadaj
      [72.5623, 23.0401], // 3 — Usmanpura
      [72.5446, 23.0185], // 4 — Nehrunagar
      [72.5298, 23.0201], // 5 — Shivranjani
      [72.5080, 23.0300], // 6 — ISKCON Temple
    ],
    stops: [
      { id: "rto",  name: "RTO Circle",    shortName: "RTO",  lat: 23.0645, lng: 72.5715, waypointIndex: 0 },
      { id: "rnp",  name: "Ranip",         shortName: "RNP",  lat: 23.0598, lng: 72.5645, waypointIndex: 1 },
      { id: "wdj",  name: "Wadaj",         shortName: "WDJ",  lat: 23.0487, lng: 72.5596, waypointIndex: 2 },
      { id: "usm",  name: "Usmanpura",     shortName: "USM",  lat: 23.0401, lng: 72.5623, waypointIndex: 3 },
      { id: "nhr",  name: "Nehrunagar",    shortName: "NHR",  lat: 23.0185, lng: 72.5446, waypointIndex: 4 },
      { id: "shv",  name: "Shivranjani",   shortName: "SHV",  lat: 23.0201, lng: 72.5298, waypointIndex: 5 },
      { id: "isk",  name: "ISKCON Temple", shortName: "ISK",  lat: 23.0300, lng: 72.5080, waypointIndex: 6 },
    ],
  },
  {
    id: "route_cg_rto",
    name: "CG Road → RTO Circle",
    color: "#8b5cf6",
    waypoints: [
      [72.5530, 23.0280], // 0 — CG Road
      [72.5560, 23.0330], // 1 — Swastik Char Rasta
      [72.5585, 23.0410], // 2 — Stadium Cross Road
      [72.5615, 23.0520], // 3 — Vadaj Terminus
      [72.5715, 23.0645], // 4 — RTO Circle
    ],
    stops: [
      { id: "cgr",  name: "CG Road",           shortName: "CGR", lat: 23.0280, lng: 72.5530, waypointIndex: 0 },
      { id: "scr",  name: "Swastik Char Rasta", shortName: "SCR", lat: 23.0330, lng: 72.5560, waypointIndex: 1 },
      { id: "std",  name: "Stadium Cross Road", shortName: "STD", lat: 23.0410, lng: 72.5585, waypointIndex: 2 },
      { id: "vdj",  name: "Vadaj Terminus",     shortName: "VDJ", lat: 23.0520, lng: 72.5615, waypointIndex: 3 },
      { id: "rto",  name: "RTO Circle",         shortName: "RTO", lat: 23.0645, lng: 72.5715, waypointIndex: 4 },
    ],
  },
];
