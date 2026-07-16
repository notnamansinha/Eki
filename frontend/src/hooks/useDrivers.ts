import { useCollection } from "./useCollection";

export interface DriverData {
  id: string; // Driver unique ID e.g. "drv_1"
  name: string; // Driver display name e.g. "Ravi Kumar"
  assignedBusId: string | null; // Bus they are driving today
  photoUrl?: string; // Custom profile photo URL from Firebase Storage
}

export function useDrivers() {
  const { data: drivers, loading } = useCollection<DriverData>("drivers");
  return { drivers, loading };
}
