import { auth } from "./firebaseAuth";
import { apiRequest } from "./apiClient";
import { withTimeout } from "./promiseTimeout";
import { getAuthVerificationGeneration, waitForAuth } from "./authState";
export interface JoinedRideStatus { sessionId: string; busId: string; routeId: string; status: "pending" | "armed" | "active" | "completed" | "interrupted" | "failed" }
export async function getJoinedRideStatus(sessionId: string, signal: AbortSignal): Promise<JoinedRideStatus> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) throw Error("Ride status is unavailable for this account.");
  const { user, generation, token } = await withTimeout((async () => {
    await waitForAuth();
    const user = auth.currentUser, generation = getAuthVerificationGeneration();
    if (!user || signal.aborted) throw Error("Ride status is unavailable for this account.");
    const token = await user.getIdToken();
    return { user, generation, token };
  })(), 10000, "Ride status authentication timed out.");
  if (signal.aborted || auth.currentUser !== user || generation !== getAuthVerificationGeneration()) throw Error("Ride status request cancelled.");
  const result = await apiRequest<JoinedRideStatus>(`/api/sessions/${encodeURIComponent(sessionId)}/status`, {
    signal, headers: { Authorization: `Bearer ${token}` }, fallbackError: "Ride status could not be recovered.",
    validateResponse: value => {
      const item = value as JoinedRideStatus | null;
      return !!item && item.sessionId === sessionId && typeof item.busId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(item.busId) && typeof item.routeId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(item.routeId) && typeof item.status === "string" && ["pending", "armed", "active", "completed", "interrupted", "failed"].includes(item.status);
    },
  });
  if (signal.aborted || auth.currentUser !== user || generation !== getAuthVerificationGeneration()) throw Error("Ride status request cancelled.");
  return result;
}
