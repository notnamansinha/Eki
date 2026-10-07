/**
 * authState.ts
 *
 * Await actual auth/role and App Check readiness before opening listeners.
 * Each auth change closes the gate again; a timeout never opens it.
 */

const verificationListeners = new Set<() => void>();

/** Synchronously revoke cached listener data before a new principal can subscribe. */
export function onAuthVerificationStarted(listener: () => void): () => void {
  verificationListeners.add(listener);
  return () => { verificationListeners.delete(listener); };
}

let ready = false;
let generation = 0;
let wake: () => void = () => {};
let changed = new Promise<void>(resolve => { wake = resolve; });

function signalChange() {
  const previous = wake;
  changed = new Promise<void>(resolve => { wake = resolve; });
  previous();
}

export function beginAuthVerification(): void {
  generation++;
  ready = false;
  verificationListeners.forEach(listener => listener());
  signalChange();
}

export function getAuthVerificationGeneration(): number { return generation; }

/**
 * Called after role and App Check verification, or confirmed sign-out.
 * Data hooks separately require a verified principal before subscribing.
 */
export function notifyAuthReady(): void {
  ready = true;
  signalChange();
}

/**
 * Wait through account changes until the current verification has completed.
 */
export async function waitForAuth(): Promise<void> {
  while (!ready) await changed;
}
