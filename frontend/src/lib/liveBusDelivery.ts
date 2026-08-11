export type LiveBusDeliverySource =
  | "listener"
  | "cache"
  | "expiry"
  | "invalidation";

/**
 * Only a Firebase listener delivery proves that the current RTDB connection
 * has produced an authoritative snapshot. Cache replays and local lifecycle
 * updates may update the UI, but must not clear the reconnect indicator.
 */
export function isAuthoritativeLiveBusDelivery(
  source: LiveBusDeliverySource,
): boolean {
  return source === "listener";
}
