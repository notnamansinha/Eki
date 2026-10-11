import { GNSS_HDOP_MAX } from "../lib/telemetryMotion";

const rejectionReasons = { timestamp: 0, hdop: 0, credentials: 0, rate_limit: 0, payload: 0, dependency: 0 };
const schemas = { sequenced_hdop: 0, sequenced_without_hdop: 0, legacy_without_sequence: 0 };
const hdopQuality = { within_motion_threshold: 0, above_motion_threshold: 0, not_reported: 0 };
export function recordDiagnosticRejection(reason: string): void {
  const key = reason === "stale_or_invalid_timestamp" || reason === "invalid_device_sent_at"
    ? "timestamp" : reason === "invalid_gps_hdop" ? "hdop"
      : reason === "credentials" || reason === "rate_limit" || reason === "dependency"
      ? reason : "payload";
  rejectionReasons[key]++;
}
/** Call only after authentication and an accepted intake acknowledgement. */
export function recordDiagnosticSchema(body: Record<string, unknown>): void {
  schemas["gpsHdop" in body ? "sequenced_hdop" : "seq" in body ? "sequenced_without_hdop" : "legacy_without_sequence"]++;
  const hdop = body.gpsHdop;
  hdopQuality[typeof hdop === "number" && Number.isFinite(hdop)
    ? hdop <= GNSS_HDOP_MAX ? "within_motion_threshold" : "above_motion_threshold"
    : "not_reported"]++;
}
export function telemetryDiagnosticCounters() {
  return { scope: "process_since_start" as const, rejectionReasons: { ...rejectionReasons }, schemas: { ...schemas }, hdopQuality: { ...hdopQuality } };
}
