import { describe, expect, it } from "vitest";
import { parseFirmwareSequence, readFirmwareRelease } from "./firmwareRelease";

const VALID = {
  FIRMWARE_RELEASE_VERSION: "s12-gnss-v2.1.0",
  FIRMWARE_RELEASE_SEQUENCE: "12",
  FIRMWARE_RELEASE_URL: "https://releases.example.edu/eki/device-12.bin",
  FIRMWARE_RELEASE_SHA256: "ab".repeat(32),
  FIRMWARE_RELEASE_SIZE: "1500000",
};

describe("firmware release configuration", () => {
  it("is disabled only when every release field is absent", () => {
    expect(readFirmwareRelease({})).toEqual({ state: "disabled" });
    expect(readFirmwareRelease({ FIRMWARE_RELEASE_VERSION: "v2" })).toEqual({
      state: "invalid",
    });
  });

  it("normalizes a complete HTTPS descriptor", () => {
    expect(readFirmwareRelease(VALID)).toEqual({
      state: "ready",
      release: {
        version: "s12-gnss-v2.1.0",
        sequence: 12,
        url: "https://releases.example.edu/eki/device-12.bin",
        sha256: "ab".repeat(32),
        size: 1500000,
      },
    });
  });

  it.each([
    { ...VALID, FIRMWARE_RELEASE_URL: "http://releases.example.edu/image.bin" },
    { ...VALID, FIRMWARE_RELEASE_URL: "https://user:pass@example.edu/image.bin" },
    { ...VALID, FIRMWARE_RELEASE_SHA256: "not-a-digest" },
    { ...VALID, FIRMWARE_RELEASE_SEQUENCE: "0" },
    { ...VALID, FIRMWARE_RELEASE_SEQUENCE: "13" },
    { ...VALID, FIRMWARE_RELEASE_SIZE: String(0x1E0000 + 1) },
  ])("rejects unsafe or malformed metadata", (environment) => {
    expect(readFirmwareRelease(environment)).toEqual({ state: "invalid" });
  });
});

describe("firmware sequence parsing", () => {
  it("accepts a bounded non-negative integer", () => {
    expect(parseFirmwareSequence("0")).toBe(0);
    expect(parseFirmwareSequence("123")).toBe(123);
  });

  it.each([undefined, "", "-1", "1.2", "1e2", "99999999999"])(
    "rejects %s",
    (value) => expect(parseFirmwareSequence(value)).toBeNull(),
  );
});
