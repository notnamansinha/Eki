export const DRIVER_SHIFT_UPDATE_STATE_KEY_PREFIX = "eki:driver-shift-update-lease:";
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

function storageKey(leaseId: string): string {
  return `${DRIVER_SHIFT_UPDATE_STATE_KEY_PREFIX}${leaseId}`;
}

function readStoredLeases(): { leases: DriverShiftLeases; readable: boolean } {
  const leases: DriverShiftLeases = {};
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(DRIVER_SHIFT_UPDATE_STATE_KEY_PREFIX)) continue;
      const leaseId = key.slice(DRIVER_SHIFT_UPDATE_STATE_KEY_PREFIX.length);
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Partial<DriverShiftLease>;
        if (validState(parsed?.state) && Number.isFinite(parsed?.updatedAt)) {
          leases[leaseId] = parsed as DriverShiftLease;
        }
      } catch {
        // Ignore only this malformed lease; storage itself remains usable.
      }
    }
    return { leases, readable: true };
  } catch {
    return { leases: {}, readable: false };
  }
}

function currentLeases(now: number): { leases: DriverShiftLeases; readable: boolean } {
  const stored = readStoredLeases();
  return {
    readable: stored.readable,
    leases: Object.fromEntries(
      Object.entries({ ...stored.leases, ...memoryLeases }).filter(
        ([, lease]) => now - lease.updatedAt <= DRIVER_SHIFT_LEASE_TTL_MS,
      ),
    ),
  };
}

function dispatchLeaseChange(): void {
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
  const lease = { state, updatedAt: now };
  memoryLeases[leaseId] = lease;
  try {
    // A separate key per tab avoids a read-modify-write race between tabs.
    window.localStorage.setItem(storageKey(leaseId), JSON.stringify(lease));
  } catch {
    // The in-memory lease still protects this tab. Activation also fails
    // closed while storage cannot be read, protecting other open driver tabs.
  }
  dispatchLeaseChange();
}

export function clearDriverShiftUpdateState(leaseId: string): void {
  delete memoryLeases[leaseId];
  try {
    window.localStorage.removeItem(storageKey(leaseId));
  } catch {
    // A stale stored lease expires after DRIVER_SHIFT_LEASE_TTL_MS.
  }
  dispatchLeaseChange();
}

export function canActivateServiceWorker(now = Date.now()): boolean {
  const current = currentLeases(now);
  if (!current.readable) return false;
  return !Object.values(current.leases).some(
    (lease) => lease.state === "checking" || lease.state === "active",
  );
}
