import { randomUUID } from "node:crypto";
import { connect, type IClientOptions, type MqttClient, type IPublishPacket } from "mqtt";
import { db, rtdb } from "../lib/firebaseAdmin";
import { parseTelemetryPayload, type TelemetryPayload } from "./telemetryPayload";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const DEFAULT_PREFIX = "eki/v1/telemetry";
const DEVICE_CACHE_MS = 60_000;
const NEGATIVE_DEVICE_CACHE_MS = 10_000;
const MAX_DEVICE_CACHE_ENTRIES = 5_000;
const MAX_RATE_BUCKETS = 10_000;
const MAX_MESSAGES_PER_MINUTE = 30;
const MAX_GLOBAL_MESSAGES_PER_MINUTE = 10_000;

interface DeviceAssignment {
  busId: string;
  routeId: string;
}

interface DeviceCacheEntry {
  assignment: DeviceAssignment | null;
  expiresAt: number;
}

interface RateBucket {
  startedAt: number;
  count: number;
}

export interface MqttIngestStatus {
  configured: boolean;
  connected: boolean;
  lastConnectedAt: string | null;
  lastMessageAt: string | null;
  accepted: number;
  rejected: number;
}

const status: MqttIngestStatus = {
  configured: false,
  connected: false,
  lastConnectedAt: null,
  lastMessageAt: null,
  accepted: 0,
  rejected: 0,
};

const assignments = new Map<string, DeviceCacheEntry>();
const rateBuckets = new Map<string, RateBucket>();
const mostRecentTimestamp = new Map<string, number>();
let globalRateBucket: RateBucket = { startedAt: 0, count: 0 };
let mqttClient: MqttClient | null = null;

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function topicPrefix(): string {
  const prefix = (process.env.MQTT_TOPIC_PREFIX || DEFAULT_PREFIX).replace(/^\/+|\/+$/g, "");
  if (
    prefix.length > 128 ||
    !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(prefix)
  ) {
    throw new Error("MQTT_TOPIC_PREFIX contains unsafe MQTT topic characters.");
  }
  return prefix;
}

