import {
  CustomProvider,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  getToken,
  type AppCheck,
} from "firebase/app-check";
import { firebaseApp } from "./firebaseCore";
import { withTimeout } from "./promiseTimeout";

let appCheck: AppCheck | null = null;
const APP_CHECK_TOKEN_TIMEOUT_MS = 10_000;

function debugOnlyProvider(): CustomProvider {
  return new CustomProvider({
    // Firebase uses the debug token exchange before calling the provider. This
    // guard makes an accidental non-debug use fail closed instead of issuing a
    // token through an unintended attestation path.
    getToken: async () => {
      throw new Error("[AppCheck] Debug provider was used outside debug mode.");
    },
  });
}

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
    throw new Error("[AppCheck] reCAPTCHA Enterprise site key is not configured.");
  }
  const provider = siteKey ? new ReCaptchaEnterpriseProvider(siteKey) : debugOnlyProvider();
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
 * Returns a Promise<void> that resolves only after a valid first App Check
 * token has been obtained. Callers can await it before accessing protected
 * Firebase resources.
 */
export async function ensureAppCheck(): Promise<void> {
  const instance = initializeFirebaseAppCheck();
  if (!instance) {
    throw new Error("[AppCheck] Cannot initialize outside the browser.");
  }
  const tokenResult = await withTimeout(
    getToken(instance),
    APP_CHECK_TOKEN_TIMEOUT_MS,
    "App Check token acquisition timed out.",
  );
  const result = tokenResult as typeof tokenResult & { error?: unknown };
  if (!result.token || result.error) {
    throw new Error("[AppCheck] Token acquisition failed.");
  }
}
