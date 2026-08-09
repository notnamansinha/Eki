import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebaseAdmin";
import { authenticateDeviceCredentials } from "./deviceTelemetryService";

const DIAGNOSTIC_KEYS = [
  "firmwareVersion",
  "uptimeMs",
  "freeHeapBytes",
  "rssiDbm",
  "queueDepth",
  "queueHighWater",
  "queueOverflowDrops",
  "queueStaleDrops",
  "acceptedFixes",
  "rejectedFixes",
  "nmeaChecksumFailures",
  "uartBufferOverflows",
  "uartFifoOverflows",
  "resetTotal",
  "fault",
  "flashEncryption",
  "secureBoot",
  "timestamp",
] as const;

export interface DeviceDiagnosticsPayload {
  firmwareVersion: string;
  uptimeMs: number;
  freeHeapBytes: number;
  rssiDbm: number;
  queueDepth: number;
  queueHighWater: number;
  queueOverflowDrops: number;
  queueStaleDrops: number;
  acceptedFixes: number;
  rejectedFixes: number;
  nmeaChecksumFailures: number;
  uartBufferOverflows: number;
  uartFifoOverflows: number;
  resetTotal: number;
  fault: "none" | "wifi-recovery" | "credential-rejected";
  flashEncryption: boolean;
  secureBoot: boolean;
  timestamp: number;
}

type ParseResult =
  | { ok: true; value: DeviceDiagnosticsPayload }
  | { ok: false };

function isBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum;
}

export function parseDeviceDiagnosticsValue(value: unknown): ParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false };
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== DIAGNOSTIC_KEYS.length ||
    keys.some((key) => !(DIAGNOSTIC_KEYS as readonly string[]).includes(key))
  ) return { ok: false };

  const firmwareVersion = record.firmwareVersion;
  const fault = record.fault;
  if (
    typeof firmwareVersion !== "string" ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(firmwareVersion) ||
    !isBoundedInteger(record.uptimeMs, 0, 0xFFFFFFFF) ||
    !isBoundedInteger(record.freeHeapBytes, 0, 16 * 1024 * 1024) ||
    !isBoundedInteger(record.rssiDbm, -127, 0) ||
    !isBoundedInteger(record.queueDepth, 0, 10_000) ||
    !isBoundedInteger(record.queueHighWater, 0, 10_000) ||
    !isBoundedInteger(record.queueOverflowDrops, 0, 0xFFFFFFFF) ||
    !isBoundedInteger(record.queueStaleDrops, 0, 0xFFFFFFFF) ||
    !isBoundedInteger(record.acceptedFixes, 0, 0xFFFFFFFF) ||
    !isBoundedInteger(record.rejectedFixes, 0, 0xFFFFFFFF) ||
    !isBoundedInteger(record.nmeaChecksumFailures, 0, 0xFFFFFFFF) ||
    !isBoundedInteger(record.uartBufferOverflows, 0, 0xFFFFFFFF) ||
    !isBoundedInteger(record.uartFifoOverflows, 0, 0xFFFFFFFF) ||
    !isBoundedInteger(record.resetTotal, 0, 0xFFFF) ||
    (fault !== "none" &&
      fault !== "wifi-recovery" &&
      fault !== "credential-rejected") ||
    typeof record.flashEncryption !== "boolean" ||
    typeof record.secureBoot !== "boolean" ||
    !isBoundedInteger(record.timestamp, 1_700_000_000_000, 9_999_999_999_999)
  ) return { ok: false };

  return { ok: true, value: record as unknown as DeviceDiagnosticsPayload };
}

export async function ingestDeviceDiagnostics(
  deviceId: string,
  secret: string,
  diagnostics: DeviceDiagnosticsPayload,
  now = Date.now(),
): Promise<boolean> {
  const assignment = await authenticateDeviceCredentials(deviceId, secret, now);
  if (!assignment) return false;
  await db.collection("_device_diagnostics").doc(deviceId).set({
    ...diagnostics,
    deviceId,
    busId: assignment.busId,
    routeId: assignment.routeId,
    receivedAt: FieldValue.serverTimestamp(),
  });
  return true;
}
