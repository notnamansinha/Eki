import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("telemetry bootstrap in fresh processes", () => {
  for (const mode of ["disabled", "enabled"]) {
    it(`${mode}: lazy loading, parent sampling and loopback signal export`, () => {
      const child = spawnSync(process.execPath, ["--import", "tsx", resolve("test-fixtures/telemetry-smoke.cjs"), mode], {
        encoding: "utf8", timeout: 30_000,
        env: { ...process.env, OTEL_SDK_DISABLED: mode === "disabled" ? "true" : "false",
          OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:14318",
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://127.0.0.1:14318/v1/traces",
          OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "http://127.0.0.1:14318/v1/metrics",
          OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "http://127.0.0.1:14318/v1/logs",
          OTEL_EXPORTER_OTLP_HEADERS: "", OTEL_EXPORTER_OTLP_TRACES_HEADERS: "",
          OTEL_EXPORTER_OTLP_METRICS_HEADERS: "", OTEL_EXPORTER_OTLP_LOGS_HEADERS: "",
          OTEL_TRACES_SAMPLER: "parentbased_traceidratio", OTEL_TRACES_SAMPLER_ARG: "0",
          OTEL_RESOURCE_ATTRIBUTES: "", OTEL_NODE_RESOURCE_DETECTORS: "none",
        },
      });
      expect(child.status, child.stderr + child.stdout + String(child.error ?? "")).toBe(0);
      expect(child.stdout).toContain("R31 smoke passed");
    }, 35_000);
  }
});
