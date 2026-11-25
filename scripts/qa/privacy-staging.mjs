/**
 * Guards and the read plan of the read-only staging deletion check
 * (qa/PRIVACY_VERIFICATION.md, Section 4.4). Pure functions; the runner
 * scripts/qa/run-privacy-deletion.mjs makes every request.
 */

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
