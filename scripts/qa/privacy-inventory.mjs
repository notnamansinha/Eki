/**
 * Passenger personal-data inventory and the checks around account deletion
 * (issue #524, qa/PRIVACY_VERIFICATION.md).
 *
 * The inventory is derived from backend/src and frontend/src. The unit tests
 * in scripts/qa-privacy.test.mjs fail when the code adds a Firestore
 * collection or RTDB root that is not classified here, or when the deletion
 * worker's list of deleted stores changes. Everything in this module is a pure
 * function of its inputs; scripts/qa/run-privacy-deletion.mjs owns every
 * process, emulator and network step.
 */

export const DELETION_WORKER = 'backend/src/services/privacyDeletionWorker.ts';
export const DELETION_DOC = 'docs/operations/PRIVACY_DELETION.md';

/**
 * Stores that hold passenger personal data or are keyed by a passenger UID.
 * `handling` is what the code does when a passenger account is deleted:
 *   deleted    the worker removes it
 *   removed    the deletion queue record, removed when deletion succeeds
 *   retained   kept by the documented policy (PRIVACY_DELETION.md Section 2)
 *   residual   kept, and not named by the deletion policy (a finding)
 *   transient  holds the UID only while a deletion is queued or running
 * `match` is the path pattern of the records (`*` is one path segment).
 */
export const PASSENGER_STORES = Object.freeze([
  { id: 'auth', store: 'auth', match: '{uid}', fields: 'UID, e-mail, display name, photo URL, sign-in providers, custom claims',
    writer: 'Firebase Authentication', handling: 'deleted', code: 'privacyDeletionWorker.ts auth.deleteUser' },
  { id: 'profile', store: 'firestore', match: 'users/{uid}', fields: 'uid, email, displayName, photoURL, role, createdAt',
    writer: 'backend/src/routes/users.ts (POST /api/users/bootstrap)', handling: 'deleted', code: 'privacyDeletionWorker.ts:66' },
  { id: 'feedbackCooldown', store: 'firestore', match: 'feedbackCooldowns/{uid}', fields: 'userId, feedbackId, lastSubmittedAt',
    writer: 'frontend/src/lib/feedbackStore.ts (browser, under firestore.rules)', handling: 'deleted', code: 'privacyDeletionWorker.ts:66' },
  { id: 'passengerRequest', store: 'firestore', match: 'passenger_requests/{uid}', fields: 'passengerId, busId, type, lat, lng, status, createdAt',
    writer: 'Legacy: no current writer; admin PATCH and DELETE /api/requests/{id}', handling: 'deleted', code: 'privacyDeletionWorker.ts:66' },
  { id: 'chatRateLimit', store: 'firestore', match: 'ride_sessions/*/messageRateLimits/{uid}', fields: 'userId, sentAt, lastSentAt',
    writer: 'backend/src/routes/sessions.ts (message send)', handling: 'deleted', code: 'privacyDeletionWorker.ts:55' },
  { id: 'deletionRequest', store: 'firestore', match: '_privacy_deletion_requests/{uid}',
    fields: 'Document ID is the UID; targetCreatedAt (Auth creation time), status, attempt, error and recovery fields',
    writer: 'backend/src/services/privacyDeletionRequests.ts', handling: 'removed', code: 'privacyDeletionWorker.ts:71', finding: 'PRIV-01' },
  { id: 'feedback', store: 'firestore', match: 'feedbacks/*', fields: 'userId, userName, comment, rating, sessionId, busId, driverId, timestamp',
    writer: 'frontend/src/lib/feedbackStore.ts (browser, under firestore.rules)', handling: 'retained' },
  { id: 'rideManifest', store: 'firestore', match: 'ride_sessions/*', fields: 'passengers.{uid}: userId, userName, boardingStopId, alightingStopId, joinedAt; passengerIds[]',
    writer: 'backend/src/routes/sessions.ts (boarding)', handling: 'retained' },
  { id: 'chatMessage', store: 'firestore', match: 'ride_sessions/*/messages/*', fields: 'senderId, senderName, text, requestHash, timestamp',
    writer: 'backend/src/routes/sessions.ts (message send)', handling: 'retained' },
  { id: 'archivedMessage', store: 'firestore', match: 'ride_sessions/*/archivedMessages/*', fields: 'Copy of a cleared message',
    writer: 'backend/src/routes/shifts.ts (admin message clear)', handling: 'retained' },
  { id: 'authorizationRecord', store: 'firestore', match: '_userAuthorization/{uid}', fields: 'Document ID is the UID; version, role, driverId, assignedBusId',
    writer: 'backend/src/services/userAuthorization.ts', handling: 'residual', finding: 'PRIV-02',
    scope: 'Accounts that were once operators or administrators (fleet demotion, role sync)' },
  { id: 'authorizationMirror', store: 'rtdb', match: '_userAuthorization/{uid}', fields: 'Key is the UID; version, role, driverId, assignedBusId',
    writer: 'backend/src/services/userAuthorization.ts', handling: 'residual', finding: 'PRIV-02',
    scope: 'Accounts that were once operators or administrators (fleet demotion, role sync)' },
  { id: 'fleetLock', store: 'firestore', match: '_fleet_reconciliation_locks/singleton', fields: 'privacyRequestId names the UID being deleted',
    writer: 'backend/src/services/fleetMutationLock.ts', handling: 'transient' },
  { id: 'privacyCursor', store: 'firestore', match: '_reconciliation_cursors/privacy-deletions', fields: 'cursor names the last pending UID of a full 20-request page',
    writer: 'backend/src/services/privacyDeletionWorker.ts:113', handling: 'transient', finding: 'PRIV-03' },
  { id: 'legacyRtdbUsers', store: 'rtdb', match: 'users/{uid}', fields: 'Legacy tree; no current writer or reader',
    writer: 'None in current code', handling: 'residual', finding: 'PRIV-04' },
]);

