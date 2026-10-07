const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export function liveBusRetryDelayMs(attempt: number, random: () => number = Math.random): number {
  const normalizedAttempt = Number.isFinite(attempt)
    ? Math.max(0, Math.floor(attempt))
    : 0;
  const exponent = Math.min(normalizedAttempt, 5);
  const ceiling = Math.min(MAX_RETRY_MS, INITIAL_RETRY_MS * (2 ** exponent));
  const sample = random();
  const fraction = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0.5;
  // Equal jitter spreads independent clients over half the backoff window,
  // avoiding both synchronized retries and a zero-delay retry burst.
  return Math.floor(ceiling / 2 + ceiling / 2 * fraction);
}
