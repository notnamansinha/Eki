const PROD_BUS_EXPIRY_MS = 300_000;
const DEV_BUS_EXPIRY_MS = 90_000;

function readPositiveMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export const BUS_EXPIRY_MS =
  readPositiveMs(process.env.NEXT_PUBLIC_BUS_EXPIRY_MS) ??
  (process.env.NODE_ENV === "production" ? PROD_BUS_EXPIRY_MS : DEV_BUS_EXPIRY_MS);

export const SIGNAL_LOST_MS = Math.min(90_000, Math.floor(BUS_EXPIRY_MS / 2));

export function isLiveBusTimestamp(timestamp?: number): boolean {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return false;
  const age = Date.now() - timestamp;
  // Reject future timestamps (allow max 10s forward clock skew for IoT NTP drift),
  // and reject stale timestamps older than BUS_EXPIRY_MS.
  return age >= -10_000 && age < BUS_EXPIRY_MS;
}

export function hasValidBusCoordinates(lat?: number, lng?: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat! >= -90 && lat! <= 90 && lng! >= -180 && lng! <= 180;
}
