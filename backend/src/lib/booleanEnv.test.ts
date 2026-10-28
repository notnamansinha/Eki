import { describe, expect, it } from "vitest";
import { assertBooleanEnvConfiguration, readBooleanEnv } from "./booleanEnv";

describe("readBooleanEnv", () => {
  it("uses the default only when the variable is unset or blank", () => {
    expect(readBooleanEnv("FLAG", true, {})).toBe(true);
    expect(readBooleanEnv("FLAG", false, {})).toBe(false);
    expect(readBooleanEnv("FLAG", true, { FLAG: "  " })).toBe(true);
  });

  it("accepts trimmed, case-insensitive on and off spellings", () => {
    for (const value of ["false", "FALSE", "False", " false", "false\n", "0", "no", "off", "OFF"]) {
      expect(readBooleanEnv("FLAG", true, { FLAG: value }), value).toBe(false);
    }
    for (const value of ["true", "TRUE", " True ", "1", "yes", "on"]) {
      expect(readBooleanEnv("FLAG", false, { FLAG: value }), value).toBe(true);
    }
  });

  it("rejects unrecognized values by name without echoing them", () => {
    for (const value of ["flase", "disabled", "2", "-1", "nope"]) {
      expect(() => readBooleanEnv("WORKER_ENABLED", true, { WORKER_ENABLED: value })).toThrow(/^WORKER_ENABLED must be/);
      try { readBooleanEnv("WORKER_ENABLED", true, { WORKER_ENABLED: value }); } catch (error) {
        expect(String(error)).not.toContain(value);
      }
    }
  });

  it("validates every startup flag at boot", () => {
    expect(() => assertBooleanEnvConfiguration({})).not.toThrow();
    expect(() => assertBooleanEnvConfiguration({ WORKER_ENABLED: "FALSE", LIVE_DEPARTURE_ROUTES_ENABLED: "off" })).not.toThrow();
    expect(() => assertBooleanEnvConfiguration({ LIVE_DEPARTURE_ROUTES_ENABLED: "disabled" })).toThrow(/LIVE_DEPARTURE_ROUTES_ENABLED/);
    expect(() => assertBooleanEnvConfiguration({ WORKER_ENABLED: "flase" })).toThrow(/WORKER_ENABLED/);
  });
});
