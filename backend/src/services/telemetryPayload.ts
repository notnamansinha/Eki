export const TELEMETRY_FIELDS = [
  "heading",
  "lat",
  "lng",
  "motionState",
  "speed",
  "timestamp",
] as const;
export const OPTIONAL_TELEMETRY_FIELDS = ["hdop"] as const;

export interface TelemetryPayload {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  motionState: "moving" | "stopped" | "uncertain";
  timestamp: number;
  hdop?: number;
}

export type TelemetryParseResult =
  | { ok: true; value: TelemetryPayload }
  | { ok: false; reason: string };

const MOTION_STATES = new Set(["moving", "stopped", "uncertain"]);

export function parseTelemetryValue(
  value: unknown,
  now = Date.now(),
): TelemetryParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "invalid_shape" };
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const allowedFields = new Set<string>([
    ...TELEMETRY_FIELDS,
    ...OPTIONAL_TELEMETRY_FIELDS,
  ]);
  if (
    TELEMETRY_FIELDS.some((field) =>
      !Object.prototype.hasOwnProperty.call(record, field)) ||
    keys.some((key) => !allowedFields.has(key))
  ) {
    return { ok: false, reason: "unexpected_fields" };
  }

  const { lat, lng, speed, heading, motionState, timestamp, hdop } = record;
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { ok: false, reason: "invalid_lat" };
  }
  if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { ok: false, reason: "invalid_lng" };
  }
  if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 0 || speed > 200) {
    return { ok: false, reason: "invalid_speed" };
  }
  if (
    typeof heading !== "number" ||
    !Number.isFinite(heading) ||
    heading < 0 ||
    heading >= 360
  ) {
    return { ok: false, reason: "invalid_heading" };
  }
  if (typeof motionState !== "string" || !MOTION_STATES.has(motionState)) {
    return { ok: false, reason: "invalid_motion_state" };
  }
  if (
    hdop !== undefined &&
    (typeof hdop !== "number" || !Number.isFinite(hdop) || hdop < 0 || hdop > 50)
  ) {
    return { ok: false, reason: "invalid_hdop" };
  }
  if (
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < now - 60_000 ||
    timestamp > now + 10_000
  ) {
    return { ok: false, reason: "stale_or_invalid_timestamp" };
  }

  return {
    ok: true,
    value: {
      lat,
      lng,
      speed,
      heading,
      motionState: motionState as TelemetryPayload["motionState"],
      // Clamp accepted future timestamps to wall clock: a device clock a few
      // seconds ahead is allowed by the +10s window, but storing a future
      // timestamp poisons the engine's newness comparison and the stale sweep
      // (issue #48 L3).
      timestamp: Math.min(timestamp, now),
      ...(typeof hdop === "number" ? { hdop } : {}),
    },
  };
}

export function parseTelemetryPayload(
  payload: Buffer,
  now = Date.now(),
): TelemetryParseResult {
  if (payload.length === 0 || payload.length > 512) {
    return { ok: false, reason: "payload_size" };
  }

  try {
    return parseTelemetryValue(JSON.parse(payload.toString("utf8")), now);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}
