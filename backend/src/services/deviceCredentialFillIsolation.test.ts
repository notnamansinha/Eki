import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  documents: new Map<string, Record<string, unknown>>(),
  hangReads: new Set<string>(),
  hangUnknownReads: false,
  holdDummyKdf: false,
  released: [] as Array<() => void>,
}));
vi.mock("../lib/firebaseAdmin", () => ({
  db: { collection: (name: string) => ({ doc: (id: string) => ({ get: async () => {
    if (harness.hangReads.has(`${name}/${id}`) || (harness.hangUnknownReads && id.startsWith("guess_"))) {
      await new Promise<void>(resolve => harness.released.push(resolve));
    }
    const data = harness.documents.get(`${name}/${id}`);
    return { exists: data !== undefined, data: () => data };
  } }) }) },
  rtdb: { ref: () => ({ on() {}, off() {} }) },
}));
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt: (secret: string, salt: string, length: number, callback: (error: Error | null, key: Buffer) => void) => {
    // Unknown device IDs verify against the all-zero dummy salt.
    if (harness.holdDummyKdf && /^0+$/.test(salt)) {
      harness.released.push(() => callback(null, Buffer.alloc(length)));
      return;
    }
    actual.scrypt(secret, salt, length, { N: 16 }, callback);
  } };
});
import { SingleFlightCapacityError } from "../lib/boundedSingleFlight";
import { checkDeviceCredentials, hashDeviceSecret, invalidateDeviceCredentialCache } from "./deviceTelemetryService";

const secret = "legitimate-device-secret-with-entropy";
const wrongSecret = "wrong-device-secret-with-entropy";
let offsetMs = 0;
let floodRound = 0;
const realNow = performance.now.bind(performance);
const settle = () => new Promise(resolve => setTimeout(resolve, 10));
const outcome = (deviceId: string, supplied: string, now: number) => checkDeviceCredentials(deviceId, supplied, now)
  .then(value => ({ status: value.status }), error => ({ error: (error as Error).constructor.name }));

async function provision(count: number) {
  const hash = await hashDeviceSecret(secret);
  for (let index = 1; index <= count; index++) {
    harness.documents.set(`devices/device_${index}`, { busId: `bus_${index}`, routeId: "route_1", secretHash: hash });
    harness.documents.set(`buses/bus_${index}`, { assignedRoutes: ["route_1"] });
  }
  harness.documents.set("routes/route_1", {});
}

/** Unauthenticated requests for distinct unknown device IDs; each starts a new fill. */
function flood(count: number, now: number) {
  floodRound++;
  return Array.from({ length: count }, (_, index) =>
    checkDeviceCredentials(`guess_${floodRound}_${index}`, "x".repeat(24), now).catch(error => error));
}

async function releaseAll() {
  harness.hangUnknownReads = false; harness.holdDummyKdf = false; harness.hangReads.clear();
  while (harness.released.length) {
    harness.released.splice(0).forEach(release => release());
    await settle();
  }
}

beforeEach(() => {
  harness.documents.clear(); harness.released.length = 0;
  offsetMs = 0;
  vi.spyOn(performance, "now").mockImplementation(() => realNow() + offsetMs);
  for (let index = 1; index <= 9; index++) invalidateDeviceCredentialCache(`device_${index}`);
});
afterEach(async () => {
  await releaseAll();
  vi.restoreAllMocks();
});

describe("device credential fill isolation from unauthenticated floods", () => {
  it("re-verifies an expired verified device while unknown-ID fills occupy every shared slot", async () => {
    await provision(1);
    const t0 = Date.now();
    await expect(checkDeviceCredentials("device_1", secret, t0)).resolves.toMatchObject({ status: "assigned" });
    offsetMs = 61_000;
    const later = t0 + 61_000;
    harness.hangUnknownReads = true;
    const attacker = flood(16, later);
    await settle();
    await expect(outcome("guess_extra", "x".repeat(24), later)).resolves.toEqual({ error: SingleFlightCapacityError.name });

    await expect(outcome("device_1", secret, later)).resolves.toEqual({ status: "assigned" });
    await releaseAll();
    await Promise.all(attacker);
  });

  it("does not queue a verified device's refill behind unknown-ID work in the shared KDF", async () => {
    await provision(1);
    const t0 = Date.now();
    await checkDeviceCredentials("device_1", secret, t0);
    offsetMs = 61_000;
    const later = t0 + 61_000;
    harness.holdDummyKdf = true;
    const attacker = flood(12, later);
    await settle();

    await expect(outcome("device_1", secret, later)).resolves.toEqual({ status: "assigned" });
    await releaseAll();
    await Promise.all(attacker);
  }, 15_000);

  it("does not reserve capacity for a device whose credentials were explicitly invalidated", async () => {
    await provision(1);
    const t0 = Date.now();
    await checkDeviceCredentials("device_1", secret, t0);
    offsetMs = 61_000;
    const later = t0 + 61_000;
    invalidateDeviceCredentialCache("device_1");
    harness.hangUnknownReads = true;
    const attacker = flood(16, later);
    await settle();
    // Revocation stays immediate: the device must prove itself again through the shared pool.
    await expect(outcome("device_1", secret, later)).resolves.toEqual({ error: SingleFlightCapacityError.name });
    await releaseAll();
    await Promise.all(attacker);
    await expect(outcome("device_1", wrongSecret, later)).resolves.toEqual({ status: "invalid" });
  });

  it("serves a verified credential only within the bounded grace when its reserved refill is saturated", async () => {
    await provision(9);
    const t0 = Date.now();
    for (let index = 1; index <= 9; index++) await checkDeviceCredentials(`device_${index}`, secret, t0);
    offsetMs = 61_000;
    const later = t0 + 61_000;
    for (let index = 1; index <= 8; index++) harness.hangReads.add(`devices/device_${index}`);
    const refills = Array.from({ length: 8 }, (_, index) => outcome(`device_${index + 1}`, secret, later));
    await settle();
    await expect(outcome("device_9", secret, later)).resolves.toEqual({ status: "assigned" });
    await expect(outcome("device_9", wrongSecret, later)).resolves.toEqual({ status: "invalid" });

    offsetMs = 61_000 + 10 * 60_000;
    await expect(outcome("device_9", secret, t0 + offsetMs)).resolves.toEqual({ error: SingleFlightCapacityError.name });
    await releaseAll();
    await Promise.all(refills);
  });
});
