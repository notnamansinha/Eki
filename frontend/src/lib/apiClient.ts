const API_TIMEOUT_MS = 10_000;

export type ApiRequestOptions = RequestInit & {
  fallbackError?: string;
  validateResponse?: (value: unknown) => boolean;
  timeoutMs?: number;
  onResponseStatus?: (status: number) => void;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number | null,
    readonly phase?: string,
    readonly outcomeUnknown = false,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function retryAfterHeaderMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) ? seconds * 1_000 : undefined;
  }
  const date = Date.parse(trimmed);
  return Number.isFinite(date) && /[A-Za-z]/.test(trimmed)
    ? Math.max(0, date - Date.now())
    : undefined;
}

function configuredBackendUrl(): string {
  const configured = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!configured) throw new Error("Backend URL is invalid or not configured.");
  try {
    const url = new URL(configured);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("invalid backend URL");
    }
    return url.href.replace(/\/+$/, "");
  } catch {
    throw new Error("Backend URL is invalid or not configured.");
  }
}

export async function apiRequest<T>(
  path: string,
  {
    fallbackError = "Request failed.",
    signal,
    timeoutMs = API_TIMEOUT_MS,
    onResponseStatus,
    validateResponse,
    ...init
  }: ApiRequestOptions = {},
): Promise<T> {
  const backendUrl = configuredBackendUrl();
  const headers = new Headers(init.headers);
  const hostname = new URL(backendUrl).hostname;
  // ngrok serves browser interstitials without API CORS headers unless this
  // documented programmatic-request header is present on its free endpoints.
  if ([".ngrok-free.dev", ".ngrok-free.app", ".ngrok.io"].some(suffix => hostname.endsWith(suffix))) {
    headers.set("ngrok-skip-browser-warning", "1");
  }

  const requestController = new AbortController();
  let abortSource: "caller" | "timeout" | null = null;
  const abortFromCaller = () => {
    if (requestController.signal.aborted) return;
    abortSource = "caller";
    requestController.abort(signal?.reason);
  };
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    if (requestController.signal.aborted) return;
    abortSource = "timeout";
    requestController.abort(new DOMException("Request timed out.", "TimeoutError"));
  }, timeoutMs);

  try {
    const response = await fetch(`${backendUrl}${path}`, {
      ...init,
      headers,
      signal: requestController.signal,
    });
    onResponseStatus?.(response.status);
    if (response.status === 204 && !validateResponse) return undefined as T;
    let result: T & { error?: unknown; code?: unknown; phase?: unknown; retryAfterMs?: unknown };
    try {
      result = await response.json() as T & { error?: unknown };
    } catch (error) {
      if (response.ok) {
        if (requestController.signal.aborted) throw error;
        throw new ApiError(
          "The backend returned an invalid response. Retry to reconcile the operation.",
          "INVALID_RESPONSE",
          response.status,
          "network",
          true,
        );
      }
      result = {} as T & { error?: string };
    }
    if (!response.ok) {
      if (!result || typeof result !== "object") result = {} as typeof result;
      const message = typeof result.error === "string" && result.error.trim()
        ? result.error
        : `${fallbackError} (HTTP ${response.status})`;
      throw new ApiError(
        message,
        typeof result.code === "string" ? result.code : "HTTP_ERROR",
        response.status,
        typeof result.phase === "string" ? result.phase : undefined,
        false,
        retryAfterHeaderMs(response.headers.get("Retry-After")) ??
          (typeof result.retryAfterMs === "number" && Number.isFinite(result.retryAfterMs) && result.retryAfterMs >= 0
            ? result.retryAfterMs
            : undefined),
      );
    }
    if (validateResponse && !validateResponse(result)) {
      throw new ApiError(
        "The backend did not confirm the operation. Retry to reconcile it.",
        "INVALID_ACKNOWLEDGEMENT", response.status, "network", true,
      );
    }
    return result;
  } catch (error) {
    if (abortSource === "timeout") {
      throw new ApiError(
        "The request timed out. The operation may still complete; retry to reconcile it.",
        "NETWORK_TIMEOUT",
        null,
        "network",
        true,
      );
    }
    if (error instanceof TypeError) {
      throw new ApiError(
        "The backend could not be reached. Check the connection and retry.",
        "BACKEND_UNAVAILABLE",
        null,
        "network",
        true,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export function isApiRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function acknowledgedField(value: unknown, field: "saved" | "deleted" | "stopped"): boolean {
  return isApiRecord(value) && value[field] === true;
}
