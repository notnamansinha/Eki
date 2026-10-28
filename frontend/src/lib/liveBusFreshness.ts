import { serverNow } from "./serverClock";

const DEFAULT_BUS_EXPIRY_MS = 300_000;

function readPositiveMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export const BUS_EXPIRY_MS =
  readPositiveMs(process.env.NEXT_PUBLIC_BUS_EXPIRY_MS) ??
  DEFAULT_BUS_EXPIRY_MS;

export const SIGNAL_LOST_MS = Math.min(90_000, Math.floor(BUS_EXPIRY_MS / 2));

/** Transport freshness uses server receipt; sample time still orders GPS fixes. */
export function liveBusFreshnessTimestamp(bus: {
  timestamp?: unknown;
  backendReceivedAt?: unknown;
}): number | undefined {
  const sample = typeof bus.timestamp === "number" ? bus.timestamp : undefined;
  const received = bus.backendReceivedAt;
  // Only use a receipt paired with a sample inside the backend's accepted skew window.
  if (typeof received === "number" && Number.isFinite(received) && sample !== undefined &&
      received - sample >= -10_000 && received - sample <= 60_000) return received;
  return sample;
}

/**
 * `now` defaults to the server timeline (`serverNow()`), because freshness
 * timestamps are server receipts; a skewed viewer clock must not hide buses.
 */
export function isLiveBusTimestamp(
  timestamp?: number,
  now = serverNow(),
): boolean {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return false;
  const age = now - timestamp;
  // Reject future timestamps beyond 10 s (server-offset estimate error and
  // legacy entries that only carry a device sample time), and reject stale
  // timestamps older than BUS_EXPIRY_MS.
  return age >= -10_000 && age < BUS_EXPIRY_MS;
}

export function isLiveBusSignalLost(
  timestamp?: number,
  now = serverNow(),
): boolean {
  if (typeof timestamp !== "number" || !isLiveBusTimestamp(timestamp, now)) {
    return true;
  }
  return now - timestamp > SIGNAL_LOST_MS;
}

export function hasValidBusCoordinates(lat?: number, lng?: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat! >= -90 && lat! <= 90 && lng! >= -180 && lng! <= 180;
}
