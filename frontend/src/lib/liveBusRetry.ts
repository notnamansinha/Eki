const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export function liveBusRetryDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(attempt, 5));
  return Math.min(MAX_RETRY_MS, INITIAL_RETRY_MS * (2 ** exponent));
}
