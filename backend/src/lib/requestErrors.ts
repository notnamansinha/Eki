import type { ErrorRequestHandler, RequestHandler } from "express";
import { recordActiveSpanException } from "../instrumentation";

/**
 * Stable machine codes for the generic edge errors. Every JSON error body these
 * handlers write is `{ error, code }`, which satisfies both the OpenAPI
 * `Error` schema and the stricter `OperationError` schema (`error` and `code`
 * required, no other properties) that durable-operation routes document for
 * their 400, 404 and 409 responses.
 */
export const REQUEST_ERROR_CODES = {
  invalidJsonBody: "INVALID_JSON_BODY",
  invalidRequest: "INVALID_REQUEST",
  requestTooLarge: "REQUEST_TOO_LARGE",
  unsupportedEncoding: "UNSUPPORTED_ENCODING",
  notFound: "NOT_FOUND",
  methodNotAllowed: "METHOD_NOT_ALLOWED",
  internal: "INTERNAL_ERROR",
} as const;

/**
 * Client-caused request failures: body-parser marks its own 4xx errors as
 * exposable (unsupported charset or content encoding, corrupt compression,
 * aborted bodies), and the router tags undecodable path parameters as 400
 * URIErrors. Upstream SDK errors may also carry a `status`, so only these
 * markers make an error a client error; everything else stays an opaque 500.
 */
function clientErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as { type?: unknown; status?: unknown; expose?: unknown };
  if (candidate.type === "entity.too.large") return 413;
  if (candidate.type === "entity.parse.failed") return 400;
  const status = candidate.status;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 400 || status > 499) {
    return null;
  }
  return candidate.expose === true || (error instanceof URIError && status === 400) ? status : null;
}

const CLIENT_ERRORS: Record<number, { error: string; code: string }> = {
  413: { error: "Request body is too large.", code: REQUEST_ERROR_CODES.requestTooLarge },
  415: { error: "Unsupported request body encoding.", code: REQUEST_ERROR_CODES.unsupportedEncoding },
};

/** Unmatched paths and methods keep the documented `{ "error", "code" }` JSON shape. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found.", code: REQUEST_ERROR_CODES.notFound });
};

/**
 * Answers request-parsing failures with a fixed, generic JSON message so
 * malformed client input never reaches the 500 handler (which logs it as a
 * server fault) and never echoes parser internals back to the caller.
 */
export const clientRequestErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  const status = clientErrorStatus(error);
  if (status === null || res.headersSent) {
    next(error);
    return;
  }
  const parseFailed = (error as { type?: unknown }).type === "entity.parse.failed";
  res.status(status).json(parseFailed
    ? { error: "Invalid JSON body.", code: REQUEST_ERROR_CODES.invalidJsonBody }
    : CLIENT_ERRORS[status] ?? { error: "Invalid request.", code: REQUEST_ERROR_CODES.invalidRequest });
};

/** Last-resort handler: records the failure and never exposes its details. */
export const unhandledRequestErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  void _next;
  recordActiveSpanException(error);
  console.error("[Server] Unhandled request error:", error);
  res.status(500).json({ error: "Internal server error.", code: REQUEST_ERROR_CODES.internal });
};
