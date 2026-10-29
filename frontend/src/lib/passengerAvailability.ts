import { serverNow } from "./serverClock";
import { isLiveBusSignalLost, liveBusFreshnessTimestamp } from "./liveBusFreshness";
import { liveBusGnssLost } from "./liveBusHealth";

/**
 * New passenger selections require live telemetry with a trustworthy fix, not
 * just a durable ride: the backend boarding check rejects uncertain motion,
 * so the passenger UI must not offer what the server will refuse.
 */
export function isPassengerBusSelectable(bus: {
  deviceState?: unknown;
  motionState?: unknown;
  signalState?: unknown;
  timestamp?: unknown;
  backendReceivedAt?: unknown;
  automaticServicePaused?: unknown;
} | undefined, now = serverNow()): boolean {
  return Boolean(bus && bus.deviceState === "online" && bus.automaticServicePaused !== true &&
    !liveBusGnssLost(bus) && !isLiveBusSignalLost(liveBusFreshnessTimestamp(bus), now));
}
