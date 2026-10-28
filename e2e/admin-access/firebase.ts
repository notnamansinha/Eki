// Synthetic SDK adapter; actual useAuth remain under test.
export const firebaseApp = {};
const account = (uid: string) => ({ uid, email: `${uid}@example.test`, displayName: uid,
  photoURL: null, isAnonymous: false, getIdToken: async () => `token-${uid}`,
  getIdTokenResult: (forceRefresh = false) => verifyRole(forceRefresh),
});
type User = ReturnType<typeof account>;
// `?restoreHang` models a cold open whose persisted session is still being
// restored: currentUser is unknown (null), and the first observer callback,
// authStateReady() and getRedirectResult stay pending until a fixture control
// finishes restoration. Other scenarios restore the admin immediately.
const restoreHang = new URLSearchParams(location.search).has("restoreHang");
let restoring = restoreHang;
const heldObservers = new Set<(user: User | null) => void>();
const heldRestoration: Array<() => void> = [];
const restorationObservers = new Set<() => void>();
const untilRestored = () => restoring ? new Promise<void>(resolve => { heldRestoration.push(resolve); }) : Promise.resolve();
export const restorationPending = () => restoring;
export function subscribeRestoration(callback: () => void) { restorationObservers.add(callback); return () => { restorationObservers.delete(callback); }; }
// authDomain matches the page host (a same-origin auth helper), so an iPhone
// user agent takes the production full-page redirect path and desktop the popup.
export const auth = { currentUser: (restoreHang ? null : account("qa-admin")) as User | null,
  config: { authDomain: location.host }, authStateReady: untilRestored };
