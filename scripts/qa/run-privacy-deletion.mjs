import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryRoot } from './acceptance-catalog.mjs';
import { safetyPreflight } from './safety-preflight.mjs';
import { removeGeneratedDemoConfig } from './emulator-environment.mjs';
import {
  assertEmulatorPortsFree, isPortFree, killProcessTree, reapOrphanedEmulators, resolveJavaHome, resolveWindowsNpxCli, withJdkFirstOnPath,
} from './emulator-process.mjs';
import { writeEmulatorRuleset } from '../rules-for-emulator.mjs';
import {
  FINDINGS, PASSENGER_STORES, STAGING_PROJECT_ID, STAGING_RTDB_URL, STAGING_SERVICE, assertPrivacyStagingRun, deletionVerdict,
  entryForPath, evaluateAccount, executeReadPlan, markersFor, redactText, scanLog, scanText, servingRevision, stagingReadPlan,
  unexpectedSweepHits,
} from './privacy-inventory.mjs';

/**
 * Passenger account deletion verifier (qa/PRIVACY_VERIFICATION.md).
 *
 *   node scripts/qa/run-privacy-deletion.mjs                      local: starts the
 *       disposable Auth, Firestore and RTDB emulators and reruns itself inside them
 *   node scripts/qa/run-privacy-deletion.mjs --staging --dry-run  prints the staging read plan
 *   node scripts/qa/run-privacy-deletion.mjs --staging            read-only check of one
 *       dedicated staging test account after its deletion
 */
