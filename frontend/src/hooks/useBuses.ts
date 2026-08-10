import { useCollection } from "./useCollection";

export interface BusData {
  id: string; // The bus hardware ID e.g. "BRTS-101"
  name: string; // The display name e.g. "Red Line Express"
  assignedRoutes?: string[]; // Routes it should run on
  assignedRouteId?: string; // Legacy single-route assignment
}

/**
 * All registered buses from the Firestore `buses` collection, with loading
 * and error state. Backend-authoritative: buses are provisioned and assigned
 * server-side.
 */
export function useBuses() {
  const { data: buses, loading, error } = useCollection<BusData>("buses");
  return { buses, loading, error };
}
