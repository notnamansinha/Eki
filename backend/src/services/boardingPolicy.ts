import { randomBytes, timingSafeEqual } from "node:crypto";

export const BOARDING_CODE_LENGTH = 8;
export const MAX_JOIN_FIX_AGE_MS = 60_000;
export const MAX_JOIN_FIX_FUTURE_MS = 10_000;
export const MAX_PASSENGER_ACCURACY_M = 100;
export const JOIN_RADIUS_M = 150;

const BOARDING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const BOARDING_CODE = new RegExp(`^[${BOARDING_ALPHABET}]{${BOARDING_CODE_LENGTH}}$`);

export interface RouteStop {
  id?: unknown;
}

export interface LiveBoardingProjection {
  sessionId?: unknown;
  busId?: unknown;
  routeId?: unknown;
  status?: unknown;
  deviceState?: unknown;
  motionState?: unknown;
  lat?: unknown;
  lng?: unknown;
  timestamp?: unknown;
}

export function normalizeBoardingCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.toUpperCase().replace(/[\s-]/g, "");
  return BOARDING_CODE.test(normalized) ? normalized : null;
}

export function generateBoardingCode(bytes = randomBytes(BOARDING_CODE_LENGTH)): string {
  if (bytes.length < BOARDING_CODE_LENGTH) {
    throw new Error("Insufficient randomness for a boarding code.");
  }
  // The alphabet has exactly 32 symbols, so byte % 32 introduces no modulo bias.
  return Array.from(bytes.subarray(0, BOARDING_CODE_LENGTH), (byte) =>
    BOARDING_ALPHABET[byte % BOARDING_ALPHABET.length]
  ).join("");
}

export function boardingCodesMatch(expected: unknown, candidate: unknown): boolean {
  const left = normalizeBoardingCode(expected);
  const right = normalizeBoardingCode(candidate);
  if (!left || !right) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function validateStopSelection(
  stops: unknown,
  boardingStopId: unknown,
  alightingStopId: unknown,
  direction: "forward" | "reverse" = "forward",
): { boardingStopId: string; alightingStopId: string } | null {
  if (!Array.isArray(stops) || stops.length < 2) return null;
  if (
    typeof boardingStopId !== "string" ||
    !SAFE_ID.test(boardingStopId)
  ) {
    return null;
  }
  if (typeof alightingStopId !== "string" || !SAFE_ID.test(alightingStopId)) {
    return null;
  }

  const stopIds = stops.map((stop: RouteStop) =>
    typeof stop?.id === "string" && SAFE_ID.test(stop.id) ? stop.id : null
  );
  if (direction === "reverse") stopIds.reverse();
  const boardingIndex = stopIds.indexOf(boardingStopId);
  const normalizedAlighting = alightingStopId;
  const alightingIndex = stopIds.indexOf(normalizedAlighting);
  if (
    boardingIndex < 0 ||
    alightingIndex <= boardingIndex
  ) {
    return null;
  }
  return { boardingStopId, alightingStopId: normalizedAlighting };
}

export function validateLiveBoardingProjection(
  live: LiveBoardingProjection | null,
  expected: { sessionId: string; busId: string; routeId: string },
  now = Date.now(),
): { lat: number; lng: number } | null {
  if (
    !live ||
    live.sessionId !== expected.sessionId ||
    live.busId !== expected.busId ||
    live.routeId !== expected.routeId ||
    live.status !== "active" ||
    live.deviceState === "offline" ||
    live.motionState === "uncertain"
  ) {
    return null;
  }
  const lat = Number(live.lat);
  const lng = Number(live.lng);
  const timestamp = Number(live.timestamp);
  if (
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lng) || lng < -180 || lng > 180 ||
    !Number.isFinite(timestamp) ||
    timestamp > now + MAX_JOIN_FIX_FUTURE_MS ||
    now - timestamp > MAX_JOIN_FIX_AGE_MS
  ) {
    return null;
  }
  return { lat, lng };
}

export function validatePassengerPosition(
  lat: unknown,
  lng: unknown,
  accuracy: unknown,
): { lat: number; lng: number; accuracy: number } | null {
  if (
    typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180 ||
    typeof accuracy !== "number" || !Number.isFinite(accuracy) ||
    accuracy < 0 || accuracy > MAX_PASSENGER_ACCURACY_M
  ) {
    return null;
  }
  return { lat, lng, accuracy };
}
