import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import { firebaseApp } from "./firebaseCore";

let appCheck: AppCheck | null = null;

export function initializeFirebaseAppCheck(): AppCheck | null {
  if (typeof window === "undefined" || appCheck) return appCheck;
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

export const firebaseAppCheck =
  typeof window === "undefined" ? null : initializeFirebaseAppCheck();
