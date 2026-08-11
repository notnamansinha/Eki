const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export function liveBusRetryDelayMs(attempt: number): number {
  const normalizedAttempt = Number.isFinite(attempt)
    ? Math.max(0, Math.floor(attempt))
    : 0;
  const exponent = Math.min(normalizedAttempt, 5);
  return Math.min(MAX_RETRY_MS, INITIAL_RETRY_MS * (2 ** exponent));
}
