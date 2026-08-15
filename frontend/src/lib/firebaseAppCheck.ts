import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  CustomProvider,
  getToken,
  type AppCheck,
} from "firebase/app-check";
import { firebaseApp } from "./firebaseCore";

let appCheck: AppCheck | null = null;

function initializeFirebaseAppCheck(): AppCheck | null {
  if (typeof window === "undefined" || appCheck) return appCheck;
  const debugToken = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN;
  const isDebug = process.env.NODE_ENV !== "production" && Boolean(debugToken);
  if (isDebug && debugToken) {
    (
      self as typeof self & {
        FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
      }
    ).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken === "true" ? true : debugToken;
  }
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (!siteKey && !isDebug) {
    if (process.env.NODE_ENV === "production") {
      console.error("[AppCheck] Production site key is not configured.");
    }
    return null;
  }
  const provider = siteKey
    ? new ReCaptchaEnterpriseProvider(siteKey)
    : new CustomProvider({
        getToken: () =>
          Promise.reject(new Error("AppCheck debug token active")),
      });
  appCheck = initializeAppCheck(firebaseApp, {
    provider,
    isTokenAutoRefreshEnabled: true,
  });
  return appCheck;
}

/**
 * Call this once from inside a useEffect (post-paint) rather than at module
 * evaluation time. Calling it multiple times is safe — the inner guard ensures
 * AppCheck is only initialized once.
 *
 * Returns a Promise<void> that resolves only after the first App Check token
 * has been obtained (or immediately when no provider is configured). This
 * lets callers await the promise before accessing protected Firebase resources.
 */
export async function ensureAppCheck(): Promise<void> {
  const instance = initializeFirebaseAppCheck();
  if (instance) {
    await getToken(instance);
  }
}
