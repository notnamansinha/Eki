const rejectionReasons = { timestamp: 0, credentials: 0, rate_limit: 0, payload: 0, dependency: 0 };
const schemas = { sequenced_hdop: 0, sequenced_without_hdop: 0, legacy_without_sequence: 0 };
export function recordDiagnosticRejection(reason: string): void {
  const key = reason === "stale_or_invalid_timestamp" || reason === "invalid_device_sent_at"
    ? "timestamp" : reason === "credentials" || reason === "rate_limit" || reason === "dependency"
      ? reason : "payload";
  rejectionReasons[key]++;
}
/** Call only after authentication and an accepted intake acknowledgement. */
export function recordDiagnosticSchema(body: Record<string, unknown>): void {
  schemas["gpsHdop" in body ? "sequenced_hdop" : "seq" in body ? "sequenced_without_hdop" : "legacy_without_sequence"]++;
}
export function telemetryDiagnosticCounters() {
  return { scope: "process_since_start" as const, rejectionReasons: { ...rejectionReasons }, schemas: { ...schemas } };
}
