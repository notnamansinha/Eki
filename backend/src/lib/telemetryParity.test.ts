import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GNSS_ERROR_MAX_M,
  GNSS_ERROR_MIN_M,
  GNSS_HDOP_MAX,
  GNSS_STATIONARY_SPEED_KMH,
  TELEMETRY_MAX_TRANSITION_GAP_MS,
  TELEMETRY_REACQUIRE_AFTER_MS,
} from "./telemetryMotion";

const firmwarePolicy = readFileSync(
  resolve(__dirname, "../../../hardware/include/telemetry_policy.h"),
  "utf8",
);

function firmwareConstant(name: string): number {
  const match = firmwarePolicy.match(
    new RegExp(`constexpr (?:double|uint32_t) ${name} = ([^;]+);`),
  );
  if (!match) throw new Error(`Missing firmware telemetry constant: ${name}`);
  return match[1]
    .replace(/UL/g, "")
    .split("*")
    .map((term) => Number(term.trim()))
    .reduce((product, term) => product * term, 1);
}

describe("backend/firmware adaptive telemetry parity", () => {
  it("keeps shared envelope constants aligned", () => {
    expect(firmwareConstant("GNSS_ERROR_MIN_M")).toBe(GNSS_ERROR_MIN_M);
    expect(firmwareConstant("GNSS_ERROR_MAX_M")).toBe(GNSS_ERROR_MAX_M);
    expect(firmwareConstant("GNSS_STATIONARY_SPEED_KMH")).toBe(GNSS_STATIONARY_SPEED_KMH);
    expect(firmwareConstant("GNSS_HDOP_MAX")).toBe(GNSS_HDOP_MAX);
    expect(firmwareConstant("GNSS_MAX_TRANSITION_GAP_MS")).toBe(TELEMETRY_MAX_TRANSITION_GAP_MS);
    expect(firmwareConstant("GNSS_REACQUIRE_AFTER_MS")).toBe(TELEMETRY_REACQUIRE_AFTER_MS);
  });

  it("keeps the shared formula terms present in firmware", () => {
    expect(firmwarePolicy).toContain("hdop * 7.0");
    expect(firmwarePolicy).toContain("? 10.0");
    expect(firmwarePolicy).toContain("elapsedMs > 10000");
    expect(firmwarePolicy).toContain("hdopError +");
  });

  it("documents the intentional backend-only accuracy override", () => {
    // accuracyMeters is an optional backend input; firmware only reports HDOP.
    expect(firmwarePolicy).not.toContain("accuracyMeters");
  });
});