/** Firestore collections and RTDB roots in the code that hold no passenger personal data. */
export const OTHER_STORES = Object.freeze({
  firestore: {
    routes: 'Route configuration', buses: 'Vehicle registry', devices: 'Tracker registry and credential hashes',
    drivers: 'Operator registry; authUid names an operator account, and deletion refuses operator accounts',
    settings: 'Global settings; updatedBy names an administrator', active_rides: 'Ride checkpoint; driver and vehicle only',
    _active_bus_locks: 'One ride per bus; driver and vehicle only', bus_locations: 'Per-bus lifecycle projection',
    completed_trips: 'Completed ride summary; no passenger fields', _worker_leases: 'Worker lease',
    _route_save_operations: 'Admin route saves', _route_geometry_previews: 'Admin operations; administrator UID',
    _fleet_reconciliation_jobs: 'Admin operations; administrator UID', _fleet_operations: 'Fleet mutation audit; administrator UID',
    _fleet_lock_recoveries: 'Lock recovery audit; administrator UID', _ride_history_deletion_jobs: 'Session ID retry marker',
    _retention_deletion_jobs: 'Session ID retry marker', _ride_session_creation_keys: 'Ride start idempotency; driver scope',
    _device_diagnostics: 'Tracker diagnostics', _rtdb_retention_inventory: 'RTDB paths of operational data', _health: 'Health probe',
    messages: 'Subcollection; see chatMessage', archivedMessages: 'Subcollection; see archivedMessage',
    messageRateLimits: 'Subcollection; see chatRateLimit', _reconciliation_cursors: 'Scan cursors; see privacyCursor',
    _fleet_reconciliation_locks: 'Fleet mutex; see fleetLock',
  },
  rtdb: {
    activeBuses: 'Live vehicle state; driver and vehicle only', activeRouteGeometry: 'Reroute polylines',
    publicRouteBuses: 'Public vehicle projection', liveRouteCatalog: 'Route availability',
    clientProjectionStatus: 'Projection readiness', driverRouteAssignments: 'Operator assignments',
    _deviceRateLimits: 'Tracker rate limits', _deviceCredentialVersions: 'Tracker credential versions',
    _health: 'Health probe', messages: 'Legacy tree; no current writer (rtdbRetention.ts)', '.info': 'SDK connection metadata',
  },
});

