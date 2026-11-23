import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { repositoryRoot } from './qa/acceptance-catalog.mjs';
import {
  DELETION_DOC, DELETION_WORKER, FINDINGS, PASSENGER_STORES, READ_OPERATIONS, STAGING_PROJECT_ID,
  assertPrivacyStagingRun, deletionVerdict, discoverStores, entryForPath, evaluateAccount, executeReadPlan, markersFor,
  pathMatches, redactText, scanLog, scanText, servingRevision, stagingReadPlan, unclassifiedStores, unexpectedSweepHits,
  workerDeletedCollections,
} from './qa/privacy-inventory.mjs';
import {
  VENDORS, configuredNoticeUrl, cspHostSources, declaredVendors, evaluateDisclosure, vendorForCspHost, vendorForHost,
} from './qa/privacy-vendors.mjs';

const read = path => readFileSync(resolve(repositoryRoot, path), 'utf8');
function sources(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return ['node_modules', 'test-support'].includes(name) ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [{ path, text: readFileSync(path, 'utf8') }] : [];
  });
}

test('every Firestore collection and RTDB root the code uses is classified in the inventory', () => {
  const found = discoverStores(['backend/src', 'frontend/src'].flatMap(directory => sources(resolve(repositoryRoot, directory))));
  for (const name of ['users', 'feedbacks', 'feedbackCooldowns', 'ride_sessions', 'messageRateLimits', '_privacy_deletion_requests', '_userAuthorization']) {
    assert(found.firestore.includes(name), `discovery finds ${name}`);
  }
  assert(found.rtdb.includes('_userAuthorization') && found.rtdb.includes('activeBuses'));
  assert.deepEqual(unclassifiedStores(found), { firestore: [], rtdb: [] });
});

test('discovery reports a store added through a literal, a constant or an RTDB template', () => {
  const found = discoverStores([{ path: 'x.ts', text: [
    'db.collection("newPassengerTable").doc(uid);', 'const AUDIT = "_new_audit"; db.collection(AUDIT).add({});',
    'doc(db, "browserStore", id);', 'rtdb.ref(`newTree/${uid}`);', 'const TREE = "_newMirror"; rtdb.ref(`${TREE}/${uid}`);',
  ].join('\n') }]);
  assert.deepEqual(unclassifiedStores(found), { firestore: ['_new_audit', 'browserStore', 'newPassengerTable'], rtdb: ['_newMirror', 'newTree'] });
});

test('the deletion worker deletes exactly the stores the inventory marks deleted', () => {
  const worker = workerDeletedCollections(read(DELETION_WORKER));
  const deleted = PASSENGER_STORES.filter(entry => entry.handling === 'deleted' && entry.store === 'firestore');
  assert.deepEqual(worker.direct.sort(), deleted.filter(entry => !entry.match.includes('/*/')).map(entry => entry.match.split('/')[0]).sort());
  assert.deepEqual(worker.groups, deleted.filter(entry => entry.match.includes('/*/')).map(entry => entry.match.split('/').at(-2)));
  assert.equal(worker.authDeleted, PASSENGER_STORES.find(entry => entry.id === 'auth').handling === 'deleted');
  assert.equal(worker.requestDeleted, PASSENGER_STORES.find(entry => entry.id === 'deletionRequest').handling === 'removed');
  assert.throws(() => workerDeletedCollections('await auth.deleteUser(uid);'), /fixed list/);
});

test('the deletion runbook names every deleted store and the retained categories', () => {
  const doc = read(DELETION_DOC);
  for (const path of ['users/{uid}', 'feedbackCooldowns/{uid}', 'passenger_requests/{uid}', 'messageRateLimits', '_privacy_deletion_requests/{uid}']) {
    assert(doc.includes(path), `${DELETION_DOC} names ${path}`);
  }
  assert.match(doc, /Feedback, passenger ride entries and messages are retained/);
  // Residual stores are, by definition, absent from the deletion runbook.
  for (const entry of PASSENGER_STORES.filter(item => item.handling === 'residual' && item.store === 'firestore')) {
    assert(!doc.includes(entry.match.split('/')[0]), `${entry.match} is residual only while ${DELETION_DOC} does not mention it`);
  }
});

test('residual and removed stores carry a recorded finding', () => {
  const ids = new Set(FINDINGS.map(finding => finding.id));
  assert.equal(ids.size, FINDINGS.length);
  for (const entry of PASSENGER_STORES) {
    if (entry.handling === 'residual') assert(entry.finding, `${entry.id} needs a finding`);
    if (entry.finding) assert(ids.has(entry.finding), `${entry.id} cites an unknown ${entry.finding}`);
  }
  assert.equal(new Set(PASSENGER_STORES.map(entry => entry.id)).size, PASSENGER_STORES.length);
});

