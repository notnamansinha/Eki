export interface LatestPendingSchedulerMetrics {
  scheduled: number;
  processed: number;
  coalesced: number;
  failed: number;
  activeWorkers: number;
  pendingKeys: number;
  lastQueueAgeMs: number;
  maxQueueAgeMs: number;
}

interface PendingTask<T> {
  value: T;
  enqueuedAt: number;
}

interface WorkerState<T> {
  pending: PendingTask<T> | null;
  promise: Promise<void>;
}

/**
 * Run at most one task per key and retain only the newest pending replacement.
 * This bounds memory and stale-work latency while preserving isolation across
 * keys. The caller remains responsible for keeping non-coalescible lifecycle
 * work outside this queue.
 */
export function createLatestPendingScheduler<K, T>(
  processTask: (key: K, value: T) => Promise<void>,
  onError: (key: K, error: unknown) => void,
  now: () => number = Date.now,
) {
  const workers = new Map<K, WorkerState<T>>();
  const metrics = {
    scheduled: 0,
    processed: 0,
    coalesced: 0,
    failed: 0,
    lastQueueAgeMs: 0,
    maxQueueAgeMs: 0,
  };

  const start = (key: K, first: PendingTask<T>): WorkerState<T> => {
    const state: WorkerState<T> = {
      pending: null,
      promise: Promise.resolve(),
    };
    state.promise = (async () => {
      let task: PendingTask<T> | null = first;
      while (task) {
        const queueAgeMs = Math.max(0, now() - task.enqueuedAt);
        metrics.lastQueueAgeMs = queueAgeMs;
        metrics.maxQueueAgeMs = Math.max(metrics.maxQueueAgeMs, queueAgeMs);
        try {
          await processTask(key, task.value);
        } catch (error) {
          metrics.failed += 1;
          onError(key, error);
        } finally {
          metrics.processed += 1;
        }
        task = state.pending;
        state.pending = null;
      }
    })().finally(() => {
      if (workers.get(key) === state) workers.delete(key);
    });
    workers.set(key, state);
    return state;
  };

  return {
    schedule(key: K, value: T): void {
      metrics.scheduled += 1;
      const task = { value, enqueuedAt: now() };
      const worker = workers.get(key);
      if (!worker) {
        start(key, task);
        return;
      }
      if (worker.pending) metrics.coalesced += 1;
      worker.pending = task;
    },
    snapshot(): LatestPendingSchedulerMetrics {
      let pendingKeys = 0;
      for (const worker of workers.values()) {
        if (worker.pending) pendingKeys += 1;
      }
      return {
        ...metrics,
        activeWorkers: workers.size,
        pendingKeys,
      };
    },
    async drain(): Promise<void> {
      while (workers.size > 0) {
        await Promise.all([...workers.values()].map((worker) => worker.promise));
      }
    },
  };
}
