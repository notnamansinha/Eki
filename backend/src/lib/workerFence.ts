import { AsyncLocalStorage } from "node:async_hooks";
import type { DocumentReference, DocumentData, SetOptions, Firestore, Transaction, WriteBatch } from "firebase-admin/firestore";
import type { Reference } from "firebase-admin/database";

export const WORKER_LEASE_ID = "trip-state-worker";
export const WORKER_CLOCK_SKEW_MS = 2_000;

export class WorkerLeadershipExpired extends Error {
  constructor() { super("Worker leadership expired or was superseded."); }
}

/** One acquisition, never revived after revocation. Deadlines use monotonic time. */
export class WorkerFence {
  private revoked = false;
  constructor(readonly ownerId: string, readonly generation: number, private deadline: number) {}
  assert(): void {
    if (this.revoked || performance.now() >= this.deadline) throw new WorkerLeadershipExpired();
  }
  extend(deadline: number): void { this.assert(); this.deadline = deadline; }
  revoke(): void { this.revoked = true; }
  run<T>(callback: () => T): T { this.assert(); return context.run(this, callback); }
}
const context = new AsyncLocalStorage<WorkerFence>();
export function assertWorkerLeadership(): void { context.getStore()?.assert(); }
export function workerGeneration(): number { return context.getStore()?.generation ?? 0; }

/** Cleanup must retain the old authority even when called by a new coordinator. */
export function bindWorkerContext<T>(callback: () => T): () => T {
  const fence = context.getStore();
  return () => fence ? context.run(fence, callback) : callback();
}

/** EventEmitters do not promise to retain the context used to register a listener. */
export function bindWorkerCallback<T extends unknown[]>(callback: (...args: T) => void): (...args: T) => void {
  const fence = context.getStore();
  return (...args) => {
    try { if (fence) fence.run(() => callback(...args)); else callback(...args); }
    catch (error) { if (!(error instanceof WorkerLeadershipExpired)) throw error; }
  };
}

/** Lease is in the destination transaction's read set: takeover conflicts at commit. */
export function workerTransaction<T>(store: Firestore, callback: (transaction: Transaction) => Promise<T>): Promise<T> {
  const fence = context.getStore();
  if (!fence) return store.runTransaction(callback);
  fence.assert();
  return store.runTransaction(async transaction => {
    fence.assert();
    const lease = (await transaction.get(store.collection("_worker_leases").doc(WORKER_LEASE_ID))).data();
    const expiry = lease?.expiresAt?.toMillis?.() ?? 0;
    if (lease?.ownerId !== fence.ownerId || lease?.generation !== fence.generation ||
      expiry <= Date.now() + WORKER_CLOCK_SKEW_MS) throw new WorkerLeadershipExpired();
    fence.assert();
    const result = await callback(transaction);
    fence.assert();
    return result;
  });
}

/** Bind the lease to ordinary batch writes too, without changing HTTP callers. */
export async function workerWrite(store: Firestore, write: (writer: Pick<WriteBatch, "set" | "update" | "delete">) => void): Promise<void> {
  // These write methods have identical arguments; only their fluent return
  // type differs. Callers must not use read/commit methods on this writer.
  if (context.getStore()) await workerTransaction(store, async transaction => { write(transaction as unknown as WriteBatch); });
  else { const batch = store.batch(); write(batch); await batch.commit(); }
}

export async function workerSet(store: Firestore, ref: DocumentReference, data: DocumentData, options: SetOptions): Promise<void> {
  if (context.getStore()) await workerWrite(store, writer => { writer.set(ref, data, options); });
  else await ref.set(data, options);
}

export async function workerDelete(store: Firestore, ref: DocumentReference): Promise<void> {
  if (context.getStore()) await workerWrite(store, writer => { writer.delete(ref); });
  else await ref.delete();
}

/**
 * RTDB cannot atomically read a Firestore lease. Recheck every retry and reject
 * a lower generation at the destination. Deletions retain the existing
 * session/value predicates; a deleted record cannot retain a generation.
 */
export function workerRtdbTransaction(ref: Reference, update: (current: any) => any) {
  const fence = context.getStore();
  fence?.assert();
  return ref.transaction(current => {
    try { fence?.assert(); } catch (error) {
      if (error instanceof WorkerLeadershipExpired) return;
      throw error;
    }
    if (fence && Number(current?._workerGeneration ?? 0) > fence.generation) return;
    const next = update(current);
    return fence && next && typeof next === "object"
      ? { ...next, _workerGeneration: fence.generation } : next;
  }, undefined, false);
}
