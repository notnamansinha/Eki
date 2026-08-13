/**
 * Rolling failure accounting for fire-and-forget background work (issue #38).
 *
 * `trackBackgroundTask` and `scheduleDurableRideRestore` used to degrade to a
 * `console.warn`, so a persistently failing durable write was invisible to
 * operators. This tracker keeps bounded per-source failure windows, exposes
 * them through /health, and escalates to an error-level alert once a source
 * crosses a sustained-failure threshold.
 *
 * Alerting fires once per episode (at the threshold crossing) and re-arms only
 * after the failing writes age out of the sliding window, so log-based
 * alerting does not page on every retry while still catching sustained
 * outages. The /health snapshot keeps reporting `sustained: true` for as long
 * as the source stays above the threshold, giving an external monitor a
 * continuous signal to page on.
 */

export interface BackgroundFailureSourceStats {
  label: string;
  totalFailures: number;
  /** Failures inside the current alert window (last `alertWindowMs`). */
  windowFailures: number;
  /** True when `windowFailures >= alertMinFailures`. */
  sustained: boolean;
  lastFailureAt: string | null;
  /** Message of the most recent failure (bounded to avoid unbounded memory). */
  lastMessage: string | null;
}

export interface BackgroundFailureSnapshot {
  totalFailures: number;
  /** Sources currently above the sustained-failure threshold. */
  sustainedSources: string[];
  sources: Record<string, BackgroundFailureSourceStats>;
}

export interface BackgroundFailureTrackerConfig {
  /** Failures inside the window that mark a source as sustained. */
  alertMinFailures: number;
  /** Sliding window over which failures are counted. */
  alertWindowMs: number;
  /** Bound on retained failure timestamps per source (prevents unbounded growth). */
  maxRecordedFailures: number;
  /** Bound on tracked sources (defensive; sources are compile-time constants). */
  maxSources: number;
}

const DEFAULT_CONFIG: BackgroundFailureTrackerConfig = {
  alertMinFailures: 5,
  alertWindowMs: 5 * 60_000,
  maxRecordedFailures: 200,
  maxSources: 32,
};

interface SourceState {
  label: string;
  /** Failure timestamps, oldest first, capped at maxRecordedFailures. */
  failures: number[];
  totalFailures: number;
  /** Survives window pruning so a recovered source still shows its last failure. */
  lastFailureAt: number | null;
  lastMessage: string | null;
  wasSustained: boolean;
}

export interface BackgroundFailureTracker {
  record: (source: string, label: string, message: string, now?: number) => void;
  snapshot: (now?: number) => BackgroundFailureSnapshot;
}

export function createBackgroundFailureTracker(
  config: Partial<BackgroundFailureTrackerConfig> = {},
): BackgroundFailureTracker {
  const { alertMinFailures, alertWindowMs, maxRecordedFailures, maxSources } = {
    ...DEFAULT_CONFIG,
    ...config,
  };
  const sources = new Map<string, SourceState>();

  /** Drops failures that aged out of the sliding window. */
  function prune(state: SourceState, now: number): void {
    const cutoff = now - alertWindowMs;
    let firstLive = 0;
    while (firstLive < state.failures.length && state.failures[firstLive] <= cutoff) {
      firstLive += 1;
    }
    if (firstLive > 0) {
      state.failures = state.failures.slice(firstLive);
    }
  }

  function windowFailures(state: SourceState, now: number): number {
    prune(state, now);
    return state.failures.length;
  }

  /**
   * Fires the sustained alert at the threshold crossing and re-arms after the
   * source recovers. Runs on both record and snapshot so an episode that ends
   * silently (no further failures) still re-arms before the next one begins.
   */
  function checkTransitions(source: string, state: SourceState, now: number): number {
    const count = windowFailures(state, now);
    if (count >= alertMinFailures && !state.wasSustained) {
      state.wasSustained = true;
      console.error(
        `[BackgroundFailures] SUSTAINED failure alert for ${source} (${state.label}): ` +
          `${count} failures in the last ${Math.round(alertWindowMs / 1000)}s. Last: ${state.lastMessage}`,
      );
    } else if (state.wasSustained && count < alertMinFailures) {
      state.wasSustained = false;
      console.warn(
        `[BackgroundFailures] ${source} (${state.label}) recovered: ` +
          `failure rate fell below ${alertMinFailures} in the alert window.`,
      );
    }
    return count;
  }

  function record(source: string, label: string, message: string, now = Date.now()): void {
    let state = sources.get(source);
    if (!state) {
      if (sources.size >= maxSources) {
        // Defensive eviction: drop the source that failed least recently.
        let oldestSource: string | null = null;
        let oldestAt = Number.POSITIVE_INFINITY;
        for (const [key, candidate] of sources) {
          const last = candidate.lastFailureAt ?? Number.NEGATIVE_INFINITY;
          if (last < oldestAt) {
            oldestAt = last;
            oldestSource = key;
          }
        }
        if (oldestSource) sources.delete(oldestSource);
      }
      state = { label, failures: [], totalFailures: 0, lastFailureAt: null, lastMessage: null, wasSustained: false };
      sources.set(source, state);
    }
    state.failures.push(now);
    if (state.failures.length > maxRecordedFailures) {
      state.failures.splice(0, state.failures.length - maxRecordedFailures);
    }
    state.totalFailures += 1;
    state.lastFailureAt = now;
    state.lastMessage = message.length > 500 ? `${message.slice(0, 500)}…` : message;

    checkTransitions(source, state, now);
  }

  function snapshot(now = Date.now()): BackgroundFailureSnapshot {
    const out: BackgroundFailureSnapshot = {
      totalFailures: 0,
      sustainedSources: [],
      sources: {},
    };
    for (const [source, state] of sources) {
      const count = checkTransitions(source, state, now);
      out.totalFailures += state.totalFailures;
      const stats: BackgroundFailureSourceStats = {
        label: state.label,
        totalFailures: state.totalFailures,
        windowFailures: count,
        sustained: count >= alertMinFailures,
        lastFailureAt:
          state.lastFailureAt !== null ? new Date(state.lastFailureAt).toISOString() : null,
        lastMessage: state.lastMessage,
      };
      out.sources[source] = stats;
      if (stats.sustained) out.sustainedSources.push(source);
    }
    return out;
  }

  return { record, snapshot };
}

/**
 * Records a background failure and keeps the immediate per-failure warn log
 * so the operator still sees the concrete error context at the call site.
 */
export function recordBackgroundFailure(
  source: string,
  label: string,
  message: string,
  error: unknown,
): void {
  console.warn(message, error);
  backgroundFailures.record(source, label, message);
}

/** Process-wide tracker used by the trip-state engine and telemetry service. */
export const backgroundFailures = createBackgroundFailureTracker();
