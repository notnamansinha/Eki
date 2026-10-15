import { gnssTestMap } from './gnss-test-map.mjs';
import { emulatorTestMap } from './emulator-test-map.mjs';
import { browserTestMap } from './browser-test-map.mjs';
import { mutationTestMap } from './mutation-test-map.mjs';
import { apiTestMap } from './api-test-map.mjs';
import { nativeTestMap } from './native-test-map.mjs';
import { reviewedUnitTestMap } from './reviewed-unit-test-map.mjs';
import { mergeTestMaps } from '../scripts/qa/merge-test-maps.mjs';
// Exact limited assertion links; no complete feature acceptance is claimed.
export const testMap = mergeTestMaps([{
  caseId: 'SEC04',
  scope: 'Mounted Express fixture checks App Check routing, identity and role boundaries for protected reads and exact device exemptions. Firebase verification and physical OTA acceptance are mocked or outside this test.',
  sourcePaths: ['backend/src/middleware/browserAppCheck.ts'],
  tests: [{ path: 'backend/src/middleware/browserAppCheck.routing.test.ts',
    name: 'App Check through mounted browser and device routers > blocks missing and invalid attestation before GET or HEAD work for accepted route spellings',
    level: 'L1', semantics: 'Mounted browser admission and App Check reject lowercase and mixed-case GET/HEAD requests for Places, planning, legacy routes and v2 geometry before fixture handler work.' },
  { path: 'backend/src/middleware/browserAppCheck.routing.test.ts',
    name: 'App Check through mounted browser and device routers > guards the production v2 segment router before route reads for GET and HEAD',
    level: 'L1', semantics: 'The production segment router is mounted behind admission and App Check. Missing/invalid attestation blocks GET/HEAD before mocked database reads, including encoded IDs and mixed-case paths; valid attestation and off mode reach route reads with identifier case preserved.' },
  { path: 'backend/src/middleware/browserAppCheck.routing.test.ts',
    name: 'App Check through mounted browser and device routers > permits verified requests while preserving identity and admin checks',
    level: 'L1', semantics: 'Mocked valid App Check and identity allow the intended handlers while a passenger or invalid identity remains denied; route identifier case is preserved.' },
  { path: 'backend/src/middleware/browserAppCheck.routing.test.ts',
    name: 'App Check through mounted browser and device routers > retains off mode and exact device credential exemptions',
    level: 'L1', semantics: 'Off mode retains authenticated reads; exact firmware installation POST uses device credential authentication, while wrong credentials and extra path segments fail.' }],
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
}], gnssTestMap, emulatorTestMap, browserTestMap, mutationTestMap, apiTestMap, nativeTestMap, reviewedUnitTestMap);
