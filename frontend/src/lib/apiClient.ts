const API_TIMEOUT_MS = 10_000;

type ApiRequestOptions = RequestInit & {
  fallbackError?: string;
};

function configuredBackendUrl(): string {
  const configured = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!configured) throw new Error("Backend service is not configured.");
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
    throw new Error("Backend service is not configured.");
  }
}

export async function apiRequest<T>(
  path: string,
  { fallbackError = "Request failed.", signal, ...init }: ApiRequestOptions = {},
): Promise<T> {
  const backendUrl = configuredBackendUrl();

  const timeoutSignal = AbortSignal.timeout(API_TIMEOUT_MS);
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  try {
    const response = await fetch(`${backendUrl}${path}`, { ...init, signal: requestSignal });
    let result: T & { error?: string };
    try {
      result = await response.json() as T & { error?: string };
    } catch (error) {
      if (response.ok) throw error;
      result = {} as T & { error?: string };
    }
    if (!response.ok) {
      throw new Error(result.error || `${fallbackError} (HTTP ${response.status})`);
    }
    return result;
  } catch (error) {
    if (timeoutSignal.aborted && !signal?.aborted) {
      throw new Error("The request timed out. Please try again.");
    }
    throw error;
  }
}
