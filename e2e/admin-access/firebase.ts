// Synthetic SDK adapter; actual useAuth and firebaseAppCheck remain under test.
export const firebaseApp = {};
const account = (uid: string) => ({ uid, email: `${uid}@example.test`, displayName: uid,
  photoURL: null, isAnonymous: false, getIdToken: async () => `token-${uid}`,
  getIdTokenResult: async () => ({ claims: { role: "admin", admin: true } }),
});
type User = ReturnType<typeof account>;
export const auth = { currentUser: account("qa-admin") as User | null };
export const googleProvider = {};
const observers = new Set<(user: User | null) => void>();
export function onAuthStateChanged(_auth: unknown, callback: (user: User | null) => void) {
  observers.add(callback); queueMicrotask(() => callback(auth.currentUser));
  return () => { observers.delete(callback); };
}
export const browserLocalPersistence = {};
export async function setPersistence() {}
export async function getRedirectResult() { return null; }
export async function signInWithPopup() {}
export async function signInWithRedirect() {}
export async function signOut() { auth.currentUser = null; observers.forEach(callback => callback(null)); }
export function switchAccount() { auth.currentUser = account("qa-second"); observers.forEach(callback => callback(auth.currentUser)); }
export function reverifyAccount() { observers.forEach(callback => callback(auth.currentUser)); }
export class ReCaptchaEnterpriseProvider {}
export class CustomProvider {}
export function initializeAppCheck() { return {}; }
let waiting = false;
const tokenObservers = new Set<() => void>();
export const tokenWaiting = () => waiting;
export function subscribeTokenWaiting(callback: () => void) { tokenObservers.add(callback); return () => { tokenObservers.delete(callback); }; }
function notifyWaiting(value: boolean) { waiting = value; tokenObservers.forEach(callback => callback()); }
let approve: ((result: { token: string }) => void) | undefined;
let deny: ((error: Error) => void) | undefined;
export function getToken(_instance: unknown, forceRefresh: boolean) {
  window.dispatchEvent(new CustomEvent("qa-verification", { detail: { forceRefresh } }));
  return new Promise<{ token: string }>((resolve, reject) => { approve = resolve; deny = reject; notifyWaiting(true); });
}
export function approveVerification() { approve?.({ token: "synthetic-attestation" }); notifyWaiting(false); }
export function rejectVerification() { deny?.(new Error("Synthetic provider failure")); notifyWaiting(false); }

// Only the synthetic SDK transport is replaced; the production collection hook,
// auth gate and retry logic run unchanged in this fixture.
export const db = {};
export class Bytes {}
export class DocumentReference {}
export class GeoPoint {}
export class Timestamp {}
export const collection = (_db: unknown, name: string) => ({ name });
export const query = (source: { name: string }) => source;
export const limit = () => ({});
export const where = () => ({});
export const orderBy = () => ({});
const reads = new Map<string, number>();
export function onSnapshot(source: { name: string }, success: (snapshot: unknown) => void, failure: (error: unknown) => void) {
  const count = (reads.get(source.name) ?? 0) + 1;
  reads.set(source.name, count);
  window.dispatchEvent(new CustomEvent("qa-metadata-read", { detail: { collection: source.name, count } }));
  let active = true;
  queueMicrotask(() => {
    if (!active) return;
    if (count === 1) failure({ code: "permission-denied" });
    else success({ docs: [{ id: source.name, data: () => ({ name: `Verified ${source.name}` }) }] });
  });
  return () => { active = false; };
}

export const rtdb = {};
export const ref = (_db: unknown, path: string) => ({ path });
const connectionObservers = new Set<(snapshot: { val: () => unknown }) => void>();
let sdkConnected = true;
let offlineCalls = 0;
let onlineCalls = 0;
let fleetReads = 0;
const socketObservers = new Set<() => void>();
export const socketStats = () => `${offlineCalls}:${onlineCalls}:${fleetReads}`;
export function subscribeSocketStats(callback: () => void) { socketObservers.add(callback); return () => { socketObservers.delete(callback); }; }
function notifySocketStats() { socketObservers.forEach(callback => callback()); }
export function setRealtimeConnected(value: boolean) {
  sdkConnected = value;
  connectionObservers.forEach(callback => callback({ val: () => value }));
}
export function goOffline() { offlineCalls++; setRealtimeConnected(false); notifySocketStats(); }
export function goOnline() { onlineCalls++; setRealtimeConnected(true); notifySocketStats(); }
export function onValue(source: { path: string }, success: (snapshot: { val: () => unknown }) => void) {
  let active = true;
  if (source.path === ".info/connected") connectionObservers.add(success);
  else { fleetReads++; notifySocketStats(); }
  queueMicrotask(() => {
    if (!active) return;
    success({ val: () => source.path === ".info/connected" ? sdkConnected : {
      "qa-bus": { busId: "qa-bus", routeId: "qa-route", sessionId: "qa-session", tripState: "in_service", timestamp: Date.now(), lat: 12, lng: 77 },
    } });
  });
  return () => { active = false; connectionObservers.delete(success); };
}
export const onChildAdded = () => () => {};
export const onChildChanged = () => () => {};
export const onChildRemoved = () => () => {};
