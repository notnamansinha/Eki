import { describe, expect, it } from "vitest";
import { recordDiagnosticRejection, recordDiagnosticSchema, telemetryDiagnosticCounters } from "./telemetryDiagnosticCounters";
describe("redacted telemetry diagnostic counters", () => {
  it("distinguishes timestamp rejection, dependency faults and legacy quality limitations without retaining inputs", () => {
    const before = telemetryDiagnosticCounters();
    recordDiagnosticRejection("stale_or_invalid_timestamp"); recordDiagnosticRejection("invalid_device_sent_at");
    recordDiagnosticRejection("dependency"); recordDiagnosticRejection("caller-secret-or-unbounded-reason");
    recordDiagnosticSchema({ gpsHdop: 1, seq: 1 }); recordDiagnosticSchema({ seq: 1 }); recordDiagnosticSchema({});
    const after = telemetryDiagnosticCounters();
    expect(after.rejectionReasons.timestamp - before.rejectionReasons.timestamp).toBe(2);
    expect(after.rejectionReasons.dependency - before.rejectionReasons.dependency).toBe(1);
    expect(after.rejectionReasons.payload - before.rejectionReasons.payload).toBe(1);
    for (const key of Object.keys(after.schemas) as Array<keyof typeof after.schemas>) {
      expect(after.schemas[key] - before.schemas[key]).toBe(1);
    }
    expect(JSON.stringify(after)).not.toContain("caller-secret");
    after.schemas.sequenced_hdop = -1;
    expect(telemetryDiagnosticCounters().schemas.sequenced_hdop).toBeGreaterThanOrEqual(1);
  });
});
