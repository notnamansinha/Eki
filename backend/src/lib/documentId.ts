/**
 * Firestore rejects document IDs matching `__.*__` with INVALID_ARGUMENT on the
 * server. Validating them up front turns an admin typo into a 400 instead of a
 * persistence failure that looks retryable (an unknown-outcome 503).
 */
export const RESERVED_DOCUMENT_ID = /^__.*__$/;
const SAFE_DOCUMENT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** A caller-supplied ID that is safe to use as a Firestore document ID. */
export function isSafeDocumentId(value: unknown): value is string {
  return typeof value === "string" && SAFE_DOCUMENT_ID.test(value) && !RESERVED_DOCUMENT_ID.test(value);
}
