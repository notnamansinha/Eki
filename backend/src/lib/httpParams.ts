/**
 * Express 5 represents wildcard parameters as arrays. All current API routes
 * require one scalar identifier, so reject ambiguous values fail-closed.
 */
export function singlePathParam(value: unknown): string {
  return typeof value === "string" ? value : "";
}
