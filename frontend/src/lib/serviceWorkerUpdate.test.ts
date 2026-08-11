import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canActivateServiceWorker,
  clearDriverShiftUpdateState,
  DRIVER_SHIFT_LEASE_TTL_MS,
  DRIVER_SHIFT_UPDATE_STATE_KEY,
  setDriverShiftUpdateState,
} from "./serviceWorkerUpdate";

describe("service worker activation leases", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
        },
        dispatchEvent: () => true,
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("blocks while any live tab is checking or active", () => {
    setDriverShiftUpdateState("tab-a", "inactive", 1_000);
    setDriverShiftUpdateState("tab-b", "active", 1_000);
    expect(canActivateServiceWorker(1_001)).toBe(false);
    clearDriverShiftUpdateState("tab-b", 1_002);
    expect(canActivateServiceWorker(1_003)).toBe(true);
    clearDriverShiftUpdateState("tab-a", 1_004);
  });

  it("expires a lease left by a closed or crashed tab", () => {
    setDriverShiftUpdateState("stale-tab", "checking", 2_000);
    expect(canActivateServiceWorker(2_000 + DRIVER_SHIFT_LEASE_TTL_MS)).toBe(false);
    expect(canActivateServiceWorker(2_001 + DRIVER_SHIFT_LEASE_TTL_MS)).toBe(true);
    clearDriverShiftUpdateState("stale-tab", 2_002 + DRIVER_SHIFT_LEASE_TTL_MS);
  });

  it("ignores malformed persisted state", () => {
    values.set(DRIVER_SHIFT_UPDATE_STATE_KEY, "not-json");
    expect(canActivateServiceWorker(3_000)).toBe(true);
  });
});
