/**
 * Bounded-concurrency primitive for CPU-heavy or resource-limited work on the
 * request path (e.g. scrypt credential verification). Without a cap, a burst
 * of cache misses can run an unbounded number of memory-hard computations
 * concurrently (issue #48 L1). Excess work waits its turn instead of running
 * in parallel.
 */

export interface ConcurrencyLimiter {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export function createConcurrencyLimiter(maxConcurrent: number): ConcurrencyLimiter {
  let active = 0;
  const waiters: Array<() => void> = [];

  return {
    async run<T>(work: () => Promise<T>): Promise<T> {
      if (active >= maxConcurrent) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      active += 1;
      try {
        return await work();
      } finally {
        active -= 1;
        const next = waiters.shift();
        if (next) next();
      }
    },
  };
}
