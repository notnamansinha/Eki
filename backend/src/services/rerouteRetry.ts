export const MAX_REROUTE_BACKOFF_MS = 300_000;
const BASE_REROUTE_BACKOFF_MS = 10_000;
export interface RerouteRetry {
  context: string;
  failures: number;
  nextAttemptAt: number;
}

/** Equal jitter retains a minimum delay, with a five-minute maximum. */
export function rerouteBackoffMs(failures: number, random = Math.random()): number {
  const ceiling = Math.min(MAX_REROUTE_BACKOFF_MS, BASE_REROUTE_BACKOFF_MS * 2 ** Math.min(30, Math.max(0, failures - 1)));
  return Math.ceil(ceiling * (0.5 + Math.max(0, Math.min(1, random)) * 0.5));
}

export function readRerouteRetry(value: unknown, context: string): RerouteRetry | null {
  if (!value || typeof value !== "object") return null;
  const retry = value as RerouteRetry;
  return retry.context === context && Number.isInteger(retry.failures) && retry.failures > 0 && retry.failures <= 32 &&
    Number.isSafeInteger(retry.nextAttemptAt) && retry.nextAttemptAt >= 0 ? retry : null;
}

/** Process-wide provider budget; no per-bus map or background retry timers. */
export class RerouteProviderCircuit {
  private failures = 0;
  private openings = 0;
  private generation = 0;
  private openUntil = 0;
  private probing = false;
  private rejected = 0;
  constructor(private readonly now = () => performance.now(), private readonly random = Math.random) {}

  acquire(): ((success?: boolean) => void) | null {
    if (this.probing || this.now() < this.openUntil) { this.rejected++; return null; }
    const probe = this.openUntil > 0;
    if (probe) this.probing = true;
    const generation = this.generation;
    let finished = false;
    return success => {
      if (finished) return;
      finished = true;
      if (generation !== this.generation) return;
      if (probe) this.probing = false;
      // A rejected RTDB claim or invalid itinerary is not a provider failure.
      if (success === undefined) return;
      if (success) { this.failures = 0; this.openings = 0; this.openUntil = 0; return; }
      this.failures++;
      if (probe || this.failures >= 5) {
        this.openings++;
        const ceiling = Math.min(300_000, 60_000 * 2 ** Math.min(10, this.openings - 1));
        this.openUntil = this.now() + ceiling * (0.5 + this.random() * 0.5);
        this.generation++;
      }
    };
  }

  snapshot() {
    return { failures: this.failures, rejected: this.rejected, probing: this.probing,
      retryAfterMs: Math.max(0, Math.ceil(this.openUntil - this.now())) };
  }
}
