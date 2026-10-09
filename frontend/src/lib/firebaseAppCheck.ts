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
let tokenFlight: { startedAt: number; raw: ReturnType<typeof getToken> } | null = null;

export class AppCheckVerificationError extends Error {
  constructor() {
    super("Security verification is unavailable. Check App Check configuration and try again.");
    this.name = "AppCheckVerificationError";
  }
}

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
    // Console enforcement cannot be inferred from NODE_ENV. Local opt-out
    // requires an explicit setting and is never accepted in production.
    if (process.env.NODE_ENV === "development" &&
      process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DISABLED === "true") return null;
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
 * Browser production resolves only after a valid first App Check token.
 * Server calls and explicitly unenforced local development are no-ops.
 */
export async function browserAppCheckToken(options: { forceRefresh?: boolean } = {}): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const instance = initializeFirebaseAppCheck();
    if (!instance) return null;
    if (!tokenFlight) {
      const flight = { startedAt: performance.now(), raw: getToken(instance, options.forceRefresh === true) };
      tokenFlight = flight;
      void flight.raw.then(() => { if (tokenFlight === flight) tokenFlight = null; }, () => { if (tokenFlight === flight) tokenFlight = null; });
    }
    const flight = tokenFlight;
    const remaining = APP_CHECK_TOKEN_TIMEOUT_MS - (performance.now() - flight.startedAt);
    if (remaining <= 0) throw new Error("[AppCheck] Token acquisition deadline expired.");
    const tokenResult = await withTimeout(
      flight.raw,
      remaining,
      "App Check token acquisition timed out.",
    );
    const result = tokenResult as typeof tokenResult & { error?: unknown };
    if (!result.token || result.error || performance.now() - flight.startedAt >= APP_CHECK_TOKEN_TIMEOUT_MS) throw new Error("[AppCheck] Token acquisition failed.");
    return result.token;
  } catch {
    // Normalize provider, configuration and deadline failures without leaking
    // provider response/debug credential details into UI messages.
    throw new AppCheckVerificationError();
  }
}

export async function ensureAppCheck(options: { forceRefresh?: boolean } = {}): Promise<void> {
  await browserAppCheckToken(options);
}
