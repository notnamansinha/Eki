import { beforeEach, describe, expect, it, vi } from "vitest";
import { FieldValue } from "firebase-admin/firestore";

// In-memory Firestore with serialized transactions (what Firestore's isolation guarantees) and a fake start path
// that honours the idempotency key as startAssignedService does: the first attempt for a key creates a ride and
// later attempts for the same key resolve to it, or report why it ended.
type Doc = Record<string, any>;
// The error classes live here, not in the mock factory: vi.resetModules() re-runs factories, and the code under
// test must see the same class the fake start path throws.
const h = vi.hoisted(() => {
  class StartError extends Error {
    constructor(readonly statusCode: number, message: string, readonly reason?: string) { super(message); }
  }
  class ConflictError extends Error {}
  return { store: null as any, start: null as any, live: null as any, StartError, ConflictError };
});
vi.mock("../lib/firebaseAdmin", () => ({
  db: {
    collection: (name: string) => h.store.collection(name),
    runTransaction: (work: any) => h.store.runTransaction(work),
  },
  rtdb: {
    ref: () => ({
      transaction: async (update: (value: any) => any) => {
        const next = update(structuredClone(h.live));
        if (next !== undefined) h.live = next;
        return { committed: next !== undefined };
      },
    }),
  },
}));
vi.mock("../lib/boundedKeyedExecutor", () => ({
  BoundedKeyedExecutor: class { run(_key: string, work: () => Promise<void>) { return work(); } },
}));
vi.mock("../lib/endpointSnapshotVersion", () => ({ endpointSnapshotVersion: () => "route-version" }));
vi.mock("../lib/backgroundFailureTracker", () => ({ recordBackgroundFailure: vi.fn() }));
vi.mock("./rideSessionStart", () => ({
  startAssignedService: (...args: unknown[]) => h.start(...args),
  RideSessionStartError: h.StartError,
  SessionCreationConflict: h.ConflictError,
}));

const assignment = { busId: "bus", routeId: "route", deviceId: "device", assignmentRevision: 1 };
const sample = () => ({ lat: 23, lng: 72, speed: 0, heading: 0, gpsHdop: 1, motionState: "stopped" as const, seq: 1, timestamp: Date.now(), deviceSentAt: Date.now() });
const scopeKey = (epoch: number) => `device:device:1:${epoch}\0automatic-service-v1`;
const ENDED_EARLY = { status: "interrupted", busId: "bus", routeId: "route" };

interface World {
  docs: Record<string, Record<string, Doc>>; bindings: Map<string, string>; starts: string[];
  commits: Array<{ collection: string; id: string; data: Doc }>; created: string[];
  /** Runs right after a non-transactional read, so a test can change state between a caller's read and its write. */
  afterRead?: (collection: string, id: string) => void;
}
let world: World;

