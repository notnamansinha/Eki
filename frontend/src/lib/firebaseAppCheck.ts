import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import { firebaseApp } from "./firebaseCore";

let appCheck: AppCheck | null = null;

function initializeFirebaseAppCheck(): AppCheck | null {
  if (typeof window === "undefined" || appCheck) return appCheck;
  const debugToken = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN;
  if (process.env.NODE_ENV !== "production" && debugToken) {
    (
      self as typeof self & {
        FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
      }
    ).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken === "true" ? true : debugToken;
  }
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (!siteKey) {
    if (process.env.NODE_ENV === "production") {
      console.error("[AppCheck] Production site key is not configured.");
    }
    return null;
  }
  appCheck = initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
  return appCheck;
}

/**
 * Call this once from inside a useEffect (post-paint) rather than at module
 * evaluation time. Calling it multiple times is safe — the inner guard ensures
 * AppCheck is only initialized once.
 */
export function ensureAppCheck(): void {
  initializeFirebaseAppCheck();
}
