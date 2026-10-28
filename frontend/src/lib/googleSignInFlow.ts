const PENDING_REDIRECT_KEY = "eki:google-redirect-pending";

/** Mobile/PWA popups can lose their opener when Google returns to the app. */
export function prefersGoogleRedirect(authDomain: string | undefined): boolean {
  // Redirect recovery needs a same-origin helper to avoid partitioned storage.
  // Keep popups for local development and unconfigured custom domains.
  if (authDomain !== window.location.host) return false;

  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function markGoogleRedirectPending(): void {
  try {
    window.sessionStorage.setItem(PENDING_REDIRECT_KEY, "true");
  } catch {
    // Firebase reports unavailable redirect storage through its own error path.
  }
}

/** Whether this tab is returning from a Google redirect, without consuming the marker. */
export function isGoogleRedirectPending(): boolean {
  try {
    return window.sessionStorage.getItem(PENDING_REDIRECT_KEY) === "true";
  } catch {
    return false;
  }
}

export function consumeGoogleRedirectPending(): boolean {
  try {
    const pending = window.sessionStorage.getItem(PENDING_REDIRECT_KEY) === "true";
    window.sessionStorage.removeItem(PENDING_REDIRECT_KEY);
    return pending;
  } catch {
    return false;
  }
}