const args = process.argv.slice(2);
const forms = { '': 'outer', '--inside': 'inside', '--staging': 'staging', '--staging --dry-run': 'staging' };
const mode = forms[args.join(' ')];
if (!mode) throw new Error('Usage: node scripts/qa/run-privacy-deletion.mjs [--staging [--dry-run]]');
const dryRun = args.includes('--dry-run');
const evidenceDirectory = resolve(repositoryRoot, 'artifacts/qa');
const profile = mode === 'staging' ? 'staging' : 'local';
const workDirectory = resolve(evidenceDirectory, `privacy-deletion-${profile}`);
const reportBase = resolve(evidenceDirectory, `privacy-deletion-${profile}-report`);
const require = createRequire(resolve(repositoryRoot, 'backend/package.json'));
const git = gitArgs => execFileSync('git', gitArgs, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
const sleep = ms => new Promise(done => setTimeout(done, ms));
// The evidence never copies response text: a status or error message is recorded only in its expected shape.
const recordedStatus = value => { const text = String(value); return /^[1-5][0-9]{2}$/.test(text) ? Number(text) : null; };
const recordedError = value => { const text = String(value ?? ''); return /^[\w .,:'-]{1,120}$/.test(text) ? text : null; };

const report = {
  schemaVersion: 1, profile, dryRun, sourceCommit: git(['rev-parse', 'HEAD']),
  dirty: Boolean(git(['status', '--porcelain', '--untracked-files=all'])),
  startedAt: new Date().toISOString(), finishedAt: null, node: process.version, platform: process.platform,
  firebaseTools: profile === 'local' ? '15.14.0' : null, target: null, release: null,
  inventory: PASSENGER_STORES.map(({ id, store, match, handling, finding }) => ({ id, store, match, handling, finding: finding ?? null })),
  accounts: [], sweep: null, log: null, accessChecks: [], sla: null, findings: FINDINGS.map(({ id, severity, title }) => ({ id, severity, title })),
  verdict: 'BLOCKED', problems: [], setupError: null,
};
const writeReport = () => {
  report.finishedAt = new Date().toISOString();
  writeFileSync(`${reportBase}.json`, JSON.stringify(report, null, 2) + '\n');
  const summary = markdown();
  writeFileSync(`${reportBase}.md`, summary);
  console.log(summary);
};

// ---- outer: start the disposable emulators -----------------------------------

async function runOuter() {
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(`${reportBase}.json`, JSON.stringify({ ...report, setupError: 'The emulator session has not produced evidence yet' }, null, 2) + '\n');
  safetyPreflight(process.env);
  for (const path of ['.env', 'backend/.env', 'e2e/emulator/.env']) {
    if (existsSync(resolve(repositoryRoot, path))) throw new Error('The privacy verifier needs a checkout without .env files');
  }
  if (!existsSync(resolve(repositoryRoot, 'backend/dist/server.js'))) throw new Error('Build the backend first: npm run build --workspace=backend');
  await assertEmulatorPortsFree();
  for (const port of [3116, 3117]) if (!(await isPortFree(port))) throw new Error(`Port ${port} is in use; the backend fixture needs it`);
  const { configPath, firestorePath, databasePath } = await writeEmulatorRuleset();
  const emulatorArgs = ['--yes', 'firebase-tools@15.14.0', 'emulators:exec', '--config', configPath, '--only', 'firestore,database,auth',
    '--project', 'demo-eki-qa', `node "${fileURLToPath(import.meta.url)}" --inside`];
  const baseEnv = process.platform === 'win32' ? withJdkFirstOnPath(process.env, resolveJavaHome(process.env)) : process.env;
  const env = { ...baseEnv, FIREBASE_RULES_TEST: '1', FIRESTORE_RULES_PATH: firestorePath, DATABASE_RULES_PATH: databasePath,
    GCLOUD_PROJECT: 'demo-eki-qa', FIREBASE_DATABASE_URL: 'http://127.0.0.1:9005/', EKI_QA_EXTERNAL_PROVIDERS: 'mock',
    EKI_QA_CONFIRM_DISPOSABLE: '1', EKI_QA_BASE_URL: 'http://127.0.0.1:3116/',
    DOTENV_CONFIG_PATH: resolve(repositoryRoot, 'artifacts/qa/nonexistent.env'), METADATA_SERVER_DETECTION: 'none' };
  const options = { stdio: 'inherit', cwd: repositoryRoot, env };
  let child;
  if (process.platform === 'win32') {
    // node + npm's npx CLI keeps the quoted emulators:exec script intact (see run-rules-emulator.mjs).
    const npxCli = resolveWindowsNpxCli();
    if (!npxCli) throw new Error("Cannot find npm's npx-cli.js; run this through npm run qa:privacy:deletion");
    child = spawn(process.execPath, [npxCli, ...emulatorArgs], options);
  } else {
    child = spawn('npx', emulatorArgs, options);
  }
  const deadline = setTimeout(() => { console.error('Privacy verifier deadline exceeded'); killProcessTree(child); }, 12 * 60_000);
  const code = await new Promise(done => { child.once('error', () => done(1)); child.once('exit', exitCode => done(exitCode ?? 1)); });
  clearTimeout(deadline);
  const reaped = reapOrphanedEmulators();
  if (reaped.length) console.error(`Stopped orphaned emulator JVM(s): ${reaped.join(', ')}`);
  process.exit(code);
}

// ---- inside: the local verification --------------------------------------------

const BACKEND = 'http://127.0.0.1:3116';
const CONTROL = 'http://127.0.0.1:3117';
const PASSWORD = 'SyntheticOnly123!';
const COORDINATES = { lat: 23.000713, lng: 72.000913 }; // 122 m from the fixture bus; distinctive in logs

async function http(method, url, { token, body } = {}) {
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, body: json };
}
async function expectStatus(label, expected, result) {
  if (expected.includes(result.status)) return result.body;
  const error = recordedError(result.body?.error);
  throw new Error(`${label} returned HTTP ${recordedStatus(result.status) ?? 'other'}${error ? ` (${error})` : ''}`);
}

async function signIn(email) {
  const { status, body } = await http('POST', 'http://127.0.0.1:9095/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic-only',
    { body: { email, password: PASSWORD, returnSecureToken: true } });
  if (status !== 200 || typeof body?.idToken !== 'string') throw new Error('A synthetic identity could not sign in');
  return { idToken: body.idToken, refreshToken: body.refreshToken };
}

function startFixture(logPath) {
  const log = openSync(logPath, 'w');
  const child = spawn(process.execPath, ['--import', './scripts/qa/network-guard.mjs', 'e2e/emulator/backend.mjs'], {
    cwd: repositoryRoot, stdio: ['ignore', log, log, 'ipc'],
    env: { ...process.env, PORT: '3116', CORS_ORIGIN: 'http://127.0.0.1:3115', NODE_ENV: 'development', API_APPCHECK_MODE: 'off' },
  });
  closeSync(log);
  const exited = new Promise(done => child.once('exit', code => done(code)));
  return { child, exited, async stop() {
    if (child.exitCode !== null) return;
    if (child.connected) child.send({ type: 'eki-qa-shutdown', pid: child.pid }, error => { if (error) child.kill('SIGTERM'); });
    else child.kill('SIGTERM');
    const backstop = setTimeout(() => child.kill('SIGKILL'), 12_000);
    await exited; clearTimeout(backstop);
  } };
}

function adminSdk() {
  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const { getDatabase } = require('firebase-admin/database');
  const { getAuth } = require('firebase-admin/auth');
  const credential = applicationDefault();
  credential.getAccessToken = async () => ({ access_token: 'owner', expires_in: 3600 });
  const app = initializeApp({ projectId: 'demo-eki-qa', databaseURL: 'http://127.0.0.1:9005/?ns=demo-eki-qa-default-rtdb', credential }, 'privacy-verifier');
  const db = getFirestore(app); db.settings({ host: '127.0.0.1:8085', ssl: false });
  return { db, rtdb: getDatabase(app), auth: getAuth(app), FieldValue };
}

/** Presence of every inventory entry for one UID (local reads through the Admin SDK). */
async function observe({ db, rtdb, auth }, uid) {
  const exists = async path => (await db.doc(path).get()).exists;
  const any = async query => !(await query.limit(1).get()).empty;
  const field = async (path, name) => (await db.doc(path).get()).data()?.[name] === uid;
  return {
    auth: await auth.getUser(uid).then(() => true, error => { if (error.code === 'auth/user-not-found') return false; throw error; }),
    profile: await exists(`users/${uid}`),
    feedbackCooldown: await exists(`feedbackCooldowns/${uid}`),
    passengerRequest: await exists(`passenger_requests/${uid}`),
    chatRateLimit: await any(db.collectionGroup('messageRateLimits').where('userId', '==', uid)),
    deletionRequest: await exists(`_privacy_deletion_requests/${uid}`),
    feedback: await any(db.collection('feedbacks').where('userId', '==', uid)),
    rideManifest: await any(db.collection('ride_sessions').where('passengerIds', 'array-contains', uid)),
    chatMessage: await any(db.collectionGroup('messages').where('senderId', '==', uid)),
    archivedMessage: await any(db.collectionGroup('archivedMessages').where('senderId', '==', uid)),
    authorizationRecord: await exists(`_userAuthorization/${uid}`),
    authorizationMirror: (await rtdb.ref(`_userAuthorization/${uid}`).get()).exists(),
    fleetLock: await field('_fleet_reconciliation_locks/singleton', 'privacyRequestId'),
    privacyCursor: await field('_reconciliation_cursors/privacy-deletions', 'cursor'),
    legacyRtdbUsers: (await rtdb.ref(`users/${uid}`).get()).exists(),
  };
}

/** Every Firestore document, RTDB node (two levels) and Auth user that still holds a marker. */
async function sweep({ db, rtdb, auth }, markers) {
  const hits = []; const counts = { firestoreDocuments: 0, rtdbNodes: 0, authUsers: 0 };
  const check = (store, path, value) => {
    const categories = Object.keys(scanText(`${path}\n${JSON.stringify(value)}`, markers)).filter(category => category !== 'token');
    if (categories.length) hits.push({ store, path, categories: categories.sort() });
  };
  async function visit(collection) {
    for (const reference of await collection.listDocuments()) {
      const snapshot = await reference.get();
      counts.firestoreDocuments += 1;
      check('firestore', reference.path, snapshot.exists ? snapshot.data() : null);
      for (const child of await reference.listCollections()) await visit(child);
    }
  }
  for (const collection of await db.listCollections()) await visit(collection);
  const root = (await rtdb.ref().get()).val() ?? {};
  for (const [key, value] of Object.entries(root)) {
    if (value && typeof value === 'object') for (const [child, nested] of Object.entries(value)) { counts.rtdbNodes += 1; check('rtdb', `${key}/${child}`, nested); }
    else { counts.rtdbNodes += 1; check('rtdb', key, value); }
  }
  for (const user of (await auth.listUsers(1000)).users) { counts.authUsers += 1; check('auth', user.uid, { email: user.email, displayName: user.displayName, photoURL: user.photoURL }); }
  return { counts, hits };
}

async function runInside() {
  mkdirSync(workDirectory, { recursive: true });
  removeGeneratedDemoConfig(process.env);
  safetyPreflight(process.env, { mode: 'emulator' });
  report.target = 'Disposable Auth, Firestore and RTDB emulators (demo-eki-qa) with the e2e/emulator/backend.mjs fixture on 127.0.0.1:3116';
  const hub = await http('GET', 'http://127.0.0.1:4405/emulators');
  if (hub.status !== 200 || !Object.entries({ firestore: 8085, database: 9005, auth: 9095 })
    .every(([name, port]) => hub.body?.[name]?.host === '127.0.0.1' && hub.body[name].port === port)) throw new Error('Verified emulator targets required');
  const sdk = adminSdk();
  const logPath = resolve(workDirectory, 'backend.log');
  const fixture = startFixture(logPath);
  const suffix = randomBytes(4).toString('hex');
  const accounts = [
    { label: 'passenger', uid: `qa_privacy_${suffix}`, displayName: `Privacy Synthetic ${suffix}`,
      photoURL: `https://example.invalid/privacy-${suffix}.png`, coordinates: [String(COORDINATES.lat), String(COORDINATES.lng)],
      messages: [`privacy probe one ${suffix}`, `privacy probe two ${suffix}`], feedback: `privacy feedback ${suffix}`, secrets: [PASSWORD],
      seeded: ['auth', 'profile', 'feedbackCooldown', 'passengerRequest', 'chatRateLimit', 'deletionRequest', 'feedback', 'rideManifest', 'chatMessage', 'archivedMessage'] },
    { label: 'former-operator', uid: `qa_privacy_op_${suffix}`, displayName: `Privacy Former Operator ${suffix}`, secrets: [PASSWORD],
      seeded: ['auth', 'profile', 'deletionRequest', 'authorizationRecord', 'authorizationMirror'] },
  ];
  for (const account of accounts) account.email = `${account.uid}@example.invalid`;
  try {
    // The fixture resets its synthetic data, then boots the compiled backend with its worker.
    const ready = Date.now() + 90_000;
    while (Date.now() < ready && fixture.child.exitCode === null) {
      try { if ((await http('GET', `${CONTROL}/evidence`)).body?.fixtureProcessId === fixture.child.pid) break; } catch { /* starting */ }
      await sleep(500);
    }
    if ((await http('GET', `${CONTROL}/evidence`).catch(() => ({}))).body?.fixtureProcessId !== fixture.child.pid) throw new Error('The backend fixture did not start; see backend.log');

    for (const account of accounts) {
      await sdk.auth.createUser({ uid: account.uid, email: account.email, password: PASSWORD, displayName: account.displayName, ...(account.photoURL ? { photoURL: account.photoURL } : {}) });
    }
    const admin = await signIn('qa_admin@example.invalid');
    accounts[0].secrets.push(admin.idToken, admin.refreshToken);
    // A former operator: the real fleet endpoints assign, then remove, an operator record.
    const operator = accounts[1];
    const driverPath = `${BACKEND}/api/fleet/drivers/qa_privacy_driver_${suffix}`;
    await expectStatus('Operator assignment', [200], await http('PUT', driverPath, { token: admin.idToken, body: { name: 'Privacy former operator', authUid: operator.uid, assignedBusId: null } }));
    await expectStatus('Operator removal', [200], await http('DELETE', driverPath, { token: admin.idToken }));
    for (const account of accounts) {
      Object.assign(account, await signIn(account.email));
      account.secrets.push(account.idToken, account.refreshToken);
      await expectStatus(`${account.label} profile bootstrap`, [200, 201], await http('POST', `${BACKEND}/api/users/bootstrap`, { token: account.idToken }));
    }
    // A passenger journey through the real endpoints: board, chat, an administrator clear, chat again.
    const passenger = accounts[0];
    await expectStatus('Fresh bus fix', [200], await http('POST', `${CONTROL}/telemetry/fresh-origin`));
    await expectStatus('Boarding', [200], await http('PUT', `${BACKEND}/api/v2/ride-sessions/qa_session/passengers/me`,
      { token: passenger.idToken, body: { ...COORDINATES, accuracy: 12, boardingStopId: 'origin', alightingStopId: 'end' } }));
    const send = (text, index) => http('POST', `${BACKEND}/api/v2/ride-sessions/qa_session/messages`,
      { token: passenger.idToken, body: { text, requestId: `privacy${suffix}message${index}000` } });
    await expectStatus('First message', [201], await send(passenger.messages[0], 1));
    await expectStatus('Administrator message clear', [200], await http('DELETE', `${BACKEND}/api/v2/ride-sessions/qa_session/messages`, { token: admin.idToken }));
    await sleep(3_200); // the 3 s gap between messages
    await expectStatus('Second message', [201], await send(passenger.messages[1], 2));
    // The browser writes feedback directly to Firestore (frontend/src/lib/feedbackStore.ts); qa:browser covers
    // that path under the rules. Seed the same shape here. passenger_requests has no current writer.
    const requestId = `privacy${suffix}feedback000`;
    const feedbackId = createHash('sha256').update(`${passenger.uid}\0${requestId}`).digest('hex');
    await sdk.db.doc(`feedbacks/${feedbackId}`).set({ userId: passenger.uid, userName: passenger.displayName, type: 'general', sessionId: null,
      busId: null, driverId: null, rating: null, comment: passenger.feedback, requestHash: createHash('sha256').update(requestId).digest('hex'),
      timestamp: sdk.FieldValue.serverTimestamp(), status: 'new' });
    await sdk.db.doc(`feedbackCooldowns/${passenger.uid}`).set({ userId: passenger.uid, feedbackId, lastSubmittedAt: sdk.FieldValue.serverTimestamp() });
    await sdk.db.doc(`passenger_requests/${passenger.uid}`).set({ passengerId: passenger.uid, busId: 'qa_bus', type: 'pickup',
      lat: COORDINATES.lat, lng: COORDINATES.lng, status: 'pending', createdAt: sdk.FieldValue.serverTimestamp() });

    for (const account of accounts) {
      account.before = await observe(sdk, account.uid);
      account.requestSentAt = Date.now();
      await expectStatus(`${account.label} deletion request`, [202], await http('POST', `${BACKEND}/api/v2/privacy-deletion-requests`, { token: account.idToken }));
      account.before.deletionRequest = (await sdk.db.doc(`_privacy_deletion_requests/${account.uid}`).get()).exists;
      account.statuses = [];
    }
    // The worker scans when it takes the lease and every 60 s; wait for both deletions to finish.
    const waitUntil = Date.now() + 180_000;
    while (Date.now() < waitUntil && accounts.some(account => !account.completedAt)) {
      for (const account of accounts.filter(item => !item.completedAt)) {
        const status = (await sdk.db.doc(`_privacy_deletion_requests/${account.uid}`).get()).data()?.status ?? 'removed';
        if (account.statuses.at(-1) !== status) account.statuses.push(status);
        const userGone = await sdk.auth.getUser(account.uid).then(() => false, error => error.code === 'auth/user-not-found');
        if (status === 'removed' && userGone) account.completedAt = Date.now();
      }
      await sleep(1_000);
    }
    // Section 3.4 of PRIVACY_DELETION.md: a still-valid ID token cannot recreate the profile.
    for (const account of accounts) {
      const result = await http('POST', `${BACKEND}/api/users/bootstrap`, { token: account.idToken });
      report.accessChecks.push({ name: `${account.label} bootstrap with the pre-deletion token`, expected: 401, status: recordedStatus(result.status), passed: result.status === 401 });
    }
    for (const account of accounts) account.after = await observe(sdk, account.uid);
    const markers = mergeMarkers(accounts);
    const swept = await sweep(sdk, markers);
    const hits = swept.hits.map(hit => ({ ...hit, entry: entryForPath(hit.store, hit.path)?.id ?? null }));
    report.sweep = { ...swept.counts, hits: hits.map(hit => ({ ...hit, path: redactText(hit.path, markers) })),
      unexpected: unexpectedSweepHits(hits).map(hit => ({ ...hit, path: redactText(hit.path, markers) })) };
  } finally {
    await fixture.stop();
  }
  const markers = mergeMarkers(accounts);
  const logText = readFileSync(logPath, 'utf8');
  report.log = { file: 'artifacts/qa/privacy-deletion-local/backend.log (redacted after the scan)', ...scanLog(logText, markers) };
  writeFileSync(logPath, redactText(logText, markers));
  for (const account of accounts) {
    report.accounts.push({ label: account.label, seeded: account.seeded, statuses: account.statuses,
      requestToCompletionMs: account.completedAt ? account.completedAt - account.requestSentAt : null,
      results: evaluateAccount({ before: account.before, after: account.after, seeded: account.seeded }) });
  }
  report.sla = { documented: null, source: 'PRIVACY_DELETION.md Section 3.2: no guaranteed completion time',
    measuredMs: Object.fromEntries(report.accounts.map(account => [account.label, account.requestToCompletionMs])),
    note: 'Worker scan every 60 s while an instance holds the lease, then a 30 s execution budget per request' };
  if (report.accounts.some(account => account.requestToCompletionMs === null)) throw new Error('A deletion did not finish within 180 s');
  Object.assign(report, deletionVerdict({ accounts: report.accounts, sweepUnexpected: report.sweep.unexpected, logHits: report.log.totals, accessChecks: report.accessChecks }));
}

function mergeMarkers(accounts) {
  const merged = {};
  for (const account of accounts) for (const [category, values] of Object.entries(markersFor(account))) merged[category] = [...(merged[category] ?? []), ...values];
  return merged;
}

// ---- staging: read-only verification of one test account -------------------------

async function runStaging() {
  const run = assertPrivacyStagingRun(process.env);
  const plan = stagingReadPlan(run.uid);
  report.target = `Firebase project ${STAGING_PROJECT_ID}, ${STAGING_SERVICE}`;
  report.release = { expectedRevision: run.revision, before: null, after: null };
  report.plan = plan;
  mkdirSync(workDirectory, { recursive: true });
  writeFileSync(resolve(workDirectory, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
  if (dryRun) { report.verdict = 'DRY_RUN'; return; }
  if (report.dirty) throw new Error('A staging verification needs a clean checkout so the evidence names the harness commit');
  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const { getDatabase } = require('firebase-admin/database');
  const { getAuth } = require('firebase-admin/auth');
  const credential = applicationDefault();
  const app = initializeApp({ credential, projectId: STAGING_PROJECT_ID, databaseURL: STAGING_RTDB_URL }, 'privacy-staging');
  const db = getFirestore(app); const rtdb = getDatabase(app); const auth = getAuth(app);
  const readRevision = async () => {
    const { access_token: token } = await credential.getAccessToken();
    const response = await fetch(`https://run.googleapis.com/v2/${STAGING_SERVICE}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Cloud Run service read failed with HTTP ${recordedStatus(response.status) ?? 'other'}`);
    return servingRevision(await response.json());
  };
  const readers = {
    getUser: step => auth.getUser(step.path).then(() => true, error => { if (error.code === 'auth/user-not-found') return false; throw error; }),
    getDocument: async step => (await db.doc(step.path).get()).exists,
    getField: async step => (await db.doc(step.path).get()).data()?.[step.field] === step.value,
    count: async step => (await db.collection(step.collection).where(step.field, '==', step.value).count().get()).data().count,
    countArray: async step => (await db.collection(step.collection).where(step.field, 'array-contains', step.value).count().get()).data().count,
    countGroup: async step => (await db.collectionGroup(step.group).where(step.field, '==', step.value).count().get()).data().count,
    getRtdb: async step => (await rtdb.ref(step.path).get()).exists(),
  };
  report.release.before = await readRevision();
  if (report.release.before !== run.revision) throw new Error(`Staging serves ${report.release.before}, not ${run.revision}`);
  // Read-only polling: the request record and the Auth user disappear when the worker finishes.
  const deadline = Date.now() + run.waitMinutes * 60_000;
  let result;
  for (;;) {
    result = await executeReadPlan(plan, readers);
    if (!result.observed.deletionRequest && !result.observed.auth) break;
    if (Date.now() >= deadline) break;
    await sleep(15_000);
  }
  const complete = !result.observed.deletionRequest && !result.observed.auth;
  report.sla = { documented: null, requestedAt: new Date(run.requestedAt).toISOString(), complete,
    upperBoundMs: complete ? Date.now() - run.requestedAt : null, note: 'Upper bound: the first read that found both the request record and the Auth user gone' };
  report.counts = result.counts;
  const results = evaluateAccount({ before: {}, after: { ...result.observed, archivedMessage: null }, seeded: [] });
  report.accounts.push({ label: 'staging-test-account', results });
  report.release.after = await readRevision();
  Object.assign(report, deletionVerdict({ accounts: report.accounts, sweepUnexpected: [], logHits: {}, accessChecks: [] }));
  if (!complete) { report.verdict = 'NOT_COMPLETE'; report.problems.push('The request record or the Auth user still exists'); }
  if (report.release.after !== report.release.before) report.verdict = 'REVISION_CHANGED';
}

// ---- evidence --------------------------------------------------------------------

function markdown() {
  const lines = [`# Privacy deletion verification: ${profile}`, '',
    `Source ${report.sourceCommit}; dirty: ${report.dirty}; verdict: ${report.verdict}. Started ${report.startedAt}, finished ${report.finishedAt}.`, '',
    `Target: ${report.target ?? 'not reached'}.`, ''];
  if (report.release) lines.push(`Expected revision ${report.release.expectedRevision}; serving before ${report.release.before ?? 'not read'}, after ${report.release.after ?? 'not read'}.`, '');
  if (report.setupError) lines.push(`Setup: ${report.setupError}`, '');
  for (const account of report.accounts) {
    lines.push(`## ${account.label}`, '', `Queue states seen: ${account.statuses?.join(' > ') || 'not observed'}. `
      + `Request to completion: ${account.requestToCompletionMs === undefined ? 'n/a' : account.requestToCompletionMs === null ? 'not complete' : `${(account.requestToCompletionMs / 1000).toFixed(1)} s`}.`, '',
      '| Store | Handling | Outcome | Finding |', '|---|---|---|---|');
    for (const result of account.results) {
      const entry = PASSENGER_STORES.find(item => item.id === result.id);
      lines.push(`| ${entry.store} \`${entry.match}\` | ${entry.handling} | ${result.outcome} | ${result.finding ?? ''} |`);
    }
    lines.push('');
  }
  if (report.sweep) {
    lines.push('## Sweep', '', `${report.sweep.firestoreDocuments} Firestore documents, ${report.sweep.rtdbNodes} RTDB nodes and ${report.sweep.authUsers} Auth users read after deletion.`, '',
      '| Store | Path | Values | Inventory entry |', '|---|---|---|---|');
    for (const hit of report.sweep.hits) lines.push(`| ${hit.store} | \`${hit.path}\` | ${hit.categories.join(', ')} | ${hit.entry ?? 'NONE'} |`);
    lines.push('', `Unexpected: ${report.sweep.unexpected.length}.`, '');
  }
  if (report.log) lines.push('## Backend log', '', `${report.log.lineCount} lines; synthetic values or tokens found: ${JSON.stringify(report.log.totals)}.`, '');
  if (report.accessChecks.length) lines.push('## Access after deletion', '', ...report.accessChecks.map(check => `- ${check.name}: HTTP ${check.status} (expected ${check.expected})`), '');
  if (report.problems.length) lines.push('## Problems', '', ...report.problems.map(problem => `- ${problem}`), '');
  return lines.join('\n') + '\n';
}

if (mode === 'outer') {
  try {
    await runOuter();
  } catch (error) {
    report.setupError = String(error.message).split('\n')[0].slice(0, 400);
    writeReport();
    process.exitCode = 1;
  }
} else {
  mkdirSync(evidenceDirectory, { recursive: true });
  try {
    if (mode === 'inside') await runInside(); else await runStaging();
  } catch (error) {
    report.setupError = String(error.message).split('\n')[0].slice(0, 400);
    report.verdict = report.verdict === 'DRY_RUN' ? 'DRY_RUN' : 'BLOCKED';
  }
  writeReport();
  // The Admin SDK keeps its Firestore and RTDB connections open; end explicitly.
  process.exit(['MATCHES_INVENTORY', 'DRY_RUN'].includes(report.verdict) ? 0 : 1);
}
