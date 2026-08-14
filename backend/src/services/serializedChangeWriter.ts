import { LruCache } from "../lib/lruCache";

/**
 * Serializes change-only writes per key.
 *
 * RTDB child events can arrive faster than Firestore commits and out of
 * order, so every write for the same key is chained behind the previous one:
 * an older transition can never finish after a newer one and overwrite it.
 *
 * An optional fingerprint dedups writes whose key state has not changed since
 * the last enqueue. A failed write clears the fingerprint so the same state
 * can be retried by a later event.
 */
export class SerializedChangeWriter {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly fingerprints: LruCache<string, string>;

  /**
   * @param maxFingerprints Bounds the dedup fingerprint map (issue #37) so
   *   fingerprints of retired keys cannot accumulate forever. Eviction only
   *   drops a dedup entry: the next identical event performs one redundant
   *   write, then re-caches. Queues are never evicted — dropping a pending
   *   write would break the per-key ordering guarantee.
   */
  constructor(maxFingerprints = 1_000) {
    this.fingerprints = new LruCache<string, string>(maxFingerprints);
  }

  /**
   * Queues `write` behind the previous write for `key` and returns its promise.
   *
   * When `fingerprint` is non-null and equals the fingerprint of the last
   * enqueued write for the key, the write is skipped and the pending write's
   * promise is returned instead. Pass `null` to always queue (ordering only).
   */
  enqueue<T>(
    key: string,
    fingerprint: string | null,
    write: () => Promise<T>,
  ): Promise<T> {
    if (fingerprint !== null && this.fingerprints.get(key) === fingerprint) {
      return (this.queues.get(key) ?? Promise.resolve()) as Promise<T>;
    }
    if (fingerprint !== null) {
      this.fingerprints.set(key, fingerprint);
    }

    const previous = this.queues.get(key) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(write);
    this.queues.set(key, queued);
    void queued.then(
      () => {
        if (this.queues.get(key) === queued) this.queues.delete(key);
      },
      (error) => {
        // A rejected write must not keep suppressing a retry of the same state.
        if (fingerprint !== null && this.fingerprints.get(key) === fingerprint) {
          this.fingerprints.delete(key);
        }
        if (this.queues.get(key) === queued) this.queues.delete(key);
        // The rejection is left to the caller; this handler only keeps the
        // queue healthy and marks the promise handled for fire-and-forget uses.
        void error;
      },
    );
    return queued;
  }

  /**
   * Invalidates the dedup fingerprint for `key` when its last write did not
   * actually persist (e.g. an ownership lock check failed), so a later event
   * with the same state is allowed to retry.
   */
  retry(key: string, fingerprint: string): void {
    if (this.fingerprints.get(key) === fingerprint) {
      this.fingerprints.delete(key);
    }
  }

  /** Forgets the dedup fingerprint for `key`, keeping any pending write. */
  forgetFingerprint(key: string): void {
    this.fingerprints.delete(key);
  }

  /**
   * Forgets the fingerprint for `key` without detaching in-flight work.
   *
   * Promises cannot be cancelled safely here. Keeping the queue means a new
   * write still runs after an older one, rather than racing it and allowing a
   * stale persistence operation to finish last.
   */
  invalidate(key: string): void {
    this.fingerprints.delete(key);
  }

  /** In-flight writes for every key, for shutdown draining. */
  pending(): Iterable<Promise<unknown>> {
    return this.queues.values();
  }

  /** Clears dedup fingerprints while preserving active write ordering. */
  clear(): void {
    this.fingerprints.clear();
  }
}