/** Findings the inventory and the runs support. Severity is an engineering estimate, not a legal assessment. */
export const FINDINGS = Object.freeze([
  { id: 'PRIV-01', severity: 'Medium', title: 'No record of a completed deletion survives',
    detail: 'The worker deletes _privacy_deletion_requests/{uid}, the only record of the request, when deletion succeeds, and logs omit UIDs. Nothing shows afterwards that a deletion was requested or when it finished, so the completion time cannot be evidenced on a deployed project.' },
  { id: 'PRIV-02', severity: 'Low', title: 'Authorization records of former operators survive deletion',
    detail: '_userAuthorization/{uid} in Firestore and RTDB is keyed by the UID and holds the role and version. Fleet demotion and role sync write it; the deletion worker does not remove it, and PRIVACY_DELETION.md does not list it as retained.' },
  { id: 'PRIV-03', severity: 'Low', title: 'The privacy scan cursor can name a pending UID',
    detail: 'When a scan page holds 20 pending requests, _reconciliation_cursors/privacy-deletions.cursor stores the last UID of the page until the next scan, even if that account has been deleted in the meantime.' },
  { id: 'PRIV-04', severity: 'Unknown', title: 'Legacy RTDB trees are outside the deletion',
    detail: 'RTDB users and messages have no writer in current code. The deletion worker does not touch them, and the retention sweep removes them only when LEGACY_RTDB_RETIRED=true (staging sets false). Whether a deployed project still holds passenger data there is unverified.' },
  { id: 'PRIV-05', severity: 'Medium', title: 'No completion-time commitment',
    detail: 'PRIVACY_DELETION.md states that there is no guaranteed completion time. The worker scans every 60 s while an instance holds the lease; staging scales to zero, so a request waits until an instance starts.' },
  { id: 'PRIV-06', severity: 'Medium', title: 'No export or data-access path',
    detail: 'No endpoint, screen or procedure lets a passenger obtain a copy or summary of their data. The browser can read only the passenger\'s own profile, feedback cooldown and feedback by ID.' },
  { id: 'PRIV-07', severity: 'High', title: 'No privacy notice is published',
    detail: 'UNIVERSITY_LINKS in frontend/src/config/university.ts leaves the privacy notice and terms URLs empty, so both links are hidden, and no page states purposes, retention, a grievance contact, a lawful basis or sub-processors.' },
  { id: 'PRIV-08', severity: 'Low', title: 'Error logs print raw error objects',
    detail: 'Many handlers (for example users.ts:127, sessions.ts:68) log the raw error. Firestore errors can quote a document path such as users/{uid}. The happy-path emulator run logged no synthetic identifier.' },
]);

const segmentPattern = segment => segment === '*' || segment === '{uid}' ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patternCache = new Map();
/** Whether a store path (`a/b/c`) matches an inventory pattern such as `ride_sessions/*`. */
export function pathMatches(pattern, path) {
  if (!patternCache.has(pattern)) patternCache.set(pattern, new RegExp(`^${pattern.split('/').map(segmentPattern).join('/')}$`));
  return patternCache.get(pattern).test(path);
}

/** The inventory entry that covers a path in a store, or null. */
export function entryForPath(store, path) {
  return PASSENGER_STORES.find(entry => entry.store === store && pathMatches(entry.match, path)) ?? null;
}

// ---- code discovery --------------------------------------------------------

