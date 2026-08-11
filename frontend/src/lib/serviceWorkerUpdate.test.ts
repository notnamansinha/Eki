import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canActivateServiceWorker,
  clearDriverShiftUpdateState,
  DRIVER_SHIFT_LEASE_TTL_MS,
  DRIVER_SHIFT_UPDATE_STATE_KEY_PREFIX,
  setDriverShiftUpdateState,
} from "./serviceWorkerUpdate";

describe("service worker activation leases", () => {
  const values = new Map<string, string>();
  const localStorage = {
    get length() {
      return values.size;
    },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };

  beforeEach(() => {
    values.clear();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage,
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
    clearDriverShiftUpdateState("tab-b");
    expect(canActivateServiceWorker(1_003)).toBe(true);
    clearDriverShiftUpdateState("tab-a");
  });

  it("uses independent keys so one tab cannot overwrite another tab's lease", () => {
    values.set(
      `${DRIVER_SHIFT_UPDATE_STATE_KEY_PREFIX}remote-tab`,
      JSON.stringify({ state: "active", updatedAt: 2_000 }),
    );
    setDriverShiftUpdateState("local-tab", "inactive", 2_000);

    expect(values.size).toBe(2);
    expect(canActivateServiceWorker(2_001)).toBe(false);
    clearDriverShiftUpdateState("local-tab");
  });

  it("expires a lease left by a closed or crashed tab", () => {
    values.set(
      `${DRIVER_SHIFT_UPDATE_STATE_KEY_PREFIX}stale-tab`,
      JSON.stringify({ state: "checking", updatedAt: 3_000 }),
    );
    expect(canActivateServiceWorker(3_000 + DRIVER_SHIFT_LEASE_TTL_MS)).toBe(false);
    expect(canActivateServiceWorker(3_001 + DRIVER_SHIFT_LEASE_TTL_MS)).toBe(true);
  });

  it("ignores malformed and unrelated persisted state", () => {
    values.set(`${DRIVER_SHIFT_UPDATE_STATE_KEY_PREFIX}bad-tab`, "not-json");
    values.set("unrelated", JSON.stringify({ state: "active", updatedAt: 4_000 }));
    expect(canActivateServiceWorker(4_000)).toBe(true);
  });

  it("fails closed when browser storage cannot be read", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        get length() {
          throw new Error("storage blocked");
        },
      },
    });
    expect(canActivateServiceWorker(5_000)).toBe(false);
  });
});
