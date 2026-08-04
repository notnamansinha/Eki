/** Shared backend domain types. */

export type MotionState = "moving" | "stopped" | "uncertain";
export type TripState = "pre_departure" | "in_service" | "completed";
export type LegacyTripState = TripState | "maintenance";
