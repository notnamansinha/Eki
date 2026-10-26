interface HistoryStop {
  id: string;
  name: string;
}

/**
 * currentStopIndex is the next expected stop while in service, and the terminal
 * stop at completion. Reconstruct every passed stop, including crossings that
 * advanced more than one index and checkpoints recovered after a restart.
 * Existing arrival records retain their original names and timestamps.
 */
export function missingStopHistory(
  stops: readonly HistoryStop[],
  tripState: string,
  currentStopIndex: number,
  existing: unknown,
  observedAt: unknown,
  previousStopIndex = currentStopIndex,
  skippedStopIndices: readonly number[] = [],
): Record<string, Record<string, unknown>> {
  if (
    stops.length === 0 ||
    !Number.isSafeInteger(currentStopIndex) ||
    currentStopIndex < 0 ||
    currentStopIndex >= stops.length ||
    (tripState !== "in_service" && tripState !== "completed")
  ) return {};

  const previous = existing && typeof existing === "object" && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : {};
  const lastReached = tripState === "completed"
    ? currentStopIndex
    : Math.max(0, currentStopIndex - 1);
  const additions: Record<string, Record<string, unknown>> = {};
  for (let index = 0; index <= lastReached; index += 1) {
    if (Object.prototype.hasOwnProperty.call(previous, String(index))) continue;
    additions[index] = {
      stopIndex: index,
      stopId: stops[index].id,
      stopName: stops[index].name,
      timestamp: observedAt,
      // Recovery time is not the original arrival time, and a stop skipped
      // during a GNSS gap was never observed. Keep both distinctions visible.
      evidence: skippedStopIndices.includes(index) ? "skipped_gnss_gap"
        : index < previousStopIndex ? "recovered_checkpoint" : "gnss_progress",
    };
  }
  return additions;
}
