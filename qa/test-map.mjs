import { gnssTestMap } from './gnss-test-map.mjs';
import { emulatorTestMap } from './emulator-test-map.mjs';
import { browserTestMap } from './browser-test-map.mjs';
import { mutationTestMap } from './mutation-test-map.mjs';
import { apiTestMap } from './api-test-map.mjs';
import { nativeTestMap } from './native-test-map.mjs';
import { reviewedUnitTestMap } from './reviewed-unit-test-map.mjs';
import { mergeTestMaps } from '../scripts/qa/merge-test-maps.mjs';
import { routingTestMap } from './routing-test-map.mjs';
// Exact limited assertion links; no complete feature acceptance is claimed.
export const testMap = mergeTestMaps([{
  caseId: 'OPS14',
  scope: 'A single exact closed-Firestore-transaction error restarts a fresh creation/recovery transaction once, retaining one session identity and rerunning firmware ownership checks. Other errors and repeat failure propagate.',
  sourcePaths: ['backend/src/routes/shifts.ts'],
  tests: [
    ['recovers a closed lock transaction without duplicating a ride', 'A rolled-back lock creation is retried once with the same proposed session ID, one durable ride and the same idempotent acknowledgement.'],
    ['recovers a closed projection transaction without duplicating a ride', 'A rolled-back projection is repaired using the already-created ride and its original reservation, without creating another session.'],
    ['rechecks a firmware lock acquired during closed transaction recovery', 'A firmware reservation acquired between attempts remains intact; the fresh transaction rejects ride creation with 409.'],
    ['bounds closed transaction recovery and propagates other invalid arguments', 'Two closed responses stop after two attempts; another INVALID_ARGUMENT detail is not retried and no ride is created.'],
    ['updates an existing ride from a cold RTDB transaction cache', 'An initial SDK null does not abort a delay update before the real active ride is evaluated.'],
    ['still rejects a replacement when a cold RTDB transaction refreshes', 'The server value is rechecked after an initial null; a replacement session rejects the delay without mutating its value.'],
  ].map(([name, semantics]) => ({ path: 'backend/src/routes/rideSessions.test.ts',
    name: `versioned session identity and lifecycle > ${name}`, level: 'L1', semantics })),
}, {
  caseId: 'SEC04',
  scope: 'App Check removal retains browser identity/admin checks and device OTA reservations; Firebase verification, credential storage and physical OTA acceptance remain separate.',
  sourcePaths: ['backend/src/middleware/browserAppCheck.ts', 'backend/src/middleware/requireAdmin.ts', 'backend/src/lib/browserAdmission.ts', 'backend/src/routes/devices.ts'],
  tests: [{ path: 'backend/src/middleware/requireAdmin.test.ts',
    name: 'current admin HTTP authorization > denies a provider-valid token whose current authorization has been revoked',
    level: 'L1', semantics: 'An identity-verifier fixture accepting a token does not bypass a failed backend-owned current authorization check.' },
  { path: 'backend/src/middleware/requireAdmin.test.ts',
    name: 'current admin HTTP authorization > admits a current admin only after checking its published authorization',
    level: 'L1', semantics: 'Current admin role/flag/version proceeds only after the authorization service confirms publication.' },
  { path: 'backend/src/middleware/requireAdmin.test.ts',
    name: 'current admin HTTP authorization > fails closed with a retryable response when current authorization cannot be read',
    level: 'L1', semantics: 'A simulated metadata-store failure returns 503 with Retry-After and never executes the admin handler.' },
  { path: 'backend/src/lib/browserAdmission.test.ts',
    name: 'production browser admission > admits browser requests without attestation while retaining identity and admin authorization',
    level: 'L1', semantics: 'Mounted admission and role middleware admit verified admin GET/HEAD and mutation requests without attestation, but reject forged/missing identity and non-admin access.' },
  { path: 'backend/src/routes/devicesFirmware.test.ts',
    name: 'device OTA through browser admission and the production router > acquires and releases without browser identity or attestation',
    level: 'L1', semantics: 'The real admission and device router chain reaches the reservation transaction with only a mocked valid Device credential and no browser token.' },
  { path: 'backend/src/routes/devicesFirmware.test.ts',
    name: 'device OTA through browser admission and the production router > releases a reservation acquired through another server instance',
    level: 'L1', semantics: 'Two mounted server instances share mocked reservation persistence; the second instance releases the reservation created by the first with the same device credential.' },
  { path: 'backend/src/routes/devicesFirmware.test.ts',
    name: 'device OTA through browser admission and the production router > keeps missing, malformed, invalid, rotated, disabled and unassigned credentials denied',
    level: 'L1', semantics: 'The mounted router retains 401/403 decisions across credential fixtures without browser attestation; real credential hashing and invalidation are separate service tests.' },
  { path: 'backend/src/routes/devicesFirmware.test.ts',
    name: 'device OTA through browser admission and the production router > preserves ride, conflicting lock, owner and retry safeguards',
    level: 'L1', semantics: 'Mocked transaction state retains 409 for active rides and conflicts, rejects concurrent duplicate acquisition, binds credentials to device IDs, and preserves foreign firmware and same-device ride locks.' },
  { path: 'backend/src/routes/devicesFirmware.test.ts',
    name: 'device OTA through browser admission and the production router > keeps an existing reservation intact when release credentials are denied',
    level: 'L1', semantics: 'Missing, malformed, invalid, rotated, disabled and unassigned mocked release credentials cannot delete an existing reservation; the current assigned credential can release it.' },
  { path: 'backend/src/routes/devicesFirmware.test.ts',
    name: 'device OTA through browser admission and the production router > applies one exact device path policy to all ingress endpoints',
    level: 'L1', semantics: 'Telemetry, diagnostics, firmware lookup and installation use the shared exact path policy; extra segments and wrong methods with a Device header fail browser admission before device credential verification.' },
  { path: 'backend/src/routes/devicesFirmware.test.ts',
    name: 'device OTA through browser admission and the production router > admits browser identity without attestation while retaining device credentials',
    level: 'L1', semantics: 'A trailing-slash installation POST with mocked verified browser identity passes admission without attestation, then the real device router rejects its bearer credential with 401 and leaves reservations untouched.' }],
}, {
  caseId: 'H17',
  scope: 'Mounted Express methods/paths agree with the published OpenAPI contract; L0 only.',
  sourcePaths: ['scripts/verify-openapi.mjs'],
  tests: [{ path: 'scripts/verify-openapi.test.mjs',
    name: 'validates the published contract against mounted Express routers', level: 'L0',
    semantics: 'Checks the published contract with the real static Express router extractor and rejects missing/stale registrations.' }],
}, {
  caseId: 'BOARD07',
  scope: 'Valid trusted fix sub-oracle: reject malformed bus coordinates before first-join proximity/manifest writes and preserve numeric zero. Does not close freshness boundaries, receipt/sample mismatch or full-stack acceptance.',
  sourcePaths: ['backend/src/services/boardingPolicy.ts'],
  tests: [{
    path: 'backend/src/services/boardingPolicy.test.ts',
    name: 'boarding policy > live bus coordinates > %s > rejects malformed coordinate %p',
    level: 'L1',
    semantics: 'Calls the actual projection validator for both axes with non-numeric and non-finite inputs; each must return null.',
  }, {
    path: 'backend/src/services/boardingPolicy.test.ts',
    name: 'boarding policy > live bus coordinates > accepts valid numeric coordinates %p',
    level: 'L1',
    semantics: 'Verifies zero on either axis and geographic limits remain valid numeric coordinates.',
  }, {
    path: 'backend/src/routes/sessions.test.ts',
    name: 'session passenger join route v2=%s > live bus %s > rejects malformed coordinate %p before recording membership',
    level: 'L1',
    semantics: 'Real Express handlers and contract-checked HTTP responses with mocked auth/storage: both APIs reject malformed bus coordinates with 409 and no manifest update even when the passenger matches the formerly coerced location. Not emulator-backed.',
  }, {
    path: 'backend/src/routes/sessions.test.ts',
    name: 'session passenger join route v2=%s > allows first boarding at valid numeric zero coordinates',
    level: 'L1',
    semantics: 'Both HTTP handlers acknowledge boarding and record membership for numeric zero bus/passenger coordinates using mocked storage.',
  }],
}], gnssTestMap, emulatorTestMap, browserTestMap, mutationTestMap, apiTestMap, nativeTestMap, reviewedUnitTestMap, routingTestMap);
