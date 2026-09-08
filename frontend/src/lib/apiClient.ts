const API_TIMEOUT_MS = 10_000;

/** Route-geometry saves issue two Google routing calls plus a Firestore write. */
export const ROUTE_SAVE_TIMEOUT_MS = 30_000;

export type ApiRequestPhase =
  | "validation"
  | "routing"
  | "persistence"
  | "timeout";

/**
 * Typed API error carrying the failure phase so callers (especially the route
 * editor) can render a distinct, truthful message per cause (#149 p9).
 */
export class ApiRequestError extends Error {
  readonly phase?: ApiRequestPhase;
  readonly status?: number;

  constructor(message: string, options: { phase?: ApiRequestPhase; status?: number } = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.phase = options.phase;
    this.status = options.status;
  }
}

type ApiRequestOptions = RequestInit & {
  fallbackError?: string;
  timeoutMs?: number;
};

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
  { fallbackError = "Request failed.", timeoutMs = API_TIMEOUT_MS, signal, ...init }: ApiRequestOptions = {},
): Promise<T> {
  const backendUrl = configuredBackendUrl();

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
      signal: requestController.signal,
    });
    if (response.status === 204) return undefined as T;
    let result: T & { error?: unknown; phase?: unknown };
    try {
      result = await response.json() as T & { error?: unknown; phase?: unknown };
    } catch (error) {
      if (response.ok) throw error;
      result = {} as T & { error?: string; phase?: unknown };
    }
    if (!response.ok) {
      const message = typeof result.error === "string" && result.error.trim()
        ? result.error
        : `${fallbackError} (HTTP ${response.status})`;
      const phase =
        result.phase === "validation" || result.phase === "routing" || result.phase === "persistence"
          ? result.phase
          : undefined;
      throw new ApiRequestError(message, { phase, status: response.status });
    }
    return result;
  } catch (error) {
    if (abortSource === "timeout") {
      throw new ApiRequestError("The request timed out. Please try again.", { phase: "timeout" });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
