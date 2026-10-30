import { publishedStopIndex } from "./publishedStopIndex";

/**
 * How passengers see each stop of the selected ride. `at` is the stop the bus
 * is at right now (acknowledged on arrival, before it departs); `unobserved`
 * is a stop the ride passed without the bus being seen there (GNSS gap or a
 * stop pinned off the travelled road), which must never read as an arrival.
 */
export type StopVisitState = "passed" | "unobserved" | "at" | "next" | "upcoming";

export interface StopProgress {
  states: StopVisitState[];
  atStopIndex?: number;
  /** The stop the bus will reach next, after the one it is at. */
  nextStopIndex?: number;
}

export interface StopProgressInput {
  currentStopIndex?: unknown;
  atStopIndex?: unknown;
  unobservedStopIndices?: unknown;
}

/** Backend progress only; proximity, ETA or the animated marker never mark a stop. */
export function stopProgress(stopCount: number, bus: StopProgressInput | undefined): StopProgress | undefined {
  const current = publishedStopIndex(bus?.currentStopIndex, stopCount);
  if (current === undefined) return undefined;
  const reported = publishedStopIndex(bus?.atStopIndex, stopCount);
  // The bus is at the stop it just reached, or still at the origin / already
  // at the terminal it is confirming. Anything else is a stale value.
  const at = reported !== undefined && (reported === current - 1 ||
    (reported === current && (current === 0 || current === stopCount - 1))) ? reported : undefined;
  const unobserved = new Set(Array.isArray(bus?.unobservedStopIndices)
    ? bus.unobservedStopIndices.filter((index): index is number => Number.isSafeInteger(index) && index >= 0 && index < current)
    : []);
  const next = at === current ? current + 1 : current;
  const states = Array.from({ length: stopCount }, (_, index): StopVisitState =>
    index === at ? "at"
      : index < current ? (unobserved.has(index) ? "unobserved" : "passed")
        : index === next ? "next" : "upcoming");
  return {
    states,
    ...(at !== undefined ? { atStopIndex: at } : {}),
    ...(next < stopCount ? { nextStopIndex: next } : {}),
  };
}

/** Behind the bus: dimmed on the map and timeline, never offered for boarding as upcoming. */
export function isBehindBus(state: StopVisitState | undefined): boolean {
  return state === "passed" || state === "unobserved";
}

export function stopVisitLabel(state: StopVisitState | undefined): string | undefined {
  switch (state) {
    case "passed": return "Passed";
    case "unobserved": return "Passed · not confirmed";
    case "at": return "Bus is here";
    default: return undefined;
  }
}
