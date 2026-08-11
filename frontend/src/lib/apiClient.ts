const API_TIMEOUT_MS = 10_000;

type ApiRequestOptions = RequestInit & {
  fallbackError?: string;
};

export async function apiRequest<T>(
  path: string,
  { fallbackError = "Request failed.", signal, ...init }: ApiRequestOptions = {},
): Promise<T> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
  if (!backendUrl) throw new Error("Backend service is not configured.");

  const timeoutSignal = AbortSignal.timeout(API_TIMEOUT_MS);
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(`${backendUrl}${path}`, { ...init, signal: requestSignal });
  } catch (error) {
    if (timeoutSignal.aborted && !signal?.aborted) {
      throw new Error("The request timed out. Please try again.");
    }
    throw error;
  }

  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    throw new Error(result.error || `${fallbackError} (HTTP ${response.status})`);
  }
  return result;
}
