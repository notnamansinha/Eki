import { createHash } from "node:crypto";

export type RouteSaveOperationStatus = "processing" | "succeeded" | "failed";

export interface RouteSaveOperationRecord {
  payloadHash?: unknown;
  status?: unknown;
  leaseUntil?: unknown;
  result?: unknown;
  error?: unknown;
  httpStatus?: unknown;
}

export type RouteSaveOperationDecision =
  | { kind: "claim" }
  | { kind: "processing" }
  | { kind: "replay"; result: unknown }
  | { kind: "failed"; error: unknown; httpStatus: number }
  | { kind: "conflict" };

export function routeSavePayloadHash(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function routeDocumentVersion(route: Record<string, unknown> | undefined): number {
  const version = route?.configVersion;
  return Number.isSafeInteger(version) && Number(version) >= 0 ? Number(version) : 0;
}

export function routeGeometryVersion(route: Record<string, unknown> | undefined): number {
  const version = route?.geometryVersion;
  return Number.isSafeInteger(version) && Number(version) >= 0 ? Number(version) : 0;
}

/** Pure decision used inside the Firestore claim transaction. */
export function decideRouteSaveOperation(
  operation: RouteSaveOperationRecord | undefined,
  payloadHash: string,
  now: number,
): RouteSaveOperationDecision {
  if (!operation) return { kind: "claim" };
  if (operation.payloadHash !== payloadHash) return { kind: "conflict" };
  if (operation.status === "succeeded") {
    return { kind: "replay", result: operation.result };
  }
  if (operation.status === "failed") {
    return {
      kind: "failed",
      error: operation.error,
      httpStatus: Number.isInteger(operation.httpStatus)
        ? Number(operation.httpStatus)
        : 409,
    };
  }
  if (
    operation.status === "processing" &&
    Number.isFinite(operation.leaseUntil) &&
    Number(operation.leaseUntil) > now
  ) {
    return { kind: "processing" };
  }
  return { kind: "claim" };
}
