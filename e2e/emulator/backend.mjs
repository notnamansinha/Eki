import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { safetyPreflight } from '../../scripts/qa/safety-preflight.mjs';
import { createProviderAdapter, syntheticProviderKey } from './providers.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const path of ['.env', 'backend/.env', 'e2e/emulator/.env']) {
  if (existsSync(resolve(root, path))) throw new Error('Browser acceptance requires a clean disposable checkout without .env files');
}
safetyPreflight(process.env, { mode: 'emulator' });
// Arrival evidence stays real; omit only the post-completion wait in browser
// journeys. The HTTP emulator suite separately exercises the default 30s wait.
process.env.AUTOMATIC_TURNAROUND_DWELL_MS = '0';
if (!globalThis.__ekiQaNetworkGuard?.enabled) throw new Error('Browser backend needs the preloaded loopback guard');
const require = createRequire(resolve(root, 'backend/package.json'));
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getDatabase } = require('firebase-admin/database');
const { getAuth } = require('firebase-admin/auth');
const project = 'demo-eki-qa';
const credential = applicationDefault();
credential.getAccessToken = async () => ({ access_token: 'owner', expires_in: 3600 });
const app = initializeApp({ projectId: project, databaseURL: `http://127.0.0.1:9005/?ns=${project}-default-rtdb`,
  credential });
const db = getFirestore(app); db.settings({ host: '127.0.0.1:8085', ssl: false });
const realtime = getDatabase(app); const auth = getAuth(app);
const { encodePolyline } = require(resolve(root, 'backend/dist/lib/polylineUtils.js'));
const { routeGeometrySignature } = require(resolve(root, 'backend/dist/lib/routeGeometrySignature.js'));
const providers = createProviderAdapter(globalThis.fetch, encodePolyline);
globalThis.fetch = providers.fetch;
// No inherited provider credential is accepted by preflight. This owned fake
// key only unlocks the real handler's in-memory provider response adapter.
process.env.GOOGLE_MAPS_API_KEY = syntheticProviderKey;
const { hashDeviceSecret, invalidateDeviceCredentialCache } = require(resolve(root, 'backend/dist/services/deviceTelemetryService.js'));
const { publishUserAuthorization } = require(resolve(root, 'backend/dist/services/userAuthorization.js'));
const deviceSecret = 'synthetic-browser-device-only';
const secretHash = await hashDeviceSecret(deviceSecret);
let epoch;
const route = { id: 'qa_route', name: 'Synthetic route', color: '#3B82F6', duration: '600s', waypoints: [],
  stops: [{ id: 'origin', name: 'Synthetic origin', shortName: 'Origin', lat: 23, lng: 72 },
    { id: 'middle', name: 'Synthetic middle', shortName: 'Middle', lat: 23.0018, lng: 72 },
    { id: 'end', name: 'Synthetic end', shortName: 'End', lat: 23.0036, lng: 72 }] };
route.forwardPolyline = encodePolyline(route.stops); route.reversePolyline = encodePolyline([...route.stops].reverse());
Object.assign(route, { polylineQuality: 'HIGH_QUALITY', geometryVersion: 1, configVersion: 1,
  geometrySignature: routeGeometrySignature(route.stops), polyline: route.forwardPolyline,
  forwardDistanceMeters: 400, reverseDistanceMeters: 400, distanceMeters: 400,
  forwardDuration: '600s', reverseDuration: '600s' });
for (const uid of ['qa_passenger', 'qa_other', 'qa_admin']) {
  try { await auth.getUser(uid); } catch { await auth.createUser({ uid, email: `${uid}@example.invalid`, password: 'SyntheticOnly123!', displayName: uid }); }
  await auth.setCustomUserClaims(uid, uid === 'qa_admin' ? { role: 'admin', admin: true } : { role: 'passenger' });
}
const firestoreRules = readFileSync(process.env.FIRESTORE_RULES_PATH, 'utf8');
const rulesResponse = await fetch(`http://127.0.0.1:8085/emulator/v1/projects/${project}:securityRules`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: firestoreRules }] } }), signal: AbortSignal.timeout(10000) });
if (!rulesResponse.ok) throw new Error('Browser Firestore rules installation failed');
const databaseRules = await fetch(`http://127.0.0.1:9005/.settings/rules.json?ns=${project}-default-rtdb`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
  body: readFileSync(process.env.DATABASE_RULES_PATH, 'utf8'), signal: AbortSignal.timeout(10000) });
