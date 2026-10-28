import { serverNow } from "./serverClock";
import { isLiveBusSignalLost, liveBusFreshnessTimestamp } from "./liveBusFreshness";

/** New passenger selections require live telemetry, not just a durable ride. */
export function isPassengerBusSelectable(bus: {
  deviceState?: unknown;
  timestamp?: unknown;
  backendReceivedAt?: unknown;
  automaticServicePaused?: unknown;
} | undefined, now = serverNow()): boolean {
  return Boolean(bus && bus.deviceState === "online" && bus.automaticServicePaused !== true &&
    !isLiveBusSignalLost(liveBusFreshnessTimestamp(bus), now));
}
