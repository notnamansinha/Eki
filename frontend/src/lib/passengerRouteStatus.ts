import type { LiveRouteState } from "./activeBusEntries";

/**
 * Only a confirmed deviation is news to a passenger. POSSIBLE_OFF_ROUTE also
 * covers an ambiguous match at a junction or beside a parallel carriageway,
 * where announcing "off route" flapped on and off in the 29 Oct 2026 field
 * ride while the bus stayed on its road; the marker shows that uncertainty.
 */
export function passengerRerouteNotice(states: readonly (LiveRouteState | undefined)[]): string | null {
  if (states.includes("REROUTING")) {
    return "The bus left the planned route. Updating the visible route now…";
  }
  if (states.includes("OFF_ROUTE")) {
    return "The bus has left the planned route. Live location remains available while routing recovers.";
  }
  return null;
}