const quoted = String.raw`["'\x60]`;
const firestorePatterns = [
  new RegExp(String.raw`\bcollection(?:Group)?\(\s*${quoted}([A-Za-z_][\w-]*)${quoted}`, 'g'),
  new RegExp(String.raw`\b(?:collection|doc)\(\s*\w+\s*,\s*${quoted}([A-Za-z_][\w-]*)${quoted}`, 'g'),
];
const rtdbPatterns = [
  new RegExp(String.raw`\bref\(\s*(?:\w+\s*,\s*)?${quoted}\/?([A-Za-z_.][\w.-]*)`, 'g'),
];
const constantPattern = /\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*["'`](_?[A-Za-z][\w-]*)["'`]/g;

/**
 * Firestore collection names and RTDB roots that the given source files use.
 * `files` are `{ path, text }`; test files are the caller's to exclude.
 */
export function discoverStores(files) {
  const firestore = new Set(); const rtdb = new Set();
  for (const { text } of files) {
    const constants = new Map([...text.matchAll(constantPattern)].map(match => [match[1], match[2]]));
    for (const pattern of firestorePatterns) for (const match of text.matchAll(pattern)) firestore.add(match[1]);
    for (const pattern of rtdbPatterns) for (const match of text.matchAll(pattern)) rtdb.add(match[1].split('/')[0]);
    for (const [name, value] of constants) {
      if (new RegExp(String.raw`\bcollection\(\s*${name}\b`).test(text)) firestore.add(value);
      if (new RegExp(String.raw`\bref\(\s*(?:${name}\b|\x60\$\{${name}\})`).test(text)) rtdb.add(value);
    }
  }
  return { firestore: [...firestore].sort(), rtdb: [...rtdb].sort() };
}

const rootOf = match => match.split('/')[0].split('.')[0];
/** Names the inventory does not classify; the unit test requires none. */
export function unclassifiedStores({ firestore, rtdb }) {
  const roots = store => new Set(PASSENGER_STORES.filter(entry => entry.store === store).map(entry => rootOf(entry.match)));
  const known = { firestore: new Set([...roots('firestore'), ...Object.keys(OTHER_STORES.firestore)]),
    rtdb: new Set([...roots('rtdb'), ...Object.keys(OTHER_STORES.rtdb)]) };
  return { firestore: firestore.filter(name => !known.firestore.has(name)), rtdb: rtdb.filter(name => !known.rtdb.has(name)) };
}

/** The collections the deletion worker deletes by UID, read from its source. */
export function workerDeletedCollections(workerSource) {
  const list = /for \(const name of \[([^\]]+)\]\) transaction\.delete\(db\.collection\(name\)\.doc\(uid\)\)/.exec(workerSource);
  if (!list) throw new Error('The deletion worker no longer deletes a fixed list of per-UID documents');
  const direct = [...list[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  const groups = [...workerSource.matchAll(/collectionGroup\("([^"]+)"\)\.where\("userId", "==", uid\)/g)].map(match => match[1]);
  return { direct, groups, authDeleted: /auth\.deleteUser\(uid\)/.test(workerSource), requestDeleted: /writer\.delete\(ref\)/.test(workerSource) };
}

// ---- markers and scanning --------------------------------------------------

/** Distinctive synthetic values for one seeded account, by category. */
export function markersFor(identity) {
  const markers = { uid: [identity.uid], email: [identity.email], name: [identity.displayName],
    photo: identity.photoURL ? [identity.photoURL] : [], coordinates: identity.coordinates ?? [],
    message: identity.messages ?? [], feedback: identity.feedback ? [identity.feedback] : [],
    secret: identity.secrets ?? [] };
  return Object.fromEntries(Object.entries(markers).map(([key, values]) => [key, values.filter(value => typeof value === 'string' && value.length >= 6)]));
}

const TOKEN_PATTERN = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const BEARER_PATTERN = /\bBearer\s+(?!eyJ)[A-Za-z0-9._-]{20,}/g; // a JWT is counted once, by TOKEN_PATTERN

/** Categories of markers found in `text`; `token` also catches any JWT or bearer value. */
export function scanText(text, markers) {
  const found = {};
  for (const [category, values] of Object.entries(markers)) {
    const count = values.reduce((sum, value) => sum + text.split(value).length - 1, 0);
    if (count) found[category] = count;
  }
  const tokens = (text.match(TOKEN_PATTERN)?.length ?? 0) + (text.match(BEARER_PATTERN)?.length ?? 0);
  if (tokens) found.token = tokens;
  return found;
}

/** Scan a log line by line; returns hit counts and the first line numbers, never the text. */
export function scanLog(text, markers, { maxLines = 20 } = {}) {
  const totals = {}; const lines = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const found = scanText(line, markers);
    if (!Object.keys(found).length) return;
    for (const [category, count] of Object.entries(found)) totals[category] = (totals[category] ?? 0) + count;
    if (lines.length < maxLines) lines.push({ line: index + 1, categories: Object.keys(found).sort() });
  });
  return { lineCount: text ? text.split(/\r?\n/).length : 0, totals, lines };
}

/** Replace every marker and token in `text` with its category label. */
export function redactText(text, markers) {
  let result = text;
  const pairs = Object.entries(markers).flatMap(([category, values]) => values.map(value => [value, `<${category}>`]))
    .sort((a, b) => b[0].length - a[0].length);
  for (const [value, label] of pairs) result = result.split(value).join(label);
  return result.replace(TOKEN_PATTERN, '<token>').replace(BEARER_PATTERN, 'Bearer <token>');
}

// ---- evaluation ------------------------------------------------------------

/**
 * Compare one account's observations with the inventory.
 * `before` and `after` map an entry ID to `true` (present), `false` (absent)
 * or `null` (not checked). Present-before is required for every entry the
 * run seeded, so an absent-after result is not vacuous.
 */
export function evaluateAccount({ before, after, seeded }) {
  const results = [];
  for (const entry of PASSENGER_STORES) {
    const was = before[entry.id]; const is = after[entry.id];
    if (is === undefined || is === null) { results.push({ id: entry.id, outcome: 'NOT_CHECKED' }); continue; }
    if (seeded.includes(entry.id) && was !== true) { results.push({ id: entry.id, outcome: 'SEED_MISSING' }); continue; }
    let outcome;
    if (['deleted', 'removed', 'transient'].includes(entry.handling)) outcome = is ? 'NOT_DELETED' : 'DELETED';
    else if (entry.handling === 'retained') outcome = is ? 'RETAINED' : (seeded.includes(entry.id) ? 'DELETED_CONTRARY_TO_POLICY' : 'ABSENT');
    else outcome = is ? 'RESIDUAL' : (seeded.includes(entry.id) ? 'RESIDUAL_GONE' : 'ABSENT');
    results.push({ id: entry.id, outcome, ...(entry.finding ? { finding: entry.finding } : {}) });
  }
  return results;
}

const failing = new Set(['SEED_MISSING', 'NOT_DELETED', 'DELETED_CONTRARY_TO_POLICY', 'RESIDUAL_GONE']);

/**
 * Overall verdict for a local run. Known residual stores (with a finding)
 * pass as recorded gaps; a gap that no longer reproduces fails as stale, so
 * the inventory is updated when the code is fixed.
 */
export function deletionVerdict({ accounts, sweepUnexpected, logHits, accessChecks }) {
  const problems = [];
  for (const account of accounts) {
    for (const result of account.results) {
      if (failing.has(result.outcome)) problems.push(`${account.label}: ${result.id} ${result.outcome}`);
    }
  }
  for (const hit of sweepUnexpected) problems.push(`sweep: ${hit.store} ${hit.path} holds ${hit.categories.join(', ')}`);
  for (const [category, count] of Object.entries(logHits)) problems.push(`log: ${count} ${category} value(s)`);
  for (const check of accessChecks) if (!check.passed) problems.push(`access: ${check.name} returned ${check.status}`);
  const stale = problems.filter(problem => problem.includes('RESIDUAL_GONE'));
  return { verdict: problems.length === 0 ? 'MATCHES_INVENTORY' : stale.length === problems.length ? 'STALE_FINDING' : 'UNEXPECTED', problems };
}

/** Sweep hits outside the stores the inventory allows to keep data after deletion. */
export function unexpectedSweepHits(hits) {
  return hits.filter(hit => !['retained', 'residual'].includes(entryForPath(hit.store, hit.path)?.handling));
}

// ---- staging ---------------------------------------------------------------

export const STAGING_PROJECT_ID = 'bustrack-be165';
export const STAGING_RTDB_URL = 'https://bustrack-be165-asia-rtdb.asia-southeast1.firebasedatabase.app';
export const STAGING_SERVICE = 'projects/bustrack-be165/locations/asia-south2/services/eki-backend-staging';
const STAGING_REVISION = /^eki-backend-staging-[0-9]{5}-[a-z0-9]{3}$/;
// A dedicated test account is created with an Admin SDK UID that carries this
// marker. Firebase-generated UIDs are 28 alphanumeric characters without
// hyphens, so a real passenger's UID cannot match.
export const TEST_UID = /^eki-qa-privacy-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMULATOR_KEYS = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'];

/** Preconditions of a read-only staging verification. Throws with the first unmet one. */
export function assertPrivacyStagingRun(env, now = Date.now()) {
  if (env.EKI_PRIVACY_CONFIRM_PROJECT !== STAGING_PROJECT_ID) {
    throw new Error(`EKI_PRIVACY_CONFIRM_PROJECT must equal ${STAGING_PROJECT_ID}`);
  }
  const revision = env.EKI_PRIVACY_EXPECTED_REVISION?.trim() ?? '';
  if (!STAGING_REVISION.test(revision)) throw new Error('EKI_PRIVACY_EXPECTED_REVISION must name the serving eki-backend-staging revision');
  const uid = env.EKI_PRIVACY_TEST_UID?.trim() ?? '';
  if (!TEST_UID.test(uid) || uid.length > 64) {
    throw new Error('EKI_PRIVACY_TEST_UID must be a dedicated test account whose UID starts with eki-qa-privacy-');
  }
  const requestedAt = Date.parse(env.EKI_PRIVACY_REQUESTED_AT ?? '');
  if (!Number.isFinite(requestedAt) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(env.EKI_PRIVACY_REQUESTED_AT)) {
    throw new Error('EKI_PRIVACY_REQUESTED_AT must be the ISO 8601 time, with offset, when Delete account was confirmed');
  }
  if (requestedAt > now + 60_000 || now - requestedAt > 7 * 24 * 3_600_000) {
    throw new Error('EKI_PRIVACY_REQUESTED_AT must be within the last 7 days');
  }
  const waitMinutes = env.EKI_PRIVACY_WAIT_MINUTES === undefined ? 15 : Number(env.EKI_PRIVACY_WAIT_MINUTES);
  if (!Number.isInteger(waitMinutes) || waitMinutes < 0 || waitMinutes > 60) throw new Error('EKI_PRIVACY_WAIT_MINUTES must be 0 to 60');
  for (const key of EMULATOR_KEYS) if (env[key]) throw new Error(`${key} is set: unset it, or the run would read an emulator instead of staging`);
  return { uid, revision, requestedAt, waitMinutes };
}

/**
 * Every read the staging verification makes, as data. The runner executes
 * only these operations, and only read operations exist.
 */
export function stagingReadPlan(uid) {
  return [
    { id: 'auth', op: 'getUser', path: uid },
    { id: 'profile', op: 'getDocument', path: `users/${uid}` },
    { id: 'feedbackCooldown', op: 'getDocument', path: `feedbackCooldowns/${uid}` },
    { id: 'passengerRequest', op: 'getDocument', path: `passenger_requests/${uid}` },
    { id: 'chatRateLimit', op: 'countGroup', group: 'messageRateLimits', field: 'userId', value: uid },
    { id: 'deletionRequest', op: 'getDocument', path: `_privacy_deletion_requests/${uid}` },
    { id: 'feedback', op: 'count', collection: 'feedbacks', field: 'userId', value: uid },
    { id: 'rideManifest', op: 'countArray', collection: 'ride_sessions', field: 'passengerIds', value: uid },
    { id: 'chatMessage', op: 'countGroup', group: 'messages', field: 'senderId', value: uid },
    { id: 'authorizationRecord', op: 'getDocument', path: `_userAuthorization/${uid}` },
    { id: 'authorizationMirror', op: 'getRtdb', path: `_userAuthorization/${uid}` },
    { id: 'fleetLock', op: 'getField', path: '_fleet_reconciliation_locks/singleton', field: 'privacyRequestId', value: uid },
    { id: 'privacyCursor', op: 'getField', path: '_reconciliation_cursors/privacy-deletions', field: 'cursor', value: uid },
    { id: 'legacyRtdbUsers', op: 'getRtdb', path: `users/${uid}` },
  ];
}
export const READ_OPERATIONS = Object.freeze(['getUser', 'getDocument', 'count', 'countArray', 'countGroup', 'getField', 'getRtdb']);

/** Run a staging read plan through read-only readers; any other operation is refused before it runs. */
export async function executeReadPlan(plan, readers) {
  for (const step of plan) {
    if (!READ_OPERATIONS.includes(step.op) || typeof readers[step.op] !== 'function') throw new Error(`Refusing non-read operation ${step.op}`);
  }
  const observed = {}; const counts = {};
  for (const step of plan) {
    const value = await readers[step.op](step);
    if (typeof value === 'number') { counts[step.id] = value; observed[step.id] = value > 0; } else observed[step.id] = value === true;
  }
  return { observed, counts };
}

/** The revision that serves 100 % of traffic, from a Cloud Run Admin API v2 service resource. */
export function servingRevision(service) {
  const statuses = Array.isArray(service?.trafficStatuses) ? service.trafficStatuses : [];
  const full = statuses.filter(status => status.percent === 100);
  if (full.length !== 1) return null;
  const name = full[0].revision || (full[0].type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST' ? service.latestReadyRevision : '');
  const revision = typeof name === 'string' ? name.split('/').at(-1) : '';
  // A Cloud Run revision name (RFC 1035 label), so the evidence never records other response text.
  return /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(revision) ? revision : null;
}
