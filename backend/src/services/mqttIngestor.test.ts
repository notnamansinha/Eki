import { afterEach, describe, expect, it } from "vitest";
import { parseTelemetryTopic } from "./mqttIngestor";

describe("parseTelemetryTopic", () => {
  afterEach(() => {
    delete process.env.MQTT_TOPIC_PREFIX;
  });

  it("extracts a safe device ID from the configured telemetry namespace", () => {
    process.env.MQTT_TOPIC_PREFIX = "campus/telemetry";
    expect(parseTelemetryTopic("campus/telemetry/device_01")).toBe("device_01");
  });

  it("rejects extra levels, wildcards, and unsafe IDs", () => {
    expect(parseTelemetryTopic("eki/v1/telemetry/device/route")).toBeNull();
    expect(parseTelemetryTopic("eki/v1/telemetry/+")).toBeNull();
    expect(parseTelemetryTopic("eki/v1/telemetry/../admin")).toBeNull();
  });

  it("rejects a wildcard in the configured subscription prefix", () => {
    process.env.MQTT_TOPIC_PREFIX = "eki/+/telemetry";
    expect(() => parseTelemetryTopic("eki/x/telemetry/device_01")).toThrow(
      "unsafe MQTT topic characters",
    );
  });
});
