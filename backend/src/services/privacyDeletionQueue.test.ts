import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ docs: new Map<string, Record<string, any>>(), deleted: [] as string[], tail: Promise.resolve() as Promise<any>, hold: null as Promise<void> | null, claims: {} as Record<string, unknown> }));
vi.mock("../lib/firebaseAdmin", () => {
  function write(path: string, data: Record<string, any>, merge = false) {
    const value = merge ? { ...state.docs.get(path) } : {} as Record<string, any>;
    for (const [key, update] of Object.entries(data)) {
      if (update?.constructor.name === "NumericIncrementTransform") value[key] = Number(value[key] ?? 0) + update.operand;
      else if (update?.constructor.name === "DeleteTransform") delete value[key];
      else value[key] = update;
    }
    state.docs.set(path, value);
  }
  function doc(path: string): any {
    return { path, id: path.split("/").at(-1), get: async () => ({ exists: state.docs.has(path), id: path.split("/").at(-1), ref: doc(path), data: () => state.docs.get(path) }),
      set: async (data: any, options?: any) => write(path, data, options?.merge), delete: async () => { state.docs.delete(path); } };
  }
  function query(name: string, filters: Array<[string, string, any]> = [], cursor = "", cap = Infinity): any {
    return { doc: (id: string) => doc(`${name}/${id}`), where: (field: string, op: string, value: any) => query(name, [...filters, [field, op, value]], cursor, cap),
      orderBy: () => query(name, filters, cursor, cap), startAfter: (value: string) => query(name, filters, value, cap), limit: (value: number) => query(name, filters, cursor, value),
      get: async () => {
        const paths = [...state.docs.entries()].filter(([path, data]) => path.startsWith(`${name}/`) && path.split("/").at(-1)! > cursor && filters.every(([field, op, value]) => op === "in" ? value.includes(data[field]) : data[field] === value)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, cap);
        const docs = await Promise.all(paths.map(([path]) => doc(path).get())); return { docs, size: docs.length, empty: !docs.length };
      } };
  }
  const writer = () => {
    const pending: Array<() => void> = [];
    return { delete: (ref: any) => pending.push(() => { state.docs.delete(ref.path); }), update: (ref: any, data: any) => pending.push(() => write(ref.path, data, true)), set: (ref: any, data: any, options?: any) => pending.push(() => write(ref.path, data, options?.merge)), create: (ref: any, data: any) => { if (state.docs.has(ref.path)) throw Error("exists"); pending.push(() => write(ref.path, data)); }, commit: async () => { pending.forEach(work => work()); } };
  };
  return { db: { collection: query, collectionGroup: query, batch: writer,
    runTransaction: (work: any) => { const running = state.tail.then(async () => { const batch = writer(); const result = await work({ ...batch, get: (ref: any) => ref.get() }); await batch.commit(); return result; }); state.tail = running.catch(() => {}); return running; } },
    auth: { getUser: async () => ({ customClaims: state.claims, metadata: { creationTime: "2026-01-01T00:00:00Z" } }),
      deleteUser: async (uid: string) => { state.deleted.push(uid); await state.hold; if (uid.startsWith("poison")) throw Error("temporary Auth failure"); } } };
});
import { recoverPrivacyDeletion, requestPrivacyDeletion, privacyExecutions } from "./privacyDeletionRequests";
import { recoverFleetLock } from "./httpOperations";
import { runPrivacyDeletionQueue, drainPrivacyDeletions, privacyQueueStatus, startPrivacyDeletionWorker } from "./privacyDeletionWorker";
let tick: () => void;
let stop: (() => void) | undefined;
beforeEach(() => {
  state.docs.clear(); state.deleted = []; state.hold = null; state.claims = {}; state.tail = Promise.resolve();
  for (let index = 0; index < 20; index++) state.docs.set(`_privacy_deletion_requests/poison_${String(index).padStart(2, "0")}`, { status: "pending", attempts: 0 });
  state.docs.set("_privacy_deletion_requests/user_later", { status: "pending", attempts: 0 });
  vi.spyOn(global, "setInterval").mockImplementation(((work: () => void) => { tick = work; return { unref() {} }; }) as any);
  vi.spyOn(global, "clearInterval").mockImplementation(() => {});
});
afterEach(async () => { stop?.(); stop = undefined; await drainPrivacyDeletions(false); vi.restoreAllMocks(); });
describe("privacy queue recovery", () => {
  it("requeues a failed passenger request on resubmission while preserving attempt history", async () => {
    state.docs.clear();
    state.docs.set("_privacy_deletion_requests/passenger", { status: "failed", attempts: 5, failures: 5, generation: 8,
      targetCreatedAt: "2026-01-01T00:00:00Z", nextAttemptAt: Date.now() + 60_000 });
    await requestPrivacyDeletion("passenger");
    expect(state.docs.get("_privacy_deletion_requests/passenger")).toMatchObject({ status: "pending", attempts: 5,
      failures: 0, generation: 9 });
    await runPrivacyDeletionQueue(); await drainPrivacyDeletions(false);
    expect(state.deleted).toContain("passenger");
  });
  it("visits later passengers instead of repeating the first 20 poison requests", async () => {
    stop = startPrivacyDeletionWorker();
    await vi.waitFor(() => expect(state.deleted.length).toBeGreaterThanOrEqual(20));
    tick();
    await vi.waitFor(() => expect(state.deleted).toContain("user_later"), { timeout: 1000 });
  });
  it("backs off poison requests and caps failure attempts, preserving a deliberate recovery cycle", async () => {
    state.docs.clear(); state.docs.set("_privacy_deletion_requests/poison_00", { status: "pending", attempts: 0 });
    const clock = vi.spyOn(Date, "now"); let now = 2_000_000_000_000; clock.mockImplementation(() => now);
    for (let attempt = 1; attempt <= 5; attempt++) {
      await runPrivacyDeletionQueue(); await drainPrivacyDeletions(false);
      expect(state.deleted).toHaveLength(attempt);
      const data = state.docs.get("_privacy_deletion_requests/poison_00")!;
      expect(data.failures).toBe(attempt); expect(data.nextAttemptAt).toBeGreaterThan(now);
      await runPrivacyDeletionQueue(); await drainPrivacyDeletions(false); expect(state.deleted).toHaveLength(attempt);
      now = data.nextAttemptAt + 1;
    }
    const failed = state.docs.get("_privacy_deletion_requests/poison_00")!;
    expect(failed.status).toBe("failed");
    await runPrivacyDeletionQueue(); await drainPrivacyDeletions(false); expect(state.deleted).toHaveLength(5);
    await recoverPrivacyDeletion("poison_00", { expectedExecutorId: failed.executorId, expectedGeneration: failed.generation, adminUid: "admin" });
    expect(state.docs.get("_privacy_deletion_requests/poison_00")).toMatchObject({ attempts: 5, failures: 0, status: "pending", lastErrorCode: "DEPENDENCY_FAILURE" });
  });
  it("retains a hung raw execution and its lock, bounds later admissions, and refuses active recovery", async () => {
    let release!: () => void; state.hold = new Promise<void>(done => { release = done; });
    await runPrivacyDeletionQueue();
    await vi.waitFor(() => expect(state.deleted).toHaveLength(1));
    for (let index = 0; index < 25; index++) await runPrivacyDeletionQueue();
    expect(privacyQueueStatus().execution).toMatchObject({ active: 1 });
    expect(privacyQueueStatus().execution.pending).toBeLessThanOrEqual(20);
    expect(privacyExecutions.size).toBeLessThanOrEqual(21);
    const data = state.docs.get("_privacy_deletion_requests/poison_00")!;
    await expect(recoverPrivacyDeletion("poison_00", { expectedExecutorId: data.executorId, expectedGeneration: data.generation, executorStopped: true, adminUid: "admin" })).rejects.toThrow("active");
    const lock = state.docs.get("_fleet_reconciliation_locks/singleton")!;
    await expect(recoverFleetLock({ expectedOwner: lock.owner, executorStopped: true, adminUid: "admin" })).rejects.toThrow("local work");
    release(); await drainPrivacyDeletions(false);
    expect(state.docs.has("_fleet_reconciliation_locks/singleton")).toBe(false);
  });
  it("cannot publish late cleanup over a replaced claim generation", async () => {
    state.docs.clear(); state.docs.set("_privacy_deletion_requests/normal", { status: "pending" });
    let release!: () => void; state.hold = new Promise<void>(done => { release = done; });
    await runPrivacyDeletionQueue(); await vi.waitFor(() => expect(state.deleted).toEqual(["normal"]));
    state.docs.set("_privacy_deletion_requests/normal", { status: "pending", generation: 88, executorId: "new" });
    release(); await drainPrivacyDeletions(false);
    expect(state.docs.get("_privacy_deletion_requests/normal")).toEqual({ status: "pending", generation: 88, executorId: "new" });
  });
  it("continues a large passenger history in bounded chunks without starving another passenger", async () => {
    state.docs.clear(); state.docs.set("_privacy_deletion_requests/big", { status: "pending" }); state.docs.set("_privacy_deletion_requests/later", { status: "pending" });
    for (let index = 0; index < 1001; index++) state.docs.set(`feedbacks/${index}`, { userId: "big" });
    await runPrivacyDeletionQueue(); await drainPrivacyDeletions(false);
    expect([...state.docs].filter(([path]) => path.startsWith("feedbacks/"))).toHaveLength(801);
    expect(state.deleted).toEqual(["later"]);
    for (let index = 0; index < 5; index++) { await runPrivacyDeletionQueue(); await drainPrivacyDeletions(false); }
    expect(state.deleted).toContain("big"); expect(state.docs.has("_privacy_deletion_requests/big")).toBe(false);
  });
  it("refuses current operators and changed Auth identities before cleanup", async () => {
    state.docs.clear(); state.claims = { role: "driver" };
    state.docs.set("_privacy_deletion_requests/operator", { status: "pending" }); state.docs.set("users/operator", { role: "driver" });
    await runPrivacyDeletionQueue(); await drainPrivacyDeletions(false);
    expect(state.docs.get("_privacy_deletion_requests/operator")?.status).toBe("failed"); expect(state.docs.has("users/operator")).toBe(true); expect(state.deleted).toHaveLength(0);
    state.claims = {}; state.docs.set("_privacy_deletion_requests/new", { status: "pending", targetCreatedAt: "different-account" });
    await runPrivacyDeletionQueue(); await drainPrivacyDeletions(false);
    expect(state.docs.get("_privacy_deletion_requests/new")?.status).toBe("failed"); expect(state.deleted).toHaveLength(0);
  });
});
