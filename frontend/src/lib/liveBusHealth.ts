import { serverNow } from "./serverClock";
import {
  BUS_EXPIRY_MS,
  LIVE_DELAYED_MS,
  SIGNAL_LOST_MS,
  isLiveBusTimestamp,
  liveBusFreshnessTimestamp,
} from "./liveBusFreshness";

/**
 * One passenger-facing answer to "is this location live?", shared by the
 * header, map notice, marker, ETAs and boarding. Transport freshness (how long
 * since the backend received a packet) and GNSS validity (whether that packet
 * carried a trustworthy fix) are separate inputs; ride lifecycle is not one.
 */
export type LiveBusHealthState = "live" | "delayed" | "gnss_lost" | "lost" | "offline";

export interface LiveBusHealth {
  state: LiveBusHealthState;
  /** Server-timeline receipt of the latest packet, when known. */
  lastUpdateAt?: number;
  ageMs?: number;
}

export interface LiveBusHealthInput {
  deviceState?: unknown;
  motionState?: unknown;
  signalState?: unknown;
  timestamp?: unknown;
  backendReceivedAt?: unknown;
}

/**
 * The firmware sends one loss packet (last coordinates, HDOP 99, uncertain
 * motion) and then nothing until GNSS returns; the backend also marks a held
 * implausible jump uncertain. Either way the position cannot be trusted.
 */
export function liveBusGnssLost(bus: LiveBusHealthInput): boolean {
  return bus.signalState === "gnss_lost" || bus.motionState === "uncertain";
}

export function liveBusHealth(bus: LiveBusHealthInput, now = serverNow()): LiveBusHealth {
  const lastUpdateAt = liveBusFreshnessTimestamp(bus);
  // A receipt beyond the accepted clock skew has no meaningful age; never
  // render it as "just now" next to "lost".
  const ageMs = lastUpdateAt === undefined || !isLiveBusTimestamp(lastUpdateAt, now) ? undefined : Math.max(0, now - lastUpdateAt);
  const timing = { ...(lastUpdateAt !== undefined ? { lastUpdateAt } : {}), ...(ageMs !== undefined ? { ageMs } : {}) };
  if (bus.deviceState === "offline") return { state: "offline", ...timing };
  // The silence after a loss packet has a known cause: keep saying so.
  if (liveBusGnssLost(bus)) return { state: "gnss_lost", ...timing };
  if (lastUpdateAt === undefined || !isLiveBusTimestamp(lastUpdateAt, now) || now - lastUpdateAt > SIGNAL_LOST_MS) {
    return { state: "lost", ...timing };
  }
  return { state: now - lastUpdateAt > LIVE_DELAYED_MS ? "delayed" : "live", ...timing };
}

/**
 * When this bus's health can next change without any new data arriving, so a
 * single timer can degrade the UI exactly on time during silence.
 */
export function nextLiveBusHealthChangeAt(bus: LiveBusHealthInput, now = serverNow()): number | undefined {
  if (bus.deviceState === "offline") return undefined;
  const lastUpdateAt = liveBusFreshnessTimestamp(bus);
  if (lastUpdateAt === undefined) return undefined;
  return [lastUpdateAt + LIVE_DELAYED_MS + 1, lastUpdateAt + SIGNAL_LOST_MS + 1, lastUpdateAt + BUS_EXPIRY_MS]
    .find(deadline => deadline > now);
}

export function formatUpdateAge(ageMs: number | undefined): string {
  if (ageMs === undefined || !Number.isFinite(ageMs)) return "unknown";
  if (ageMs < 5_000) return "just now";
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)} s ago`;
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)} min ago`;
  return "over an hour ago";
}

export interface LiveBusHealthDescription {
  tone: "live" | "warning" | "danger";
  title: string;
  /** Full explanation for the ride card. */
  detail: string;
  /** One line for the map notice, which sits under the ride card. */
  summary: string;
}

/** Plain-language status. Silence alone cannot say which component failed. */
export function describeLiveBusHealth(health: LiveBusHealth): LiveBusHealthDescription {
  const age = formatUpdateAge(health.ageMs);
  switch (health.state) {
    case "live":
      return { tone: "live", title: "Live", detail: `Location updated ${age}.`, summary: `Updated ${age}` };
    case "delayed":
      return { tone: "warning", title: "Updates delayed", detail: `Last location update ${age}. ETAs may be late.`,
        summary: `Last update ${age} · ETAs may be late` };
    case "gnss_lost":
      return { tone: "warning", title: "GPS signal lost",
        detail: `The bus has no GPS fix. Showing its last known location (${age}); ETAs and boarding resume when GPS returns.`,
        summary: `Last known location ${age} · not live` };
    case "lost":
      return { tone: "danger", title: "Live tracking lost",
        detail: `Last location update ${age}. The bus is shown where it was last seen; it is not live.`,
        summary: `Last update ${age} · not live` };
    case "offline":
      return { tone: "danger", title: "Bus offline", detail: "This bus is not reporting. The last known location is not live.",
        summary: "Not reporting · not live" };
  }
}