export function parseTelemetryTopic(topic: string): string | null {
  const prefix = topicPrefix();
  const match = topic.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([A-Za-z0-9_-]{1,128})$`));
  return match?.[1] ?? null;
}

function withinRateLimit(deviceId: string, now: number): boolean {
  const globalLimit = readPositiveInt(
    process.env.MQTT_GLOBAL_RATE_PER_MINUTE,
    MAX_GLOBAL_MESSAGES_PER_MINUTE,
  );
  if (now - globalRateBucket.startedAt >= 60_000) {
    globalRateBucket = { startedAt: now, count: 1 };
  } else {
    globalRateBucket.count += 1;
  }
  if (globalRateBucket.count > globalLimit) return false;

  const configuredLimit = readPositiveInt(
    process.env.MQTT_DEVICE_RATE_PER_MINUTE,
    MAX_MESSAGES_PER_MINUTE,
  );
  const current = rateBuckets.get(deviceId);
  if (!current || now - current.startedAt >= 60_000) {
    if (!current && rateBuckets.size >= MAX_RATE_BUCKETS) {
      for (const [key, bucket] of rateBuckets) {
        if (now - bucket.startedAt >= 60_000) rateBuckets.delete(key);
      }
      if (rateBuckets.size >= MAX_RATE_BUCKETS) return false;
    }
    rateBuckets.set(deviceId, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= configuredLimit;
}

async function loadAssignment(deviceId: string, now: number): Promise<DeviceAssignment | null> {
  const cached = assignments.get(deviceId);
  if (cached && cached.expiresAt > now) return cached.assignment;

  const deviceDoc = await db.collection("devices").doc(deviceId).get();
  const device = deviceDoc.data();
  if (!deviceDoc.exists || device?.enabled === false) {
    cacheAssignment(deviceId, null, now + NEGATIVE_DEVICE_CACHE_MS);
    return null;
  }

  const busId = typeof device?.busId === "string" ? device.busId : deviceId;
  const routeId = device?.routeId;
  if (!SAFE_ID.test(busId) || typeof routeId !== "string" || !SAFE_ID.test(routeId)) {
    cacheAssignment(deviceId, null, now + NEGATIVE_DEVICE_CACHE_MS);
    return null;
  }

  const busDoc = await db.collection("buses").doc(busId).get();
  const bus = busDoc.data();
  const assignedRoutes = Array.isArray(bus?.assignedRoutes)
    ? bus.assignedRoutes
    : typeof bus?.assignedRouteId === "string"
      ? [bus.assignedRouteId]
      : [];
  if (!busDoc.exists || !assignedRoutes.includes(routeId)) {
    cacheAssignment(deviceId, null, now + NEGATIVE_DEVICE_CACHE_MS);
    return null;
  }

  const assignment = { busId, routeId };
  cacheAssignment(deviceId, assignment, now + DEVICE_CACHE_MS);
  return assignment;
}

function cacheAssignment(
  deviceId: string,
  assignment: DeviceAssignment | null,
  expiresAt: number,
): void {
  if (!assignments.has(deviceId) && assignments.size >= MAX_DEVICE_CACHE_ENTRIES) {
    const oldestKey = assignments.keys().next().value;
    if (oldestKey) {
      assignments.delete(oldestKey);
      mostRecentTimestamp.delete(oldestKey);
    }
  }
  assignments.set(deviceId, { assignment, expiresAt });
}

async function persistTelemetry(
  assignment: DeviceAssignment,
  sample: TelemetryPayload,
): Promise<boolean> {
  const ref = rtdb.ref(`activeBuses/${assignment.busId}_${assignment.routeId}`);
  const transaction = await ref.transaction((current) => {
    const live = current as Record<string, unknown> | null;
    const existingTimestamp = Number(live?.timestamp);
    if (Number.isFinite(existingTimestamp) && existingTimestamp >= sample.timestamp) {
      return;
    }

    const cleanLive = { ...(live ?? {}) };
    delete cleanLive.lowAccuracy;
    delete cleanLive.satellites;
    delete cleanLive.hdop;
    delete cleanLive.altitude;
    delete cleanLive.meta;

    return {
      ...(live ? cleanLive : {
        busId: assignment.busId,
        routeId: assignment.routeId,
        status: "offline",
        deviceState: "online",
        tripState: "pre_departure",
        currentStopIndex: 0,
        hasDepartedOrigin: false,
        delayMinutes: 0,
      }),
      ...sample,
      busId: assignment.busId,
      routeId: assignment.routeId,
      deviceState: "online",
    };
  });
  return transaction.committed;
}

export async function handleTelemetryMessage(
  topic: string,
  payload: Buffer,
  packet: Pick<IPublishPacket, "qos" | "retain">,
  now = Date.now(),
): Promise<void> {
  status.lastMessageAt = new Date(now).toISOString();
  const deviceId = parseTelemetryTopic(topic);
  const parsed = parseTelemetryPayload(payload, now);

  if (!deviceId || packet.qos !== 1 || packet.retain || !parsed.ok) {
    status.rejected += 1;
    console.warn("[MQTT] Rejected telemetry", {
      deviceId,
      reason: !deviceId
        ? "topic"
        : packet.qos !== 1
          ? "qos"
          : packet.retain
            ? "retained"
            : parsed.ok
              ? "unknown"
              : parsed.reason,
    });
    return;
  }

  // QoS 1 is at-least-once. Drop same-process duplicates before charging the
  // rate bucket; the RTDB transaction below also deduplicates across restarts.
  if ((mostRecentTimestamp.get(deviceId) ?? 0) >= parsed.value.timestamp) return;
  if (!withinRateLimit(deviceId, now)) {
    status.rejected += 1;
    console.warn(`[MQTT] Device ${deviceId} exceeded its telemetry rate budget.`);
    return;
  }

  const assignment = await loadAssignment(deviceId, now);
  if (!assignment) {
    status.rejected += 1;
    console.warn(`[MQTT] Device ${deviceId} is disabled or has an invalid assignment.`);
    return;
  }

  if (await persistTelemetry(assignment, parsed.value)) {
    mostRecentTimestamp.set(deviceId, parsed.value.timestamp);
    status.accepted += 1;
  }
}

function mqttOptions(): IClientOptions {
  const brokerUrl = process.env.MQTT_BROKER_URL || "";
  if (process.env.NODE_ENV === "production") {
    if (!brokerUrl.startsWith("mqtts://")) {
      throw new Error("MQTT_BROKER_URL must use mqtts:// in production.");
    }
    if (
      !process.env.MQTT_CLIENT_ID ||
      !process.env.MQTT_USERNAME ||
      !process.env.MQTT_PASSWORD
    ) {
      throw new Error(
        "MQTT_CLIENT_ID, MQTT_USERNAME, and MQTT_PASSWORD are required in production.",
      );
    }
  }
  const ca = process.env.MQTT_CA_CERT?.replace(/\\n/g, "\n");
  return {
    clientId: process.env.MQTT_CLIENT_ID || `eki-ingestor-${randomUUID()}`,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    protocolVersion: 4,
    clean: false,
    keepalive: 30,
    reconnectPeriod: 2_000,
    connectTimeout: 10_000,
    rejectUnauthorized: true,
    ...(ca ? { ca } : {}),
  };
}

export function startMqttIngestor(): () => void {
  const brokerUrl = process.env.MQTT_BROKER_URL;
  if (!brokerUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MQTT_BROKER_URL is required in production.");
    }
    console.warn("[MQTT] MQTT_BROKER_URL is absent; telemetry ingestion is disabled.");
    return () => undefined;
  }
  if (mqttClient) return () => stopMqttIngestor();

  status.configured = true;
  mqttClient = connect(brokerUrl, mqttOptions());
  mqttClient.on("connect", () => {
    status.connected = true;
    status.lastConnectedAt = new Date().toISOString();
    const filter = `${topicPrefix()}/+`;
    mqttClient?.subscribe(filter, { qos: 1 }, (error, grants) => {
      if (error || !grants?.some((grant) => grant.qos === 1)) {
        console.error("[MQTT] QoS 1 subscription failed:", error ?? grants);
        mqttClient?.end(true);
        return;
      }
      console.log(`[MQTT] Subscribed with QoS 1 to ${filter}`);
    });
  });
  mqttClient.on("message", (topic, payload, packet) => {
    void handleTelemetryMessage(topic, payload, packet).catch((error) => {
      status.rejected += 1;
      console.error("[MQTT] Telemetry processing failed:", error);
    });
  });
  mqttClient.on("close", () => {
    status.connected = false;
  });
  mqttClient.on("error", (error) => {
    console.error("[MQTT] Broker connection error:", error.message);
  });

  return () => stopMqttIngestor();
}

export function stopMqttIngestor(): void {
  const client = mqttClient;
  mqttClient = null;
  status.connected = false;
  if (client) client.end(false);
}

export function getMqttIngestStatus(): MqttIngestStatus {
  return { ...status };
}
