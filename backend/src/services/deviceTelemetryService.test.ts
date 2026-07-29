import { describe, expect, it } from "vitest";
import {
  hashDeviceSecret,
  parseDeviceAuthorization,
  verifyDeviceSecretHash,
} from "./deviceTelemetryService";

describe("HTTPS device credentials", () => {
  it("accepts only a bounded Device authorization secret", () => {
    expect(parseDeviceAuthorization(undefined)).toBeNull();
    expect(parseDeviceAuthorization("Bearer something")).toBeNull();
    expect(parseDeviceAuthorization("Device too-short")).toBeNull();
    expect(
      parseDeviceAuthorization(`Device ${"a".repeat(20)}`),
    ).toBe("a".repeat(20));
    expect(
      parseDeviceAuthorization(`Device ${"a".repeat(513)}`),
    ).toBeNull();
  });

  it("creates a salted scrypt verifier without retaining the plain secret", async () => {
    const plainSecret = "demo-secret-with-enough-entropy";
    const first = await hashDeviceSecret(plainSecret);
    const second = await hashDeviceSecret(plainSecret);

    expect(first).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
    expect(second).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain(plainSecret);
    await expect(verifyDeviceSecretHash(plainSecret, first)).resolves.toBe(true);
    await expect(
      verifyDeviceSecretHash("different-secret-with-enough-entropy", first),
    ).resolves.toBe(false);
    await expect(
      verifyDeviceSecretHash(plainSecret, "malformed"),
    ).resolves.toBe(false);
  });
});
