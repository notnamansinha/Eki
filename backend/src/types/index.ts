/**
 * BusTrack - Shared TypeScript Types
 *
 * All types shared across backend modules.
 * Ref: PRD Sec 1 (Passenger), Sec 2 (Driver), Sec 3 (Admin)
 */

// ── Driver / Bus ──────────────────────────────────────────────────────────────

export interface BusLocation {
  busId: string;
  driverId: string;
  lat: number;
  lng: number;
  heading: number;     // degrees, 0 = North
  speed: number;       // km/h
  timestamp: number;   // Unix ms
  status: "active" | "idle" | "maintenance";
  routeId?: string;    // The ID from PREDEFINED_ROUTES (legacy single route)
  routeIds?: string[]; // Array of associated routeIds for multi-route assignment
  currentStopIndex?: number; // Driver's current stop in the route progression
  delayMinutes?: number;     // Reported delay in minutes (positive = late)
}

// ── Passenger Requests ────────────────────────────────────────────────────────

export type RequestType = "pickup" | "dropoff";

export interface PassengerRequest {
  requestId: string;
  passengerId: string;
  busId: string;       // Target bus
  type: RequestType;
  lat: number;
  lng: number;
  status: "pending" | "accepted" | "completed" | "cancelled";
  createdAt: number;   // Unix ms
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export interface FleetStats {
  totalBuses: number;
  activeBuses: number;
  maintenanceBuses: number;
  ongoingTrips: number;
  passengerCount: number;
}

// ── Socket Events ─────────────────────────────────────────────────────────────

// ── Simulation Bus Location (additive — does not replace existing events) ──────

export interface ETAUpdate {
  busId: string;
  routeId: string;
  etaSeconds: number;
  etaMinutes: number;
  distanceMeters: number;
  distanceKm: string;
  polyline: string;
  timestamp: number;
}

export interface SimBusLocation {
  busId: string;
  lat: number;
  lng: number;
  heading: number;
  routeId: string;
  speed?: number;
}

export interface ServerToClientEvents {
  "bus:location-update": (data: BusLocation) => void;
  "bus:location": (data: SimBusLocation) => void;
  "bus:stop-tracking": (data: { busId: string }) => void;
  "bus:eta-update": (data: ETAUpdate) => void;
  "request:new": (req: PassengerRequest) => void;
  "request:updated": (req: PassengerRequest) => void;
  "fleet:stats": (stats: FleetStats) => void;
}

export interface ClientToServerEvents {
  "driver:start-tracking": (data: { busId: string; driverId: string; routeId?: string; routeIds?: string[] }) => void;
  "driver:location-update": (data: Omit<BusLocation, "status"> & { routeIds?: string[]; currentStopIndex?: number }) => void;
  "driver:route-update": (data: { busId: string; routeId?: string; routeIds?: string[] }) => void;
  "driver:stop-tracking": (data: { busId: string }) => void;
  "driver:request-done": (data: { requestId: string }) => void;
  "passenger:request": (data: Omit<PassengerRequest, "requestId" | "status" | "createdAt">) => void;
  "passenger:join": () => void;
  "passenger:watch-route": (data: { routeId: string }) => void;
  "admin:join": () => void;
  // Simulation: driver emits real-time simulated position
  "bus:location": (data: SimBusLocation) => void;
}
