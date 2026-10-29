const PENDING_REDIRECT_KEY = "eki:google-redirect-pending";
// Firebase Auth's own session flag for this app (the default Firebase app).
const firebasePendingRedirectKey = (apiKey: string) => `firebase:pendingRedirect:${apiKey}:[DEFAULT]`;

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
export function isGoogleRedirectPending(apiKey?: string): boolean {
  try {
    const storage = window.sessionStorage;
    if (storage.getItem(PENDING_REDIRECT_KEY) === "true") return true;
    // Our marker is consumed when Back from Google restores this page, but the
    // user can still go Forward and finish. Firebase keeps its own flag until
    // the redirect result is read.
    return apiKey !== undefined && storage.getItem(firebasePendingRedirectKey(apiKey)) === '"true"';
  } catch {
    return false;
  }
}

/**
 * A redirect that failed before leaving the page has nothing to complete.
 * Firebase flags it pending before validating the origin over the network,
 * so a flaky network would otherwise slow the next reopen with Google's iframe.
 */
export function abandonGoogleRedirect(apiKey: string | undefined): void {
  consumeGoogleRedirectPending();
  if (apiKey === undefined) return;
  try {
    window.sessionStorage.removeItem(firebasePendingRedirectKey(apiKey));
  } catch {
    // Blocked storage holds no flag to clear.
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
