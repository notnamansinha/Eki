import { BoundedKeyedExecutor, WorkQueueExpired, type ExecutionBudgets } from "./boundedKeyedExecutor";
import { AsyncLocalStorage } from "node:async_hooks";

export interface LatestPendingSchedulerMetrics {
  scheduled: number;
  /** Completed attempts, including failures; failed is a subset, not additive. */
  processed: number;
  coalesced: number;
  failed: number;
  rejected: number;
  expired: number;
  activeWorkers: number;
  pendingKeys: number;
  lastQueueAgeMs: number;
  maxQueueAgeMs: number;
}
interface PendingTask<T> { value: T; enqueuedAt: number; run: (work: () => Promise<void>) => Promise<void>; }
interface WorkerState<T> {
  started: boolean;
  submitted: PendingTask<T>;
  next: PendingTask<T> | null;
  promise: Promise<void> | null;
}

/** Replace positions only; durable lifecycle writes use a separate bounded FIFO. */
export function createLatestPendingScheduler<K, T>(
  processTask: (key: K, value: T) => Promise<void>,
  onError: (key: K, error: unknown) => void,
  now: () => number = () => performance.now(),
  options: ExecutionBudgets = {},
) {
  const executor = new BoundedKeyedExecutor<K>({ ...options, now, maxPendingPerKey: 1 });
  const workers = new Map<K, WorkerState<T>>();
  const metrics = { scheduled: 0, processed: 0, coalesced: 0, failed: 0, rejected: 0,
    expired: 0, lastQueueAgeMs: 0, maxQueueAgeMs: 0 };
  const report = (key: K, error: unknown) => {
    try { onError(key, error); } catch { /* Diagnostic failure cannot strand execution capacity. */ }
  };

  const submit = (key: K, state: WorkerState<T>): boolean => {
    if (now() - state.submitted.enqueuedAt >= executor.maxQueueAgeMs) {
      metrics.expired++; workers.delete(key); report(key, new WorkQueueExpired()); return false;
    }
    try {
      state.started = false;
      const promise = executor.run(key, async () => {
        state.started = true;
        const task = state.submitted;
        const age = Math.max(0, now() - task.enqueuedAt);
        metrics.lastQueueAgeMs = age; metrics.maxQueueAgeMs = Math.max(metrics.maxQueueAgeMs, age);
        if (age >= executor.maxQueueAgeMs) { metrics.expired++; report(key, new WorkQueueExpired()); return; }
        try { await task.run(() => processTask(key, task.value)); }
        catch (error) { metrics.failed++; report(key, error); }
        finally { metrics.processed++; }
      });
      state.promise = promise;
      void promise.then(() => {
        if (state.next) {
          state.submitted = state.next; state.next = null; submit(key, state);
        } else if (workers.get(key) === state) workers.delete(key);
      }, error => {
        metrics.expired++; if (workers.get(key) === state) workers.delete(key); report(key, error);
      });
      return true;
    } catch (error) {
      metrics.rejected++; workers.delete(key); report(key, error); return false;
    }
  };

  return {
    schedule(key: K, value: T): boolean {
      metrics.scheduled++;
      const task = { value, enqueuedAt: now(), run: AsyncLocalStorage.snapshot() };
      const state = workers.get(key);
      if (!state) {
        const next = { started: false, submitted: task, next: null, promise: null };
        workers.set(key, next); return submit(key, next);
      }
      if (state.started || (state.promise && executor.isDispatched(key, state.promise))) {
        if (state.next) metrics.coalesced++;
        state.next = task;
      } else {
        metrics.coalesced++; state.submitted = task;
        if (state.promise) executor.refreshPending(key, state.promise);
      }
      return true;
    },
    snapshot(): LatestPendingSchedulerMetrics {
      const execution = executor.snapshot();
      let nextKeys = 0;
      for (const worker of workers.values()) if (worker.next) nextKeys++;
      return { ...metrics, activeWorkers: execution.active, pendingKeys: execution.pending + nextKeys };
    },
    async drain(): Promise<void> {
      while (workers.size > 0) await Promise.allSettled([...workers.values()].flatMap(worker => worker.promise ? [worker.promise] : []));
    },
  };
}
