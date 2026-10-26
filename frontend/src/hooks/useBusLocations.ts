import { useCollection } from "@/hooks/useCollection";

/** Backend-owned durable fleet state (admin read only). */
export interface BusLocationData {
  id: string; // Bus ID
  routeId?: string | null;
  lastKnownLocation?: { lat: number; lng: number; sampledAt: number } | null;
}

/**
 * Per-bus durable fleet state, including the last accepted GNSS fix that
 * outlives the bus's live presence record.
 */
export function useBusLocations() {
  const { data: busLocations, error, retry } = useCollection<BusLocationData>("bus_locations");
  return { busLocations, error, retry };
}
