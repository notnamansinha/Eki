import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import pino from "pino";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|credential|service.?account|private.?key|email|phone|latitude|longitude|\blat\b|\blng\b)/i;
// Redact the whole supplied value, including malformed token characters.
const BEARER_VALUE = /\bBearer\s+\S+/gi;
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

const UNREADABLE = "[UNREADABLE]";

/** Reads a property without letting a throwing getter escape the logger. */
function readProperty(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return UNREADABLE;
  }
}

function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return sanitizeString(value);
  // JSON.stringify throws on bigint; symbols and functions would be dropped silently.
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "[Function]";
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    const stack = readProperty(value, "stack");
    return {
      type: sanitizeString(String(readProperty(value, "name"))),
      message: sanitizeString(String(readProperty(value, "message"))),
      stack: typeof stack === "string" ? sanitizeString(stack) : undefined,
    };
  }
  if (depth >= MAX_DEPTH || seen.has(value)) return "[TRUNCATED]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map(item => sanitize(item, depth + 1, seen));
  }
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    output[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : sanitize(readProperty(value, key), depth + 1, seen);
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

function emit(level: LogLevel, message: string, details: unknown[]): void {
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

/** Logging must never throw back into the caller (often a catch block of a background task). */
function write(level: LogLevel, args: unknown[]): void {
  let message = "Application log";
  try {
    const messages = args.filter((argument): argument is string => typeof argument === "string");
    message = messages.map(sanitizeString).join(" ") || message;
    const details = args
      .filter(argument => typeof argument !== "string")
      .map(argument => sanitize(argument));
    emit(level, message, details);
  } catch {
    try {
      emit(level, message, ["[UNSERIALIZABLE]"]);
    } catch {
      // Drop the record rather than crash the process.
    }
  }
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
