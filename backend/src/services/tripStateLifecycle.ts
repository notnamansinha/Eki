export interface NormalizedLiveBusData extends Record<string, any> {
  busId: string;
  routeId: string;
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;

export function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return SAFE_IDENTIFIER.test(normalized) ? normalized : null;
}

export function normalizeLiveBusData(
  value: unknown,
  nodeKey?: string | null,
): NormalizedLiveBusData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, any>;
  let busId = normalizeIdentifier(data.busId);
  let routeId = normalizeIdentifier(data.routeId);

  // An underscore is valid inside either identifier, so the key alone cannot
  // be split safely. Derive only one missing ID when the other proves an exact
  // key prefix or suffix.
  if (nodeKey && busId && !routeId) {
    const prefix = `${busId}_`;
    if (nodeKey.startsWith(prefix)) {
      routeId = normalizeIdentifier(nodeKey.slice(prefix.length));
    }
  } else if (nodeKey && routeId && !busId) {
    const suffix = `_${routeId}`;
    if (nodeKey.endsWith(suffix)) {
      busId = normalizeIdentifier(nodeKey.slice(0, -suffix.length));
    }
  }
  if (!busId || !routeId) return null;
  if (data.busId === busId && data.routeId === routeId) {
    return data as NormalizedLiveBusData;
  }
  return { ...data, busId, routeId };
}

function settleWithinDeadline(
  promises: Promise<unknown>[],
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(completed);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    void Promise.allSettled(promises).then(() => finish(true));
  });
}

/**
 * Drains promise collections that may gain follow-up work while earlier tasks
 * settle. Two consecutive empty microtask turns prevent a just-resumed handler
 * from enqueueing work after shutdown has already declared the queues empty.
 */
export async function drainDynamicPromises(
  getPending: () => Iterable<Promise<unknown>>,
  deadlineMs: number,
): Promise<boolean> {
  let emptyPasses = 0;
  while (Date.now() < deadlineMs) {
    const pending = Array.from(new Set(getPending()));
    if (pending.length === 0) {
      emptyPasses += 1;
      if (emptyPasses >= 2) return true;
      await Promise.resolve();
      continue;
    }

    emptyPasses = 0;
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) return false;
    if (!(await settleWithinDeadline(pending, remainingMs))) return false;
  }
  return false;
}
