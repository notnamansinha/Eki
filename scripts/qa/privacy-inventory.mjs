/**
 * Passenger personal-data inventory, and the evaluation of a deletion run
 * against it (qa/PRIVACY_VERIFICATION.md, Section 3).
 *
 * The inventory is derived from backend/src and frontend/src. The unit tests
 * in scripts/qa-privacy.test.mjs fail when the code adds a Firestore
 * collection or RTDB root that is not classified here, or when the deletion
 * worker's list of deleted stores changes. Everything in this module is a pure
 * function of its inputs. Leak markers are in privacy-markers.mjs and the
 * staging guards and read plan in privacy-staging.mjs;
 * scripts/qa/run-privacy-deletion.mjs owns every process, emulator and network step.
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
    writer: 'Firebase Authentication', handling: 'deleted' },
  { id: 'profile', store: 'firestore', match: 'users/{uid}', fields: 'uid, email, displayName, photoURL, role, createdAt',
    writer: 'backend/src/routes/users.ts (POST /api/users/bootstrap)', handling: 'deleted' },
  { id: 'feedbackCooldown', store: 'firestore', match: 'feedbackCooldowns/{uid}', fields: 'userId, feedbackId, lastSubmittedAt',
    writer: 'frontend/src/lib/feedbackStore.ts (browser, under firestore.rules)', handling: 'deleted' },
  { id: 'passengerRequest', store: 'firestore', match: 'passenger_requests/{uid}', fields: 'passengerId, busId, type, lat, lng, status, createdAt',
    writer: 'Legacy: no current writer; admin PATCH and DELETE /api/requests/{id}', handling: 'deleted' },
  { id: 'chatRateLimit', store: 'firestore', match: 'ride_sessions/*/messageRateLimits/{uid}', fields: 'userId, sentAt, lastSentAt',
    writer: 'backend/src/routes/sessions.ts (message send)', handling: 'deleted' },
  { id: 'deletionRequest', store: 'firestore', match: '_privacy_deletion_requests/{uid}',
    fields: 'Document ID is the UID; targetCreatedAt (Auth creation time), status, attempt, error and recovery fields',
    writer: 'backend/src/services/privacyDeletionRequests.ts', handling: 'removed', finding: 'PRIV-01' },
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
    writer: 'backend/src/services/privacyDeletionWorker.ts (scan checkpoint)', handling: 'transient', finding: 'PRIV-03' },
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

/**
 * Findings the inventory and the runs support, by ID, severity and title. Each is
 * described once, in qa/PRIVACY_VERIFICATION.md Section 3.1. Severity is an
 * engineering estimate, not a legal assessment.
 */
export const FINDINGS = Object.freeze([
  { id: 'PRIV-01', severity: 'Medium', title: 'No record of a completed deletion survives' },
  { id: 'PRIV-02', severity: 'Low', title: 'Authorization records of former operators survive deletion' },
  { id: 'PRIV-03', severity: 'Low', title: 'The privacy scan cursor can name a pending UID' },
  { id: 'PRIV-04', severity: 'Unknown', title: 'Legacy RTDB trees are outside the deletion' },
  { id: 'PRIV-05', severity: 'Medium', title: 'No completion-time commitment' },
  { id: 'PRIV-06', severity: 'Medium', title: 'No export or data-access path' },
  { id: 'PRIV-07', severity: 'High', title: 'No privacy notice is published' },
  { id: 'PRIV-08', severity: 'Low', title: 'Error logs print raw error objects' },
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
