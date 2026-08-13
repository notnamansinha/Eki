/**
 * Bounded LRU cache.
 *
 * Evicts the least-recently-used entry once `maxSize` is exceeded so that
 * module-level state maps cannot grow without bound over the process lifetime
 * (issue #37). Iteration order follows recency: the first key is the oldest.
 * Reads and overwrites count as uses.
 *
 * An optional `onEvict` hook lets callers release resources held by an
 * evicted entry (e.g. clear a timer and start its deferred work). Values must
 * not be `undefined`.
 */
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();
  private readonly onEvict?: (key: K, value: V) => void;

  /**
   * Creates a cache that evicts the least-recently-used entry once `maxSize`
   * entries are stored.
   *
   * @param maxSize Positive integer cap on stored entries.
   * @param onEvict Optional hook called with each evicted key/value so callers
   *   can release held resources (e.g. clear a timer and start deferred work).
   */
  constructor(
    readonly maxSize: number,
    onEvict?: (key: K, value: V) => void,
  ) {
    if (!Number.isSafeInteger(maxSize) || maxSize < 1) {
      throw new RangeError(
        `LruCache maxSize must be a positive integer, got ${maxSize}`,
      );
    }
    this.onEvict = onEvict;
  }

  /** Number of entries currently stored. */
  get size(): number {
    return this.entries.size;
  }

  /** Whether `key` is present, without counting the check as a use. */
  has(key: K): boolean {
    return this.entries.has(key);
  }

  /**
   * Returns the value for `key`, or `undefined` when absent.
   *
   * A hit counts as a use: the entry is re-inserted so iteration order stays
   * least- to most-recently used.
   */
  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    // A read is a use: re-insert so Map iteration order stays LRU-ordered.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /**
   * Stores `value` under `key`, treating an overwrite as a use.
   *
   * When the cache is full, the least-recently-used entry is evicted (and
   * `onEvict` is invoked) until the size is back within `maxSize`.
   */
  set(key: K, value: V): this {
    if (this.entries.has(key)) {
      // An overwrite is a use too; a new key is inserted as most-recent.
      this.entries.delete(key);
    }
    this.entries.set(key, value);
    while (this.entries.size > this.maxSize) {
      const oldestKey = this.entries.keys().next().value as K | undefined;
      if (oldestKey === undefined) break;
      const oldestValue = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (oldestValue !== undefined) this.onEvict?.(oldestKey, oldestValue);
    }
    return this;
  }

  /** Removes `key`, returning whether it was present. */
  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  /** Removes all entries. */
  clear(): void {
    this.entries.clear();
  }

  /** Values in least- to most-recently used order. */
  values(): IterableIterator<V> {
    return this.entries.values();
  }

  /** [key, value] pairs in least- to most-recently used order. */
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries[Symbol.iterator]();
  }
}
