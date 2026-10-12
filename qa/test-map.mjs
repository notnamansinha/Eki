// Reviewed static contract mapping only. No whole API01 or application case is closed.
export const testMap = [{
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
}];