if (!databaseRules.ok) throw new Error('Browser database rules installation failed');

async function reset() {
  providers.reset();
  epoch = Date.now() - 45000;
  for (const collection of ['ride_sessions', 'routes', 'buses', 'users', 'feedbacks', 'feedbackCooldowns',
    'completed_trips', 'drivers', 'devices', 'active_rides', 'bus_locations', '_active_bus_locks', '_feedback_idempotency', '_privacy_deletion_requests', '_route_save_operations', '_userAuthorization'])
    await db.recursiveDelete(db.collection(collection));
  for (const uid of ['qa_passenger', 'qa_other', 'qa_admin']) {
    // Deletion acceptance retires an actual emulator identity. Recreate only
    // these owned fixture accounts before the next isolated browser case.
    try { await auth.getUser(uid); } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
      await auth.createUser({ uid, email: `${uid}@example.invalid`, password: 'SyntheticOnly123!', displayName: uid });
    }
    await auth.setCustomUserClaims(uid, uid === 'qa_admin' ? { role: 'admin', admin: true } : { role: 'passenger' });
    await db.collection('users').doc(uid).set({ displayName: uid, role: uid === 'qa_admin' ? 'admin' : 'passenger' });
  }
  await db.collection('routes').doc(route.id).set(route);
  await db.collection('buses').doc('qa_bus').set({ name: 'Synthetic bus', numberPlate: 'QA-ONLY', assignedRoutes: [route.id], active: true });
  await db.collection('drivers').doc('qa_driver').set({ name: 'Synthetic operator', assignedBusId: 'qa_bus' });
  await db.collection('devices').doc('qa_device').set({ busId: 'qa_bus', routeId: route.id, enabled: true, secretHash });
  invalidateDeviceCredentialCache('qa_device');
  await db.collection('settings').doc('global').set({ serviceStartTime: '8:00 am', noBusesMessage: 'No buses running',
    noBusesSubMessage: 'Service starts at {time}', announcementActive: false, announcementText: '' });
  await db.collection('ride_sessions').doc('qa_session').set({ busId: 'qa_bus', routeId: route.id, driverId: 'qa_driver',
    status: 'active', direction: 'forward', boardingCode: 'ABCD2345', passengers: {}, passengerIds: [],
    armedAt: epoch, startTime: epoch, originStopId: 'origin', destinationStopId: 'end' });
  await db.collection('_active_bus_locks').doc('qa_bus').set({ sessionId: 'qa_session', routeId: route.id, driverId: 'qa_driver', direction: 'forward' });
  const live = { busId: 'qa_bus', routeId: route.id, driverId: 'qa_driver', sessionId: 'qa_session',
    status: 'active', tripState: 'in_service', direction: 'forward', directionState: 'resolved', hasDepartedOrigin: true,
    deviceState: 'online', motionState: 'stopped', gpsHdop: 1, signalState: 'connected', speed: 0, lat: 23, lng: 72,
    currentStopIndex: 0, timestamp: epoch, backendReceivedAt: Date.now(), seq: 1 };
  await realtime.ref().set({ activeBuses: { [`qa_bus_${route.id}`]: live },
    publicRouteBuses: { [`route:${route.id}`]: { buses: { [`node:qa_bus_${route.id}`]: live } } },
    liveRouteCatalog: { values: { [`route:${route.id}`]: { active: 1, available: 0, availableReceipts: [], freshestAt: Date.now() } } },
    clientProjectionStatus: { public: { schemaVersion: 1, ready: true } } });
  // Initialize current admin authority after replacing the RTDB fixture root.
  // Use the real publisher so browser reads exercise the migrated rules policy.
  await publishUserAuthorization('qa_admin', { role: 'admin', admin: true });
}
await reset();
async function waitForLifecycle(predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate((await realtime.ref('activeBuses/qa_bus_qa_route').get()).val())) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const live = (await realtime.ref('activeBuses/qa_bus_qa_route').get()).val();
  throw new Error(`Synthetic lifecycle checkpoint timed out: ${JSON.stringify({
    seq: live?.seq, lat: live?.lat, lng: live?.lng, speed: live?.speed, motionState: live?.motionState,
    tripState: live?.tripState, currentStopIndex: live?.currentStopIndex, hasDepartedOrigin: live?.hasDepartedOrigin,
    terminalArrival: live?.terminalArrival, timestamp: live?.timestamp, anchor: live?.plausibilityAnchor,
    raw: live?.rawLocation,
  })}`);
}
// A separate test-control listener, bound to loopback. No test endpoints enter
// the production Express app. Owned QA runners are the only callers; only synthetic
// demo data is reset/read. Production middleware/routes/workers boot below.
const control = createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/reset') { await reset(); res.end('{}'); return; }
    if (req.method === 'POST' && req.url === '/privacy/drain') {
      // Only this guarded loopback fixture exposes a deterministic scan. Use
      // the real worker and its leadership/claim fences, not direct deletions.
      const { runPrivacyDeletionQueue, drainPrivacyDeletions } = require(resolve(root, 'backend/dist/services/privacyDeletionWorker.js'));
      await runPrivacyDeletionQueue(); await drainPrivacyDeletions(false);
      res.end('{}'); return;
    }
    if (req.method === 'POST' && /^\/providers\/(routes|places)\/(valid|rate-limit|malformed|timeout)$/.test(req.url)) {
      const segments = req.url.split('/'); providers.setMode(segments[2], segments[3]); res.end('{}'); return;
    }
    if (req.method === 'POST' && ['/telemetry/middle', '/telemetry/end', '/telemetry/fresh-origin'].includes(req.url)) {
      // Real authenticated device HTTP ingestion; no direct completion writes.
      const samples = req.url === '/telemetry/middle'
        ? [{ seq: 2, offset: 20000, lat: 23.0018, speed: 45, motionState: 'moving' },
          { seq: 3, offset: 25000, lat: 23.0018, speed: 45, motionState: 'moving' }]
        : req.url === '/telemetry/end' ? [4, 5, 6].map(seq => ({ seq, offset: 0, lat: 23.0036, speed: 0, motionState: 'stopped' }))
        : [{ seq: 7, offset: Date.now() - epoch, lat: 23, speed: 0, motionState: 'stopped' }];
      const statuses = [];
      for (const { offset, ...sample } of samples) {
        if (req.url === '/telemetry/end' && sample.seq === 5) {
          await waitForLifecycle(live => live?.terminalArrival);
          await new Promise(resolve => setTimeout(resolve, 2100));
        }
        if (req.url === '/telemetry/end' && sample.seq === 6) {
          // With the fixture's explicit zero dwell, the return may already
          // replace completed presence. Wait on durable completion authority.
          await waitForLifecycle(async () =>
            (await db.collection('ride_sessions').doc('qa_session').get()).data()?.status === 'completed');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        const timestamp = req.url === '/telemetry/end' ? Date.now() : epoch + offset;
        const response = await fetch('http://127.0.0.1:3116/api/devices/qa_device/telemetry', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Device ${deviceSecret}` },
          body: JSON.stringify({ ...sample, lng: 72, heading: 0, gpsHdop: 1, timestamp, deviceSentAt: Date.now() }),
          signal: AbortSignal.timeout(10000), redirect: 'error' });
        statuses.push(response.status);
        if (response.status !== 202) throw new Error('Synthetic telemetry was not accepted');
        // Wait on an observed worker result, not a guessed sleep or forced state.
        const deadline = Date.now() + 12000;
        for (;;) {
          const live = (await realtime.ref('activeBuses/qa_bus_qa_route').get()).val();
          if (live?.seq === sample.seq && (sample.seq !== 2 || live.currentStopIndex >= 1)
            && (sample.seq !== 3 || live.currentStopIndex >= 2)
            && (sample.seq !== 4 || live.terminalArrival)
            && (req.url !== '/telemetry/end' || sample.seq !== 5 ||
              (await db.collection('ride_sessions').doc('qa_session').get()).data()?.status === 'completed')) break;
          if (Date.now() >= deadline) throw new Error('Synthetic telemetry worker deadline exceeded');
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ statuses })); return;
    }
    if (req.method === 'GET' && req.url === '/evidence') {
      const ride = (await db.collection('ride_sessions').doc('qa_session').get()).data();
      const messages = await db.collection('ride_sessions').doc('qa_session').collection('messages').get();
      const archivedMessages = await db.collection('ride_sessions').doc('qa_session').collection('archivedMessages').get();
      const feedbacks = await db.collection('feedbacks').get();
      const buses = await db.collection('buses').get();
      const sessions = await db.collection('ride_sessions').get();
      const completions = await db.collection('completed_trips').get();
      const drivers = await db.collection('drivers').get();
      const routes = await db.collection('routes').get();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ fixtureProcessId: process.pid, passengers: ride?.passengers ?? {}, passengerIds: ride?.passengerIds ?? [],
        messages: messages.docs.map(doc => ({ id: doc.id, ...doc.data() })), archivedMessages: archivedMessages.docs.map(doc => ({ id: doc.id, ...doc.data() })), feedbacks: feedbacks.docs.map(doc => doc.data()),
        buses: buses.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        sessions: sessions.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        completions: completions.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        drivers: drivers.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        otherAccountClaims: (await auth.getUser('qa_other')).customClaims,
        routes: routes.docs.map(doc => ({ id: doc.id, ...doc.data() })), providers: providers.evidence(),
        live: (await realtime.ref('activeBuses/qa_bus_qa_route').get()).val(),
        lock: (await db.collection('_active_bus_locks').doc('qa_bus').get()).data() ?? null,
        settings: (await db.collection('settings').doc('global').get()).data(), transport: globalThis.__ekiQaNetworkGuard })); return;
    }
    if (req.method === 'GET' && req.url === '/authorization-snapshot') {
      const collections = ['ride_sessions', 'routes', 'buses', 'users', 'feedbacks', 'feedbackCooldowns',
        'completed_trips', 'drivers', 'devices', 'active_rides', '_active_bus_locks', '_feedback_idempotency',
        '_privacy_deletion_requests', '_route_save_operations', '_route_geometry_previews', '_fleet_reconciliation_jobs', '_device_diagnostics', '_userAuthorization'];
      const documents = {};
      for (const name of collections) {
        const snapshot = await db.collection(name).get();
        documents[name] = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() })).sort((a, b) => a.id.localeCompare(b.id));
      }
      const accounts = await auth.listUsers(100);
      const principals = accounts.users.map(user => ({ uid: user.uid, email: user.email, displayName: user.displayName,
        disabled: user.disabled, customClaims: user.customClaims ?? {} })).sort((a, b) => a.uid.localeCompare(b.uid));
      const telemetry = (await realtime.ref('activeBuses').get()).val();
      const userAuthorization = (await realtime.ref('_userAuthorization').get()).val();
      const rateLimitCount = (await db.collectionGroup('messageRateLimits').get()).size;
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ documents, principals, telemetry, userAuthorization, rateLimitCount })); return;
    }
    res.statusCode = 404; res.end('{}');
  } catch (error) {
    console.error('[QA synthetic control]', error.message);
    res.statusCode = 500; res.end(JSON.stringify({ error: error.message }));
  }
});
control.listen(3117, '127.0.0.1');
process.once('SIGTERM', () => control.close()); process.once('SIGINT', () => control.close());
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  if (args[0] !== 3116 || args[1] !== '0.0.0.0') throw new Error('Unexpected application listener in browser fixture');
  args[1] = '127.0.0.1';
  return listen.apply(this, args);
};
try { require(resolve(root, 'backend/dist/server.js')); }
finally { Server.prototype.listen = listen; }
if (process.connected) process.once('message', message => {
  if (message?.type !== 'eki-qa-shutdown' || message.pid !== process.pid) return;
  process.disconnect();
  process.emit('SIGTERM');
});