function install() {
  const docs = world.docs;
  const snap = (collection: string, id: string) => ({
    id, exists: docs[collection]?.[id] !== undefined,
    data: () => (docs[collection]?.[id] === undefined ? undefined : structuredClone(docs[collection][id])),
  });
  const ref = (collection: string, id: string) => ({
    collection, id,
    get: async () => { const value = snap(collection, id); world.afterRead?.(collection, id); return value; },
  });
  const query: any = {
    where: () => query, limit: () => query,
    get: async () => { const list = Object.keys(docs.drivers ?? {}).map(id => ({ id })); return { size: list.length, docs: list }; },
  };
  let chain: Promise<unknown> = Promise.resolve();
  h.store = {
    collection: (name: string) => ({ ...query, doc: (id: string) => ref(name, id) }),
    runTransaction: (work: (transaction: any) => Promise<unknown>) => {
      const run = chain.then(async () => {
        const writes: Array<{ collection: string; id: string; data: Doc }> = [];
        const result = await work({
          get: async (r: any) => snap(r.collection, r.id),
          set: (r: any, data: Doc) => writes.push({ collection: r.collection, id: r.id, data }),
        });
        for (const write of writes) {
          docs[write.collection] ??= {};
          const target = docs[write.collection][write.id] ??= {};
          for (const [field, value] of Object.entries(write.data)) {
            if (typeof (value as any)?.isEqual !== "function") target[field] = value;
            else if ((value as any).isEqual(FieldValue.delete())) delete target[field];
            else if ((value as any).isEqual(FieldValue.increment(1))) target[field] = Number(target[field] ?? 0) + 1;
            else throw new Error(`unsupported sentinel for ${field}`);
          }
          world.commits.push(write);
        }
        return result;
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
  h.start = async (_assignment: unknown, options: { principalScope: string; idempotencyKey: string }) => {
    await Promise.resolve(); // let concurrent attempts interleave before the check-and-create below
    const key = `${options.principalScope}\0${options.idempotencyKey}`;
    world.starts.push(key);
    const bound = world.bindings.get(key);
    if (bound) {
      const ride = docs.ride_sessions[bound];
      if (["completed", "interrupted", "failed"].includes(ride.status)) {
        throw new h.StartError(409, "ended", ride.status === "completed" ? "terminal_session" : "interrupted_session");
      }
      return { sessionId: bound, created: false };
    }
    const id = `new_ride_${world.created.length + 1}`;
    docs.ride_sessions[id] = { status: "armed", busId: "bus", routeId: "route" };
    world.bindings.set(key, id);
    world.created.push(id);
    return { sessionId: id, created: true };
  };
}

const epochWrites = () => world.commits.filter(write => write.collection === "bus_locations" && "automaticServiceEpoch" in write.data);
const load = async () => {
  const admission = await import("./automaticServiceAdmission");
  return { ...admission, attempt: () => admission.scheduleAutomaticServiceAdmission(assignment, sample()) };
};
async function admitOnce() {
  const admission = await load();
  admission.attempt();
  await admission.drainAutomaticServiceAdmission();
}

beforeEach(() => {
  vi.resetModules();
  world = {
    docs: { drivers: { driver: {} }, bus_locations: { bus: {} }, ride_sessions: { ride_a: { ...ENDED_EARLY } } },
    bindings: new Map([[scopeKey(0), "ride_a"]]),
    starts: [], commits: [], created: [],
  };
  h.live = { busId: "bus", routeId: "route" };
  install();
});

describe("automatic service rearm after a ride ends early, under races", () => {
  it("opens one new generation and starts one new ride", async () => {
    await admitOnce();
    expect(world.docs.bus_locations.bus.automaticServiceEpoch).toBe(1);
    expect(epochWrites()).toHaveLength(1);
    expect(world.created).toEqual(["new_ride_1"]);
    expect(world.starts).toEqual([scopeKey(0), scopeKey(1)]);
    expect(h.live.automaticServiceState).toBeUndefined();
  });

  it("produces exactly one new ride and one epoch bump when two servers attempt at once, and neither marks the bus paused", async () => {
    // Load both servers before either starts: loading is real I/O, and the first would finish before the second began.
    const first = await load();
    vi.resetModules();
    const second = await load(); // separate module state, same Firestore: a second server
    first.attempt();
    second.attempt();
    await Promise.all([first.drainAutomaticServiceAdmission(), second.drainAutomaticServiceAdmission()]);
    expect(world.docs.bus_locations.bus.automaticServiceEpoch).toBe(1);
    expect(epochWrites()).toHaveLength(1);
    expect(world.created).toEqual(["new_ride_1"]);
    expect(Object.keys(world.docs.ride_sessions).sort()).toEqual(["new_ride_1", "ride_a"]);
    expect(world.starts.filter(key => key === scopeKey(1))).toHaveLength(2); // both resolve to the same ride
    expect(h.live.automaticServiceState).toBeUndefined();
  });

  it("refuses without writing when a pause lands after the caller read the bus", async () => {
    const start = h.start;
    h.start = async (...args: unknown[]) => {
      try { return await start(...args); }
      catch (error) { world.docs.bus_locations.bus.automaticServicePaused = true; throw error; } // an admin ends the ride mid-attempt
    };
    await admitOnce();
    expect(world.docs.bus_locations.bus).toEqual({ automaticServicePaused: true });
    expect(world.commits).toEqual([]);
    expect(world.created).toEqual([]);
    expect(h.live.automaticServiceState).toBe("paused");
  });

  it("does not rearm a ride that ended normally", async () => {
    world.docs.ride_sessions.ride_a = { status: "completed", busId: "bus", routeId: "route" };
    await admitOnce();
    expect(world.commits).toEqual([]);
    expect(world.created).toEqual([]);
    expect(world.starts).toEqual([scopeKey(0)]);
    expect(h.live.automaticServiceState).toBe("paused");
  });

  it("stops re-reading after two rearms instead of looping when the generation keeps moving", async () => {
    h.start = async (_assignment: unknown, options: { principalScope: string; idempotencyKey: string }) => {
      world.starts.push(`${options.principalScope}\0${options.idempotencyKey}`);
      world.docs.bus_locations.bus.automaticServiceEpoch = Number(world.docs.bus_locations.bus.automaticServiceEpoch ?? 0) + 1; // another server moved it
      throw new h.StartError(409, "ended", "interrupted_session");
    };
    await admitOnce();
    expect(world.starts).toHaveLength(3);
    expect(world.commits).toEqual([]);
    expect(h.live.automaticServiceState).toBe("paused");
  });
});

describe("automatic service rearm of a consumed return ride, under races", () => {
  const journey = (consumedBy: string) => ({ terminalJourney: { sessionId: "ride_a", consumedBy } });

  beforeEach(() => {
    world.docs.ride_sessions = {
      ride_a: { status: "completed", busId: "bus", routeId: "route" },
      return_ride: { ...ENDED_EARLY },
    };
    world.docs.bus_locations.bus = journey("return_ride");
  });

  it("clears the marker and starts a new ride when nothing else moved", async () => {
    await admitOnce();
    expect(world.docs.bus_locations.bus).toEqual({ automaticServiceEpoch: 1 });
    expect(epochWrites()).toHaveLength(1);
    expect(world.created).toEqual(["new_ride_1"]);
    expect(world.starts).toEqual([scopeKey(1)]);
  });

  it("re-reads instead of marking the bus paused when another server released the marker first", async () => {
    world.afterRead = (collection, id) => {
      if (collection !== "ride_sessions" || id !== "return_ride") return;
      world.afterRead = undefined;
      world.docs.bus_locations.bus = { automaticServiceEpoch: 1 }; // the other server's rearm: new epoch, marker cleared
    };
    await admitOnce();
    expect(world.docs.bus_locations.bus).toEqual({ automaticServiceEpoch: 1 });
    expect(world.commits).toEqual([]); // this server wrote nothing
    expect(world.created).toEqual(["new_ride_1"]);
    expect(h.live.automaticServiceState).toBeUndefined();
  });

  it("leaves a marker alone when a different live return ride took it meanwhile, and reports the wait for that ride", async () => {
    world.afterRead = (collection, id) => {
      if (collection !== "ride_sessions" || id !== "return_ride") return;
      world.afterRead = undefined;
      world.docs.ride_sessions.return_two = { status: "armed", busId: "bus", routeId: "route" };
      world.docs.bus_locations.bus = journey("return_two");
    };
    await admitOnce();
    expect(world.docs.bus_locations.bus).toEqual(journey("return_two"));
    expect(world.commits).toEqual([]);
    expect(world.created).toEqual([]);
    expect(h.live.automaticServiceState).toBe("awaiting_return");
  });

  it("refuses without writing when a pause lands after the marker was read", async () => {
    world.afterRead = (collection, id) => {
      if (collection !== "ride_sessions" || id !== "return_ride") return;
      world.afterRead = undefined;
      world.docs.bus_locations.bus.automaticServicePaused = true;
    };
    await admitOnce();
    expect(world.docs.bus_locations.bus).toEqual({ ...journey("return_ride"), automaticServicePaused: true });
    expect(world.commits).toEqual([]);
    expect(world.created).toEqual([]);
    expect(h.live.automaticServiceState).toBe("paused");
  });
});
