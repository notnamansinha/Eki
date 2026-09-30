import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";

let sdk: NodeSDK | null = null;

function hasOtlpEndpoint(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() ||
      env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim(),
  );
}

export function isTelemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OTEL_SDK_DISABLED?.trim().toLowerCase() !== "true" && hasOtlpEndpoint(env);
}

/** Removes request URL values that can contain user searches or identifiers. */
export function redactHttpSpanUrl(
  setAttribute: (key: string, value: string) => unknown,
): void {
  setAttribute("http.target", "/[redacted]");
  setAttribute("http.url", "[redacted]");
  setAttribute("url.full", "[redacted]");
  setAttribute("url.path", "/[redacted]");
  setAttribute("url.query", "");
}

/** Starts before application modules load so HTTP/Express patches are effective. */
export function startTelemetry(): boolean {
  if (sdk || !isTelemetryEnabled()) return Boolean(sdk);

  sdk = new NodeSDK({
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
      getNodeAutoInstrumentations({
        // File-system spans are high-volume and rarely useful for this API.
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-http": {
          // Keep load-balancer probes from drowning out actionable requests.
          ignoreIncomingRequestHook: request =>
            request.url?.split("?", 1)[0] === "/health",
          // URLs can contain free-form place searches, user/device IDs, or
          // other query values. Keep those out of exported HTTP spans.
          requestHook: span => redactHttpSpanUrl((key, value) => span.setAttribute(key, value)),
        },
        "@opentelemetry/instrumentation-pino": {
          disableLogCorrelation: false,
          // Application logs are emitted explicitly by lib/logger so every
          // console call is captured even across Pino major versions.
          disableLogSending: true,
        },
        "@opentelemetry/instrumentation-runtime-node": {
          monitoringPrecision: 5_000,
          captureUncaughtException: true,
        },
      }),
    ],
  });
  sdk.start();
  console.log("[OpenTelemetry] Traces, metrics, and logs enabled.");
  return true;
}

export async function shutdownTelemetry(): Promise<void> {
  const activeSdk = sdk;
  sdk = null;
  await activeSdk?.shutdown();
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Adds an exception to the current request span without changing app behavior. */
export function recordActiveSpanException(error: unknown): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  const exception = asError(error);
  span.recordException(exception);
  span.setStatus({ code: SpanStatusCode.ERROR, message: exception.message.slice(0, 500) });
}

/** Emits a bounded error span for failures that happen outside an HTTP request. */
export function recordBackgroundFailureSpan(
  source: string,
  label: string,
  error: unknown,
): void {
  const exception = asError(error);
  const span = trace.getTracer("eki-backend").startSpan("background.failure", {
    kind: SpanKind.INTERNAL,
    attributes: {
      "eki.failure.source": source,
      "eki.failure.label": label,
    },
  });
  span.recordException(exception);
  span.setStatus({ code: SpanStatusCode.ERROR, message: exception.message.slice(0, 500) });
  span.end();
}
