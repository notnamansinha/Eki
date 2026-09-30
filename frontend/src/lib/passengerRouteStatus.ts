import type { LiveRouteState } from "./activeBusEntries";

export function passengerRerouteNotice(states: readonly (LiveRouteState | undefined)[]): string | null {
  if (states.includes("REROUTING")) {
    return "The bus left the planned route. Updating the visible route now…";
  }
  if (states.includes("OFF_ROUTE") || states.includes("POSSIBLE_OFF_ROUTE")) {
    return "The bus may be off route. Live location remains available while routing recovers.";
  }
  return null;
}
