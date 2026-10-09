const FIREBASE_HOSTING_DOMAINS = ["web.app", "firebaseapp.com"] as const;

/**
 * Firebase Auth's popup/redirect helper must be same-origin on Firebase
 * Hosting. Safari and other storage-partitioning browsers cannot recover the
 * helper state when a web.app deployment is configured with firebaseapp.com.
 */
export function resolveFirebaseAuthDomain(
  configuredAuthDomain: string | undefined,
  projectId: string | undefined,
  browserHostname: string | undefined,
): string | undefined {
  const configured = configuredAuthDomain?.trim() || undefined;
  const project = projectId?.trim().toLowerCase();
  const hostname = browserHostname?.trim().toLowerCase();

  if (
    project &&
    hostname &&
    FIREBASE_HOSTING_DOMAINS.some((domain) => hostname === `${project}.${domain}`)
  ) {
    return hostname;
  }

  return configured;
}
