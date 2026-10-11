import { describe, expect, it } from "vitest";
import { recordDiagnosticRejection, recordDiagnosticSchema, telemetryDiagnosticCounters } from "./telemetryDiagnosticCounters";
describe("redacted telemetry diagnostic counters", () => {
  it("distinguishes timestamp rejection, dependency faults and legacy quality limitations without retaining inputs", () => {
    const before = telemetryDiagnosticCounters();
    recordDiagnosticRejection("stale_or_invalid_timestamp"); recordDiagnosticRejection("invalid_device_sent_at");
    recordDiagnosticRejection("dependency"); recordDiagnosticRejection("invalid_gps_hdop");
    recordDiagnosticRejection("caller-secret-or-unbounded-reason");
    recordDiagnosticSchema({ gpsHdop: 1, seq: 1 }); recordDiagnosticSchema({ gpsHdop: 5, seq: 2 });
    recordDiagnosticSchema({ seq: 1 }); recordDiagnosticSchema({});
    const after = telemetryDiagnosticCounters();
    expect(after.rejectionReasons.timestamp - before.rejectionReasons.timestamp).toBe(2);
    expect(after.rejectionReasons.dependency - before.rejectionReasons.dependency).toBe(1);
    expect(after.rejectionReasons.hdop - before.rejectionReasons.hdop).toBe(1);
    expect(after.rejectionReasons.payload - before.rejectionReasons.payload).toBe(1);
    expect(after.schemas.sequenced_hdop - before.schemas.sequenced_hdop).toBe(2);
    expect(after.schemas.sequenced_without_hdop - before.schemas.sequenced_without_hdop).toBe(1);
    expect(after.schemas.legacy_without_sequence - before.schemas.legacy_without_sequence).toBe(1);
    expect(after.hdopQuality.within_motion_threshold - before.hdopQuality.within_motion_threshold).toBe(1);
    expect(after.hdopQuality.above_motion_threshold - before.hdopQuality.above_motion_threshold).toBe(1);
    expect(after.hdopQuality.not_reported - before.hdopQuality.not_reported).toBe(2);
    expect(JSON.stringify(after)).not.toContain("caller-secret");
    after.schemas.sequenced_hdop = -1;
    expect(telemetryDiagnosticCounters().schemas.sequenced_hdop).toBeGreaterThanOrEqual(1);
  });
});
