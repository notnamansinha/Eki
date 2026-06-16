const BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  getBuses: () => req<{ buses: unknown[] }>("/api/buses"),
  getFleetStats: () =>
    req<{
      totalBuses: number;
      activeBuses: number;
      maintenanceBuses: number;
      ongoingTrips: number;
      passengerCount: number;
    }>("/api/analytics/fleet"),
  getTrips: () => req<{ trips: unknown[] }>("/api/analytics/trips"),
  getFeedback: () => req<{ feedback: unknown[] }>("/api/analytics/feedback"),
  createRequest: (data: unknown) =>
    req("/api/requests", { method: "POST", body: JSON.stringify(data) }),
  completeRequest: (id: string) =>
    req(`/api/requests/${id}`, { method: "PATCH", body: JSON.stringify({ status: "completed" }) }),
};