export const googleProvider = {};
export const popupRedirectResolver = {};
// Records each OAuth SDK call and whether it received the shared resolver.
const authCalls: Array<{ name: string; resolver: boolean }> = [];
Object.assign(window, { qaAuthCalls: authCalls });
const recordAuthCall = (name: string, resolver: unknown) => { authCalls.push({ name, resolver: resolver === popupRedirectResolver }); };
const observers = new Set<(user: User | null) => void>();
export function onAuthStateChanged(_auth: unknown, callback: (user: User | null) => void) {
  observers.add(callback);
  if (restoring) heldObservers.add(callback); else queueMicrotask(() => callback(auth.currentUser));
  return () => { observers.delete(callback); heldObservers.delete(callback); };
}
function finishRestoration(user: User | null) {
  if (!restoring) return;
  auth.currentUser = user; restoring = false;
  heldRestoration.splice(0).forEach(resolve => resolve());
  const initial = [...heldObservers]; heldObservers.clear();
  initial.forEach(callback => queueMicrotask(() => { if (observers.has(callback)) callback(auth.currentUser); }));
  restorationObservers.forEach(callback => callback());
}
export const finishRestorationSignedOut = () => finishRestoration(null);
export const finishRestorationAsPassenger = () => finishRestoration(account("qa-passenger"));
export const finishRestorationAsAdmin = () => finishRestoration(account("qa-admin"));
export const browserLocalPersistence = {};
export async function setPersistence() {}
export async function getRedirectResult(_auth?: unknown, resolver?: unknown) {
  recordAuthCall("getRedirectResult", resolver); await untilRestored(); return null;
}
export async function signInWithPopup(_auth?: unknown, _provider?: unknown, resolver?: unknown) { recordAuthCall("signInWithPopup", resolver); }
export async function signInWithRedirect(_auth?: unknown, _provider?: unknown, resolver?: unknown) { recordAuthCall("signInWithRedirect", resolver); }
export async function signOut() { auth.currentUser = null; observers.forEach(callback => callback(null)); }
export function switchAccount() { auth.currentUser = account("qa-second"); observers.forEach(callback => callback(auth.currentUser)); }
export function reverifyAccount() { observers.forEach(callback => callback(auth.currentUser)); }
let waiting = false;
const tokenObservers = new Set<() => void>();
export const tokenWaiting = () => waiting;
export function subscribeTokenWaiting(callback: () => void) { tokenObservers.add(callback); return () => { tokenObservers.delete(callback); }; }
function notifyWaiting(value: boolean) { waiting = value; tokenObservers.forEach(callback => callback()); }
let approve: ((result: { claims: { role: string; admin: boolean } }) => void) | undefined;
let deny: ((error: Error) => void) | undefined;
function verifyRole(forceRefresh: boolean) {
  window.dispatchEvent(new CustomEvent("qa-verification", { detail: { forceRefresh } }));
  return new Promise<{ claims: { role: string; admin: boolean } }>((resolve, reject) => { approve = resolve; deny = reject; notifyWaiting(true); });
}
export function approveVerification() {
  const query = new URLSearchParams(location.search);
  const requested = query.get("traceRole");
  const role = auth.currentUser?.uid === "qa-passenger" ? "passenger"
    : query.has("traceExport") && (requested === "passenger" || requested === "driver") ? requested : "admin";
  approve?.({ claims: { role, admin: role === "admin" } });
  notifyWaiting(false);
}
export function rejectVerification() { deny?.(new Error("Synthetic role verification failure")); notifyWaiting(false); }
export function rejectNetworkVerification() {
  deny?.(Object.assign(new Error("Synthetic network interruption"), { code: "auth/network-request-failed" }));
  notifyWaiting(false);
}

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
export const limitToLast = () => ({});
export const where = () => ({});
export const orderBy = () => ({});
export const doc = (_db: unknown, name: string, id: string) => ({ name, id });
export const serverTimestamp = () => ({});
export async function runTransaction() { throw new Error("Unexpected feedback submission in admin fixture"); }
// Test-only transport for the Firestore SDK boundary. Production feedbackStore
// and the auth-generation guards run unchanged; no backend API is involved.
async function feedbackTransport(id?: string, data?: unknown) {
  const response = await fetch(`/__qa/firestore/feedback${id ? `/${id}` : ""}`, {
    method: data ? "PATCH" : "GET",
    headers: { Authorization: `Bearer ${await auth.currentUser?.getIdToken()}`, "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
export async function getDocsFromServer() {
  const result = await feedbackTransport();
  return { docs: result.feedbacks.map(({ id, ...data }: { id: string }) => ({ id, data: () => data })) };
}
export async function updateDoc(source: { id: string }, data: unknown) {
  await feedbackTransport(source.id, data);
}
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
export async function get() { throw new Error("Unexpected synthetic one-shot RTDB read"); }
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
const routeChildren = new Set<(snapshot: { key: string; val: () => unknown }) => void>();
const catalogObservers = new Set<(snapshot: { val: () => unknown }) => void>();
let routeBus: Record<string, unknown> | null = null;
export function publishPreview() {
  const received = Date.now() - 30_000;
  routeBus = { busId: "qa-bus", routeId: "qa-route", deviceState: "online", status: "offline",
    timestamp: received - 50_000, backendReceivedAt: received, lat: 23, lng: 72 };
  routeChildren.forEach(callback => callback({ key: "node:qa-bus_qa-route", val: () => routeBus }));
  catalogObservers.forEach(callback => callback({ val: () => ({ "route:qa-route": { active: 0, available: 1, freshestAt: received, availableReceipts: [received] } }) }));
}
export function publishAutomaticReturn() {
  routeBus = { busId: "qa-bus", routeId: "qa-route", sessionId: "return", previousSessionId: "joined",
    automaticTurnaround: true, tripState: "pre_departure", status: "active", timestamp: Date.now() };
  routeChildren.forEach(callback => callback({ key: "node:qa-bus_qa-route", val: () => routeBus }));
}
export function onValue(source: { path: string }, success: (snapshot: { val: () => unknown }) => void) {
  window.dispatchEvent(new CustomEvent("qa-rtdb-read", { detail: { path: source.path } }));
  let active = true;
  if (source.path === ".info/connected") connectionObservers.add(success);
  if (source.path === "liveRouteCatalog/values") catalogObservers.add(success);
  else { fleetReads++; notifySocketStats(); }
  queueMicrotask(() => {
    if (!active) return;
    const scoped = source.path === "publicRouteBuses/route:qa-route/buses";
    const catalog = source.path === "liveRouteCatalog/values";
    success({ val: () => source.path === ".info/connected" ? sdkConnected : source.path === "clientProjectionStatus/public" ? { schemaVersion: 1, ready: true } : scoped ? (routeBus ? { "node:qa-bus_qa-route": routeBus } : {}) : catalog ? { "route:qa-route": { active: 1, available: 0, freshestAt: 0 } } : {
      "route:qa-route": { buses: { "node:qa-bus": { busId: "qa-bus", routeId: "qa-route", sessionId: "qa-session", tripState: "in_service", timestamp: Date.now(), lat: 12, lng: 77 } } },
    } });
  });
  return () => { active = false; connectionObservers.delete(success); catalogObservers.delete(success); };
}
export const onChildAdded = () => () => {};
export const onChildChanged = (source: { path: string }, callback: (snapshot: { key: string; val: () => unknown }) => void) => {
  if (source.path === "publicRouteBuses/route:qa-route/buses") routeChildren.add(callback);
  return () => { routeChildren.delete(callback); };
};
export const onChildRemoved = () => () => {};