test('sweep hits are allowed only in retained and residual stores', () => {
  assert(pathMatches('ride_sessions/*/messages/*', 'ride_sessions/s1/messages/m1'));
  assert(!pathMatches('ride_sessions/*', 'ride_sessions/s1/messages/m1'));
  assert.equal(entryForPath('firestore', 'users/u1').id, 'profile');
  assert.equal(entryForPath('rtdb', '_userAuthorization/u1').id, 'authorizationMirror');
  const hits = [
    { store: 'firestore', path: 'feedbacks/f1', categories: ['uid'] },
    { store: 'firestore', path: 'ride_sessions/s1/archivedMessages/m1', categories: ['message'] },
    { store: 'firestore', path: '_userAuthorization/u1', categories: ['uid'] },
    { store: 'firestore', path: 'users/u1', categories: ['email'] },
    { store: 'firestore', path: '_fleet_operations/o1', categories: ['uid'] },
    { store: 'auth', path: 'u1', categories: ['email'] },
  ];
  assert.deepEqual(unexpectedSweepHits(hits).map(hit => hit.path), ['users/u1', '_fleet_operations/o1', 'u1']);
});

const present = ids => Object.fromEntries(PASSENGER_STORES.map(entry => [entry.id, ids.includes(entry.id)]));
const passengerSeed = ['auth', 'profile', 'feedbackCooldown', 'chatRateLimit', 'deletionRequest', 'feedback', 'rideManifest', 'chatMessage'];
const retainedAfter = ['feedback', 'rideManifest', 'chatMessage'];
const verdictFor = (after, seeded = passengerSeed, extra = {}) => deletionVerdict({ sweepUnexpected: [], logHits: {}, accessChecks: [], ...extra,
  accounts: [{ label: 'p', results: evaluateAccount({ before: present(seeded), after: present(after), seeded }) }] });

test('a deletion that matches the inventory passes and every deviation fails', () => {
  assert.equal(verdictFor(retainedAfter).verdict, 'MATCHES_INVENTORY');
  assert.deepEqual(verdictFor([...retainedAfter, 'profile']).problems, ['p: profile NOT_DELETED']);
  assert.deepEqual(verdictFor(['rideManifest', 'chatMessage']).problems, ['p: feedback DELETED_CONTRARY_TO_POLICY']);
  assert.equal(verdictFor([...retainedAfter, 'fleetLock']).verdict, 'UNEXPECTED');
  const missingSeed = deletionVerdict({ sweepUnexpected: [], logHits: {}, accessChecks: [], accounts: [{ label: 'p',
    results: evaluateAccount({ before: present(['auth']), after: present([]), seeded: ['auth', 'profile'] }) }] });
  assert.deepEqual(missingSeed.problems, ['p: profile SEED_MISSING']);
  assert.deepEqual(verdictFor(retainedAfter, passengerSeed, { logHits: { uid: 2 } }).problems, ['log: 2 uid value(s)']);
  assert.equal(verdictFor(retainedAfter, passengerSeed, { accessChecks: [{ name: 'bootstrap', status: 200, passed: false }] }).verdict, 'UNEXPECTED');
  assert.equal(verdictFor(retainedAfter, passengerSeed, { sweepUnexpected: [{ store: 'firestore', path: 'users/u', categories: ['uid'] }] }).verdict, 'UNEXPECTED');
});

test('a recorded gap that no longer reproduces fails as stale', () => {
  const seeded = ['auth', 'profile', 'deletionRequest', 'authorizationRecord', 'authorizationMirror'];
  assert.equal(verdictFor(['authorizationRecord', 'authorizationMirror'], seeded).verdict, 'MATCHES_INVENTORY');
  const fixed = verdictFor([], seeded);
  assert.equal(fixed.verdict, 'STALE_FINDING');
  assert.deepEqual(fixed.problems, ['p: authorizationRecord RESIDUAL_GONE', 'p: authorizationMirror RESIDUAL_GONE']);
  const results = evaluateAccount({ before: {}, after: { auth: false, archivedMessage: null }, seeded: [] });
  assert.equal(results.find(result => result.id === 'archivedMessage').outcome, 'NOT_CHECKED');
  assert.equal(results.find(result => result.id === 'feedback').outcome, 'NOT_CHECKED');
});

