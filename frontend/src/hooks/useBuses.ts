import { useCollection } from "./useCollection";

export interface BusData {
  id: string; // The bus hardware ID e.g. "BRTS-101"
  name: string; // The display name e.g. "Red Line Express"
  assignedRoutes?: string[]; // Routes it should run on
  assignedRouteId?: string; // Legacy single-route assignment
}

export function useBuses() {
  const { data: buses, loading, error } = useCollection<BusData>("buses");
  return { buses, loading, error };
}
