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
      resolve();
    };
    const timer = window.setTimeout(finish, ms);
    const abort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
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
  while (Date.now() < deadline) {
    const result = await request<SaveResponse>(
      `/api/routes/${encodeURIComponent(routeId)}/save-operations/${encodeURIComponent(saveId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal,
        fallbackError: "Unable to check the route save outcome.",
      },
    );
    if (completed(result)) return result;
    await pause(
      Math.min(Math.max(result.retryAfterMs ?? POLL_INTERVAL_MS, 250), 2_000),
      signal,
    );
  }
  throw new ApiError(
    "The route save is still being processed. Retry to reconcile it.",
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
