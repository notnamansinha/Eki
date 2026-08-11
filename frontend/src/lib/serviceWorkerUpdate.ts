export const DRIVER_SHIFT_UPDATE_STATE_KEY = "eki:driver-shift-update-leases";
export const DRIVER_SHIFT_UPDATE_EVENT = "eki:driver-shift-update-state-change";
export const DRIVER_SHIFT_LEASE_TTL_MS = 15_000;
export const DRIVER_SHIFT_LEASE_HEARTBEAT_MS = 5_000;

export type DriverShiftUpdateState = "checking" | "active" | "inactive";

type DriverShiftLease = {
  state: DriverShiftUpdateState;
  updatedAt: number;
};

type DriverShiftLeases = Record<string, DriverShiftLease>;

const memoryLeases: DriverShiftLeases = {};

function validState(value: unknown): value is DriverShiftUpdateState {
  return value === "checking" || value === "active" || value === "inactive";
}

function readStoredLeases(): DriverShiftLeases {
  try {
    const value = window.localStorage.getItem(DRIVER_SHIFT_UPDATE_STATE_KEY);
    if (!value) return {};
    const parsed = JSON.parse(value) as Record<string, Partial<DriverShiftLease>>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, DriverShiftLease] =>
          validState(entry[1]?.state) && Number.isFinite(entry[1]?.updatedAt),
      ),
    );
  } catch {
    return {};
  }
}

function currentLeases(now: number): DriverShiftLeases {
  return Object.fromEntries(
    Object.entries({ ...readStoredLeases(), ...memoryLeases }).filter(
      ([, lease]) => now - lease.updatedAt <= DRIVER_SHIFT_LEASE_TTL_MS,
    ),
  );
}

function persistLeases(leases: DriverShiftLeases): void {
  try {
    window.localStorage.setItem(DRIVER_SHIFT_UPDATE_STATE_KEY, JSON.stringify(leases));
  } catch {
    // The in-memory lease still protects this tab when storage is unavailable.
  }
  window.dispatchEvent(new Event(DRIVER_SHIFT_UPDATE_EVENT));
}

export function createDriverShiftLeaseId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function setDriverShiftUpdateState(
  leaseId: string,
  state: DriverShiftUpdateState,
  now = Date.now(),
): void {
  memoryLeases[leaseId] = { state, updatedAt: now };
  persistLeases({ ...currentLeases(now), [leaseId]: memoryLeases[leaseId] });
}

export function clearDriverShiftUpdateState(leaseId: string, now = Date.now()): void {
  delete memoryLeases[leaseId];
  const leases = currentLeases(now);
  delete leases[leaseId];
  persistLeases(leases);
}

export function canActivateServiceWorker(now = Date.now()): boolean {
  return !Object.values(currentLeases(now)).some(
    (lease) => lease.state === "checking" || lease.state === "active",
  );
}
