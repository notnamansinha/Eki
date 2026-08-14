/**
 * Optimistic delay tracking for the driver map (issue #38 F6).
 *
 * The driver map applies a delay tap optimistically so the UI stays
 * responsive, then PATCHes the backend. If the write fails the display must
 * revert to the last value the backend actually confirmed; otherwise the
 * driver's map shows +X min while the backend and passenger apps keep the old
 * value during a live shift.
 *
 * The caller serializes writes (rapid taps are still applied immediately), so
 * the value each request actually wrote:
 *  - confirm(expected) records the server-acknowledged value and only clears
 *    the pending optimistic value when it matches (a newer tap stays).
 *  - revert(expected) only drops the pending optimistic value when it matches
 *    (a failed write must not yank a newer pending tap).
 */
export class OptimisticDelay {
  /** Last value the backend acknowledged (or the initial value). */
  private confirmed: number;
  /** Newest applied-but-unconfirmed tap, if any. */
  private optimistic: number | null = null;

  constructor(initial: number) {
    this.confirmed = initial;
  }

  /** Apply a tap optimistically; returns the value the UI should show. */
  apply(next: number): number {
    this.optimistic = next;
    return next;
  }

  /** The backend accepted `expected`; returns the value the UI should show. */
  confirm(expected: number): number {
    this.confirmed = expected;
    if (this.optimistic === expected) {
      this.optimistic = null;
    }
    return this.value;
  }

  /** The write of `expected` failed; returns the value the UI should show. */
  revert(expected: number): number {
    if (this.optimistic === expected) {
      this.optimistic = null;
    }
    return this.value;
  }

  /** The current display value: newest optimistic tap, else confirmed. */
  get value(): number {
    return this.optimistic ?? this.confirmed;
  }
}
