/**
 * authState.ts
 *
 * A lightweight promise that resolves the first time Firebase's
 * onAuthStateChanged fires. Firestore hooks await this before opening
 * listeners, preventing "Missing or insufficient permissions" races where
 * Firestore receives a read request before auth is established.
 */

let resolveAuthReady: () => void;

const authReadyPromise: Promise<void> = new Promise((resolve) => {
  resolveAuthReady = resolve;
});

let authHasFired = false;

/**
 * Called once by useAuth when onAuthStateChanged fires for the first time.
 * Idempotent — subsequent calls are no-ops.
 */
export function notifyAuthReady(): void {
  if (!authHasFired) {
    authHasFired = true;
    resolveAuthReady();
  }
}

/**
 * Await this before opening Firestore listeners to guarantee auth is resolved.
 * Resolves immediately if auth has already fired.
 */
export function waitForAuth(): Promise<void> {
  return authReadyPromise;
}
