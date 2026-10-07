import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import type { NodeSDK } from "@opentelemetry/sdk-node";

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

let starting: Promise<boolean> | null = null;

/** Default root sampling is 10%; respect explicit standard SDK overrides. */
export function configureTraceSampling(env: NodeJS.ProcessEnv = process.env): void {
  if (env.OTEL_TRACES_SAMPLER?.trim()) return;
  env.OTEL_TRACES_SAMPLER = "parentbased_traceidratio";
  env.OTEL_TRACES_SAMPLER_ARG = "0.1";
}

/** Must be awaited before application modules load. Concurrent starts share a fill. */
export function startTelemetry(): Promise<boolean> {
  if (sdk) return Promise.resolve(true);
  if (starting) return starting;
  if (!isTelemetryEnabled()) return Promise.resolve(false);
  configureTraceSampling();
  starting = import("./telemetrySdk").then(({ createTelemetrySdk }) => {
    sdk = createTelemetrySdk();
    console.log("[OpenTelemetry] Traces, metrics, and logs enabled.");
    return true;
  }).finally(() => { starting = null; });
  return starting;
}

export async function shutdownTelemetry(): Promise<void> {
  await starting;
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
