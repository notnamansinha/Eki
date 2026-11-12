import { isGoogleRedirectPending } from "@/lib/googleSignInFlow";

/**
 * When the root AuthProvider downloads and starts the Firebase Auth SDK.
 *
 * - `eager`: now. Workspaces need the verified account before they render, a
 *   returning account on the landing page must be sent to its workspace, and a
 *   Google redirect in progress must be completed.
 * - `on-intent`: the signed-out landing page. Sign-in stays available, but the
 *   SDK loads on the visitor's first interaction (or the sign-in tap itself),
 *   so it never competes with the landing page's own hydration (#522).
 * - `on-demand`: public pages that never use the account (`/install`, the 404
 *   shell). The SDK loads only when an action or a later route needs it.
 */
export type AuthLoadPolicy = "eager" | "on-intent" | "on-demand";

const WORKSPACE_ROUTES = ["/passenger", "/admin", "/feedback"] as const;

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function isWorkspacePath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return WORKSPACE_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
}

/**
 * Whether this browser probably holds a signed-in account. Firebase persists
 * the account in localStorage first, and Eki stores role hints and the last
 * workspace only for signed-in accounts (sign-out removes them). Storage that
 * cannot be read is treated as "maybe signed in" so the account is never left
 * unrestored.
 */
export function hasStoredSessionHint(apiKey: string | undefined): boolean {
  if (isGoogleRedirectPending(apiKey)) return true;
  try {
    const storage = window.localStorage;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key) continue;
      if (key.startsWith("firebase:authUser:") || key.startsWith("eki:role:") || key === "eki:last-workspace") {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

export function authLoadPolicy(
  pathname: string | null,
  hasSessionHint: () => boolean,
): AuthLoadPolicy {
  // No router context (tests, embedded renders): keep the original behaviour.
  if (pathname === null || isWorkspacePath(pathname)) return "eager";
  if (normalizePath(pathname) !== "/") return "on-demand";
  return hasSessionHint() ? "eager" : "on-intent";
}

/** First signs of a visitor about to use the page; any one starts sign-in loading. */
export const AUTH_INTENT_EVENTS = ["pointerdown", "pointermove", "touchstart", "keydown", "focusin", "wheel"] as const;
