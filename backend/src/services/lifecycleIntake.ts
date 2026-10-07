/** Every field consumed by the lifecycle engine, including same-fix lifecycle changes. */
const FIELDS = ["busId", "routeId", "driverId", "sessionId", "status", "tripState", "timestamp", "seq", "lat", "lng",
  "deviceState", "motionState", "direction", "currentStopIndex", "hasDepartedOrigin", "originStopId", "destinationStopId",
  "delayMinutes", "delayUpdatedAt", "turnaroundClaimId", "turnaroundEligibleAt", "turnaroundSampledAt"] as const;
export function lifecycleIntakeFingerprint(value: unknown): string {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return JSON.stringify(FIELDS.map(field => data[field] ?? null));
}
