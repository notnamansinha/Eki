import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";

import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { GrpcInstrumentation } from "@opentelemetry/instrumentation-grpc";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { redactHttpSpanUrl } from "./instrumentation";

/** Loaded only when enabled; awaited before any application dependencies. */
export function createTelemetrySdk(): NodeSDK {
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME?.trim() || "eki-backend",
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: 30_000,
        exportTimeoutMillis: 10_000,
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter(),
        scheduledDelayMillis: 2_000,
        exportTimeoutMillis: 10_000,
        maxQueueSize: 2_048,
        maxExportBatchSize: 512,
      }),
    ],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: request =>
          ["/health", "/live"].includes(request.url?.split("?", 1)[0] ?? ""),
        requestHook: span => redactHttpSpanUrl((key, value) => span.setAttribute(key, value)),
      }),
      new ExpressInstrumentation(),
      new GrpcInstrumentation(),
      new UndiciInstrumentation(),
      new PinoInstrumentation({ disableLogCorrelation: false, disableLogSending: true }),
      new RuntimeNodeInstrumentation({ monitoringPrecision: 5_000, captureUncaughtException: true }),
    ],
  });
  sdk.start();
  return sdk;
}
