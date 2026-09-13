const API_TIMEOUT_MS = 10_000;

type ApiRequestOptions = RequestInit & {
  fallbackError?: string;
  timeoutMs?: number;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number | null,
    readonly phase?: string,
    readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
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
    if (response.status === 204) return undefined as T;
    let result: T & { error?: unknown; code?: unknown; phase?: unknown };
    try {
      result = await response.json() as T & { error?: unknown };
    } catch (error) {
      if (response.ok) throw error;
      result = {} as T & { error?: string };
    }
    if (!response.ok) {
      const message = typeof result.error === "string" && result.error.trim()
        ? result.error
        : `${fallbackError} (HTTP ${response.status})`;
      throw new ApiError(
        message,
        typeof result.code === "string" ? result.code : "HTTP_ERROR",
        response.status,
        typeof result.phase === "string" ? result.phase : undefined,
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
