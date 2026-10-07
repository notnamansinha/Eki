import { ApiError, apiRequest } from "./apiClient";

export const ROUTE_SAVE_TIMEOUT_MS = 30_000;
const RECONCILIATION_TIMEOUT_MS = 35_000;
const POLL_INTERVAL_MS = 750;

export interface RouteSaveResult {
  status: "succeeded";
  saved: true;
  saveId: string;
  routeId: string;
  configVersion: number;
  geometryVersion: number;
  geometryReused: boolean;
  polyline: string;
  distanceMeters: number;
  duration: string;
}

interface ProcessingResult {
  status: "processing";
  saveId: string;
  retryAfterMs?: number;
}

type SaveResponse = RouteSaveResult | ProcessingResult;
type Request = typeof apiRequest;

export function newRouteSaveId(): string {
  return crypto.randomUUID();
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      else resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function pollDelay(ms: number | undefined): number {
  const hint = typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? ms : POLL_INTERVAL_MS;
  return Math.min(Math.max(hint, 250), 2_000);
}

function retryablePollError(error: unknown): error is ApiError {
  if (!(error instanceof ApiError)) return false;
  if (error.status === null) return error.code === "NETWORK_TIMEOUT" || error.code === "BACKEND_UNAVAILABLE";
  if (error.status === 429) return true;
  // Stored route-save failures can also be 5xx. The legacy GET replays their
  // original code, whereas read and auth-capacity failures use distinct codes.
  // Generic HTTP_ERROR covers transient proxy/gateway 5xx without a backend payload.
  return error.status >= 500 && error.status <= 599 &&
    (error.code === "ROUTE_RECONCILIATION_FAILED" || error.code === "HTTP_ERROR" ||
      (error.status === 503 && error.code === "AUTH_BUSY"));
}

function completed(result: SaveResponse): result is RouteSaveResult {
  return result.status === "succeeded" &&
    result.saved === true &&
    typeof result.polyline === "string" &&
    Number.isSafeInteger(result.configVersion);
}

async function reconcile(
  routeId: string,
  saveId: string,
  token: string,
  signal: AbortSignal | undefined,
  request: Request,
): Promise<RouteSaveResult> {
  const deadline = Date.now() + RECONCILIATION_TIMEOUT_MS;
  while (true) {
    throwIfAborted(signal);
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    let delayMs: number;
    try {
      const result = await request<SaveResponse>(
        `/api/routes/${encodeURIComponent(routeId)}/save-operations/${encodeURIComponent(saveId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal,
          timeoutMs: Math.min(10_000, remaining),
          fallbackError: "Unable to check the route save outcome.",
        },
      );
      throwIfAborted(signal);
      if (Date.now() >= deadline) break;
      if (completed(result)) return result;
      delayMs = pollDelay(result.retryAfterMs);
    } catch (error) {
      throwIfAborted(signal);
      if (!retryablePollError(error)) throw error;
      delayMs = pollDelay(error.retryAfterMs);
    }
    const waitMs = Math.min(delayMs, deadline - Date.now());
    if (waitMs > 0) await pause(waitMs, signal);
  }
  throw new ApiError(
    "The route save outcome is still unknown. Retry to reconcile it.",
    "ROUTE_RECONCILIATION_TIMEOUT",
    null,
    "persistence",
    true,
  );
}

/** Save once, preserving the same operation ID across timeout reconciliation. */
export async function saveRoute(
  routeId: string,
  saveId: string,
  body: Record<string, unknown>,
  token: string,
  signal?: AbortSignal,
  request: Request = apiRequest,
): Promise<RouteSaveResult> {
  let initial: SaveResponse;
  try {
    initial = await request<SaveResponse>(`/api/routes/${encodeURIComponent(routeId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...body, saveId }),
      signal,
      timeoutMs: ROUTE_SAVE_TIMEOUT_MS,
      fallbackError: "The route was not saved.",
    });
  } catch (error) {
    if (!(error instanceof ApiError) || !error.outcomeUnknown) throw error;
    try {
      return await reconcile(routeId, saveId, token, signal, request);
    } catch (reconcileError) {
      if (!(reconcileError instanceof ApiError) || reconcileError.code !== "SAVE_OPERATION_NOT_FOUND") {
        throw reconcileError;
      }
      // The original request may have failed before reaching the backend.
      // One retry with the same operation ID is safe and cannot duplicate a commit.
      initial = await request<SaveResponse>(`/api/routes/${encodeURIComponent(routeId)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...body, saveId }),
        signal,
        timeoutMs: ROUTE_SAVE_TIMEOUT_MS,
      });
    }
  }
  if (completed(initial)) return initial;
  return reconcile(routeId, saveId, token, signal, request);
}
