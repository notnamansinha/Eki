export type InstallPlatform =
  | "installed"
  | "ios-safari"
  | "ios-other"
  | "android"
  | "desktop";

type NavigatorLike = { userAgent: string; platform?: string; maxTouchPoints?: number };

/** Classify the visitor so the install page can show the right steps. */
export function detectInstallPlatform(nav: NavigatorLike, standalone: boolean): InstallPlatform {
  if (standalone) return "installed";
  const ua = nav.userAgent;
  // iPadOS 13+ reports as a Mac, so also look for touch support.
  const isIos = /iPhone|iPad|iPod/.test(ua) || (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
  if (isIos) {
    // Safari is the reliable path. Other browsers and in-app webviews either
    // show a different menu or none, so send them to Safari. Embedded
    // webviews carry no Safari token, so require it.
    const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA|FBAN|FBAV|Instagram/.test(ua);
    return !otherBrowser && /Safari\//.test(ua) ? "ios-safari" : "ios-other";
  }
  if (/Android/.test(ua)) return "android";
  return "desktop";
}
