export const TELEMETRY_FIELDS = [
  "deviceSentAt",
  "gpsHdop",
  "heading",
  "lat",
  "lng",
  "motionState",
  "seq",
  "speed",
  "timestamp",
] as const;

export const PREVIOUS_SEQUENCED_TELEMETRY_FIELDS = [
  "deviceSentAt",
  "heading",
  "lat",
  "lng",
  "motionState",
  "seq",
  "speed",
  "timestamp",
] as const;

// Keep the immediately previous firmware contract during the staged fleet
// rollout. It remains closed and strictly validated; remove this compatibility
// path only after diagnostics confirm every device sends the sequenced schema.
export const LEGACY_TELEMETRY_FIELDS = [
  "heading",
  "lat",
  "lng",
  "motionState",
  "speed",
  "timestamp",
] as const;

export interface TelemetryPayload {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  gpsHdop: number | null;
  motionState: "moving" | "stopped" | "uncertain";
  /** Monotonic within one retained firmware queue lifetime. */
  seq: number;
  /** Device wall-clock time immediately before the current HTTP attempt. */
  deviceSentAt: number;
  /** GNSS sample capture time; kept as `timestamp` for live-client compatibility. */
  timestamp: number;
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
  const matchesFields = (fields: readonly string[]) =>
    keys.length === fields.length &&
    keys.every((key, index) => key === fields[index]);
  const usesSequencedSchema = matchesFields(TELEMETRY_FIELDS);
  const usesPreviousSequencedSchema = matchesFields(
    PREVIOUS_SEQUENCED_TELEMETRY_FIELDS,
  );
  const usesLegacySchema = matchesFields(LEGACY_TELEMETRY_FIELDS);
  if (!usesSequencedSchema && !usesPreviousSequencedSchema && !usesLegacySchema) {
    return { ok: false, reason: "unexpected_fields" };
  }

  const { lat, lng, speed, heading, gpsHdop, motionState, seq, deviceSentAt, timestamp } = record;
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
  if (
    usesSequencedSchema &&
    (typeof gpsHdop !== "number" ||
      !Number.isFinite(gpsHdop) ||
      gpsHdop < 0 ||
      gpsHdop > 99)
  ) {
    return { ok: false, reason: "invalid_gps_hdop" };
  }
  if (typeof motionState !== "string" || !MOTION_STATES.has(motionState)) {
    return { ok: false, reason: "invalid_motion_state" };
  }
  if ((usesSequencedSchema || usesPreviousSequencedSchema) && (
    typeof seq !== "number" ||
    !Number.isSafeInteger(seq) ||
    seq <= 0 ||
    seq > 0xffff_ffff
  )) {
    return { ok: false, reason: "invalid_sequence" };
  }
  if (
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < now - 60_000 ||
    timestamp > now + 10_000
  ) {
    return { ok: false, reason: "stale_or_invalid_timestamp" };
  }
  if ((usesSequencedSchema || usesPreviousSequencedSchema) && (
    typeof deviceSentAt !== "number" ||
    !Number.isSafeInteger(deviceSentAt) ||
    deviceSentAt < timestamp ||
    deviceSentAt > now + 10_000
  )) {
    return { ok: false, reason: "invalid_device_sent_at" };
  }

  const acceptedTimestamp = Math.min(timestamp, now);
  const acceptedDeviceSentAt = usesSequencedSchema || usesPreviousSequencedSchema
    ? Math.min(deviceSentAt as number, now)
    : acceptedTimestamp;

  return {
    ok: true,
    value: {
      lat,
      lng,
      speed,
      heading,
      gpsHdop: usesSequencedSchema ? gpsHdop as number : null,
      motionState: motionState as TelemetryPayload["motionState"],
      seq: usesSequencedSchema || usesPreviousSequencedSchema ? seq as number : 1,
      deviceSentAt: acceptedDeviceSentAt,
      // Clamp accepted future timestamps to wall clock: a device clock a few
      // seconds ahead is allowed by the +10s window, but storing a future
      // timestamp poisons the engine's newness comparison and the stale sweep
      // (issue #48 L3).
      timestamp: acceptedTimestamp,
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
