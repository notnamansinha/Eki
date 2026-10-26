import { isLiveBusSignalLost, liveBusFreshnessTimestamp } from "./liveBusFreshness";

/** New passenger selections require live telemetry, not just a durable ride. */
export function isPassengerBusSelectable(bus: {
  deviceState?: unknown;
  timestamp?: unknown;
  backendReceivedAt?: unknown;
  automaticServicePaused?: unknown;
} | undefined, now = Date.now()): boolean {
  return Boolean(bus && bus.deviceState === "online" && bus.automaticServicePaused !== true &&
    !isLiveBusSignalLost(liveBusFreshnessTimestamp(bus), now));
}