test('log scanning counts synthetic values and tokens without copying text, and redaction removes them', () => {
  const token = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ user_id: 'qa_privacy_1a2b' })).toString('base64url')}.`;
  const markers = markersFor({ uid: 'qa_privacy_1a2b', email: 'qa_privacy_1a2b@example.invalid', displayName: 'Privacy Synthetic 1a2b',
    coordinates: ['23.000713', '72.000913'], messages: ['privacy probe 1a2b'], secrets: ['SyntheticOnly123!'] });
  const log = ['[Server] listening', `[Users] failed for users/qa_privacy_1a2b at 23.000713`, `Authorization: Bearer ${token}`, 'done'].join('\n');
  const scan = scanLog(log, markers);
  assert.deepEqual(scan.totals, { uid: 1, coordinates: 1, token: 1 });
  assert.deepEqual(scan.lines, [{ line: 2, categories: ['coordinates', 'uid'] }, { line: 3, categories: ['token'] }]);
  assert.deepEqual(scanText('Authorization: Bearer opaque-refresh-value-0123456789', markers), { token: 1 });
  assert(!JSON.stringify(scan).includes('qa_privacy_1a2b'));
  const redacted = redactText(log, markers);
  assert.deepEqual(scanText(redacted, markers), {});
  assert.match(redacted, /users\/<uid> at <coordinates>/);
  assert.equal(markersFor({ uid: 'abc', email: 'a@b.c', displayName: 'Pat' }).uid.length, 0, 'short values are not markers');
});

const now = Date.parse('2026-11-24T10:00:00Z');
const stagingEnv = (overrides = {}) => ({ EKI_PRIVACY_CONFIRM_PROJECT: STAGING_PROJECT_ID, EKI_PRIVACY_EXPECTED_REVISION: 'eki-backend-staging-00012-x7q',
  EKI_PRIVACY_TEST_UID: 'eki-qa-privacy-01', EKI_PRIVACY_REQUESTED_AT: '2026-11-24T15:10:00+05:30', ...overrides });

test('the staging verification refuses the wrong project, revision, account, time or an emulator target', () => {
  assert.deepEqual(assertPrivacyStagingRun(stagingEnv(), now), { uid: 'eki-qa-privacy-01', revision: 'eki-backend-staging-00012-x7q',
    requestedAt: Date.parse('2026-11-24T09:40:00Z'), waitMinutes: 15 });
  const refusals = [
    [{ EKI_PRIVACY_CONFIRM_PROJECT: 'eki-production' }, /CONFIRM_PROJECT/],
    [{ EKI_PRIVACY_CONFIRM_PROJECT: undefined }, /CONFIRM_PROJECT/],
    [{ EKI_PRIVACY_EXPECTED_REVISION: 'latest' }, /EXPECTED_REVISION/],
    [{ EKI_PRIVACY_TEST_UID: 'Xk3pQ9rT2bW7nY1cF5hJ8mL4vS6a' }, /dedicated test account/],
    [{ EKI_PRIVACY_TEST_UID: 'eki-qa-privacy-' }, /dedicated test account/],
    [{ EKI_PRIVACY_TEST_UID: 'qa-privacy-01' }, /dedicated test account/],
    [{ EKI_PRIVACY_REQUESTED_AT: '2026-11-24 15:10' }, /ISO 8601/],
    [{ EKI_PRIVACY_REQUESTED_AT: '2026-11-24T15:10:00' }, /ISO 8601/],
    [{ EKI_PRIVACY_REQUESTED_AT: '2026-11-25T15:10:00+05:30' }, /last 7 days/],
    [{ EKI_PRIVACY_REQUESTED_AT: '2026-11-01T15:10:00+05:30' }, /last 7 days/],
    [{ EKI_PRIVACY_WAIT_MINUTES: '120' }, /0 to 60/],
    [{ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085' }, /emulator instead of staging/],
  ];
  for (const [overrides, message] of refusals) assert.throws(() => assertPrivacyStagingRun(stagingEnv(overrides), now), message, JSON.stringify(overrides));
});

test('the staging plan is read-only and the executor refuses any other operation before reading', async () => {
  const plan = stagingReadPlan('eki-qa-privacy-01');
  assert(plan.every(step => READ_OPERATIONS.includes(step.op)));
  const coverage = new Set(plan.map(step => step.id));
  for (const entry of PASSENGER_STORES) if (entry.id !== 'archivedMessage') assert(coverage.has(entry.id), `${entry.id} is read on staging`);
  let calls = 0;
  const readers = Object.fromEntries(READ_OPERATIONS.map(op => [op, async step => { calls += 1; return step.op.startsWith('count') ? 2 : step.id === 'feedback'; }]));
  const result = await executeReadPlan(plan, readers);
  assert.equal(calls, plan.length);
  assert.equal(result.counts.feedback, 2);
  assert.equal(result.observed.chatMessage, true);
  assert.equal(result.observed.profile, false);
  calls = 0;
  await assert.rejects(executeReadPlan([...plan, { id: 'x', op: 'deleteDocument', path: 'users/x' }], { ...readers, deleteDocument: async () => true }), /non-read operation deleteDocument/);
  assert.equal(calls, 0, 'nothing runs when the plan holds a write');
});

test('the serving revision is the one that takes all traffic', () => {
  assert.equal(servingRevision({ trafficStatuses: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'eki-backend-staging-00009-7sh', percent: 100 }] }), 'eki-backend-staging-00009-7sh');
  assert.equal(servingRevision({ latestReadyRevision: 'projects/p/locations/l/services/s/revisions/eki-backend-staging-00010-abc',
    trafficStatuses: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }] }), 'eki-backend-staging-00010-abc');
  assert.equal(servingRevision({ trafficStatuses: [{ revision: 'a', percent: 50 }, { revision: 'b', percent: 50 }] }), null);
  assert.equal(servingRevision({}), null);
});

test('request hosts map to vendors, and every host the committed CSP permits has a vendor', () => {
  const expected = {
    'bustrack-be165.web.app': 'firebase-hosting', 'bustrack-be165.firebaseapp.com': 'firebase-hosting',
    'identitytoolkit.googleapis.com': 'firebase-auth', 'securetoken.googleapis.com': 'firebase-auth', 'apis.google.com': 'google-sign-in',
    'firestore.googleapis.com': 'firestore', 'bustrack-be165-asia-rtdb.asia-southeast1.firebasedatabase.app': 'firebase-rtdb',
    's-gke-usc1-nssi3-3.firebaseio.com': 'firebase-rtdb', 'eki-backend-staging-449313371438.asia-south2.run.app': 'cloud-run',
    'maps.googleapis.com': 'google-maps', 'khms0.googleapis.com': 'google-apis', 'lh3.googleusercontent.com': 'google-user-content',
    'www.gstatic.com': 'google-static', 'fonts.gstatic.com': 'google-fonts', '127.0.0.1:24524': 'local',
  };
  for (const [host, id] of Object.entries(expected)) assert.equal(vendorForHost(host)?.id, id, host);
  for (const host of ['www.google-analytics.com', 'connect.facebook.net', 'web.app.evil.example', 'googleapis.com.evil.example']) assert.equal(vendorForHost(host), null, host);
  const hosting = JSON.parse(read('firebase.json')).hosting;
  const csp = hosting.headers.find(rule => rule.source === '**').headers.find(header => header.key === 'Content-Security-Policy').value;
  const hosts = [...new Set(Object.values(cspHostSources(csp)).flat())];
  assert(hosts.includes('maps.googleapis.com') && hosts.includes('*.firebaseio.com'));
  assert.deepEqual(hosts.filter(host => !vendorForCspHost(host)), [], 'a new CSP host needs a VENDORS entry');
  assert.equal(new Set(VENDORS.map(vendor => vendor.id)).size, VENDORS.length);
});

test('declared vendors come from notice text, and disclosure fails on undeclared, unmapped or missing notices', () => {
  assert.deepEqual(declaredVendors('We use Google Maps and Sign in with Google. Firebased is not a word here.'), ['google-sign-in', 'google-maps', 'google-user-content', 'google-static']);
  assert.deepEqual(declaredVendors('Hosting and storage: Google Firebase.').sort(), ['firebase-auth', 'firebase-hosting', 'firebase-rtdb', 'firestore', 'google-apis', 'google-static'].sort());
  assert.deepEqual(declaredVendors(''), []);
  const observedHosts = ['bustrack-be165.web.app', 'maps.googleapis.com'];
  assert.equal(evaluateDisclosure({ observedHosts, declared: ['firebase-hosting'] }).verdict, 'UNDECLARED_VENDORS');
  assert.deepEqual(evaluateDisclosure({ observedHosts, declared: ['firebase-hosting'] }).undeclared, ['google-maps']);
  assert.equal(evaluateDisclosure({ observedHosts: [...observedHosts, 'tracker.example'], declared: ['firebase-hosting', 'google-maps'] }).verdict, 'UNMAPPED_HOSTS');
  const disclosed = evaluateDisclosure({ observedHosts, declared: ['firebase-hosting', 'google-maps', 'firestore'] });
  assert.equal(disclosed.verdict, 'DISCLOSED');
  assert.deepEqual(disclosed.warnings, ['declared vendor firestore never loaded']);
  assert.equal(evaluateDisclosure({ observedHosts: [], declared: [], noticeAvailable: false }).verdict, 'NO_NOTICE');
  assert.equal(configuredNoticeUrl('[{ label: "Privacy notice", href: "https://example.invalid/privacy" }]'), 'https://example.invalid/privacy');
  assert.equal(typeof configuredNoticeUrl(read('frontend/src/config/university.ts')), 'string');
  assert.throws(() => configuredNoticeUrl('[]'), /no longer has/);
});
