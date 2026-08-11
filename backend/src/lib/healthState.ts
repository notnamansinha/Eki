/**
 * Per-store readiness for the /health probe. A single combined boolean
 * flapped both stores together: one flapping store took the whole service
 * down in the probe (issue #48 L4). Each store keeps its own readiness so
 * operators can see exactly which backend dependency is degraded.
 */

export type StoreStatus = "connected" | "disconnected";

export interface HealthSnapshot {
  ready: boolean;
  firestore: StoreStatus;
  rtdb: StoreStatus;
  checkedAt: string | null;
}

export interface HealthState {
  probe: (
    firestoreProbe: () => Promise<unknown>,
    rtdbProbe: () => Promise<unknown>,
  ) => Promise<void>;
  snapshot: () => HealthSnapshot;
}

export function createHealthState(): HealthState {
  let firestoreReady = false;
  let rtdbReady = false;
  let checkedAt: string | null = null;

  return {
    async probe(firestoreProbe, rtdbProbe) {
      const [firestoreResult, rtdbResult] = await Promise.allSettled([
        firestoreProbe(),
        rtdbProbe(),
      ]);
      firestoreReady = firestoreResult.status === "fulfilled";
      rtdbReady = rtdbResult.status === "fulfilled";
      checkedAt = new Date().toISOString();
    },
    snapshot() {
      return {
        ready: firestoreReady && rtdbReady,
        firestore: firestoreReady ? "connected" : "disconnected",
        rtdb: rtdbReady ? "connected" : "disconnected",
        checkedAt,
      };
    },
  };
}
