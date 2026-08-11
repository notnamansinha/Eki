export const DRIVER_SHIFT_UPDATE_STATE_KEY = "eki:driver-shift-update-state";
export const DRIVER_SHIFT_UPDATE_EVENT = "eki:driver-shift-update-state-change";

export type DriverShiftUpdateState = "checking" | "active" | "inactive";

export function setDriverShiftUpdateState(state: DriverShiftUpdateState): void {
  window.localStorage.setItem(DRIVER_SHIFT_UPDATE_STATE_KEY, state);
  window.dispatchEvent(new CustomEvent(DRIVER_SHIFT_UPDATE_EVENT, { detail: state }));
}

export function canActivateServiceWorker(): boolean {
  const state = window.localStorage.getItem(DRIVER_SHIFT_UPDATE_STATE_KEY);
  return state !== "checking" && state !== "active";
}
