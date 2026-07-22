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
  return typeof timestamp === "number" && Date.now() - timestamp < BUS_EXPIRY_MS;
}
