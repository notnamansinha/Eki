import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import pino from "pino";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|credential|service.?account|private.?key|email|phone|latitude|longitude|\blat\b|\blng\b)/i;
const BEARER_VALUE = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const GRAFANA_TOKEN = /glc_[A-Za-z0-9_-]+/gi;
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 25;
const MAX_STRING_LENGTH = 2_000;

function sanitizeString(value: string): string {
  const redacted = value
    .replace(BEARER_VALUE, "Bearer [REDACTED]")
    .replace(GRAFANA_TOKEN, REDACTED);
  return redacted.length > MAX_STRING_LENGTH
    ? `${redacted.slice(0, MAX_STRING_LENGTH)}...`
    : redacted;
}

function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return {
      type: value.name,
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }
  if (depth >= MAX_DEPTH || seen.has(value)) return "[TRUNCATED]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map(item => sanitize(item, depth + 1, seen));
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitize(item, depth + 1, seen);
  }
  return output;
}

const destination = pino({
  level: process.env.LOG_LEVEL?.trim() || "info",
  base: undefined,
  messageKey: "message",
  timestamp: pino.stdTimeFunctions.isoTime,
});
const otelLogger = logs.getLogger("eki-backend");

type LogLevel = "debug" | "info" | "warn" | "error";

const severityNumbers: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

function write(level: LogLevel, args: unknown[]): void {
  const messages: string[] = [];
  const details: unknown[] = [];
  for (const argument of args) {
    if (typeof argument === "string") messages.push(sanitizeString(argument));
    else details.push(sanitize(argument));
  }
  const message = messages.join(" ") || "Application log";
  otelLogger.emit({
    severityNumber: severityNumbers[level],
    severityText: level.toUpperCase(),
    body: message,
    attributes:
      details.length > 0 ? { "log.details": JSON.stringify(details) } : undefined,
  });
  if (details.length > 0) destination[level]({ details }, message);
  else destination[level](message);
}

let installed = false;

/** Routes existing console calls through structured Pino + OpenTelemetry logs. */
export function installConsoleBridge(): void {
  if (installed) return;
  installed = true;
  console.debug = (...args: unknown[]) => write("debug", args);
  console.info = (...args: unknown[]) => write("info", args);
  console.log = (...args: unknown[]) => write("info", args);
  console.warn = (...args: unknown[]) => write("warn", args);
  console.error = (...args: unknown[]) => write("error", args);
}

export const logger = {
  debug: (...args: unknown[]) => write("debug", args),
  info: (...args: unknown[]) => write("info", args),
  warn: (...args: unknown[]) => write("warn", args),
  error: (...args: unknown[]) => write("error", args),
};
