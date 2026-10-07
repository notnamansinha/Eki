import { describe, expect, it } from "vitest";
import { configureTraceSampling, isTelemetryEnabled, redactHttpSpanUrl } from "./instrumentation";

describe("OpenTelemetry configuration", () => {
  it("defaults root traces to ten percent and respects explicit sampler policy", () => {
    const env: NodeJS.ProcessEnv = {};
    configureTraceSampling(env);
    expect(env).toEqual({ OTEL_TRACES_SAMPLER: "parentbased_traceidratio", OTEL_TRACES_SAMPLER_ARG: "0.1" });
    const explicit = { OTEL_TRACES_SAMPLER: "always_on", OTEL_TRACES_SAMPLER_ARG: "1" };
    configureTraceSampling(explicit);
    expect(explicit).toEqual({ OTEL_TRACES_SAMPLER: "always_on", OTEL_TRACES_SAMPLER_ARG: "1" });
  });
  it("stays disabled when no OTLP endpoint is configured", () => {
    expect(isTelemetryEnabled({})).toBe(false);
  });

  it("accepts either the shared or trace-specific OTLP endpoint", () => {
    expect(isTelemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" }))
      .toBe(true);
    expect(isTelemetryEnabled({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://collector:4318/v1/traces",
    })).toBe(true);
  });

  it("honors the SDK kill switch", () => {
    expect(isTelemetryEnabled({
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
      OTEL_SDK_DISABLED: " TRUE ",
    })).toBe(false);
  });

  it("redacts HTTP URL attributes before exporting spans", () => {
    const attributes: Record<string, string> = {};
    redactHttpSpanUrl((key, value) => {
      attributes[key] = value;
    });

    expect(attributes).toEqual({
      "http.target": "/[redacted]",
      "http.url": "[redacted]",
      "url.full": "[redacted]",
      "url.path": "/[redacted]",
      "url.query": "",
    });
  });
});
