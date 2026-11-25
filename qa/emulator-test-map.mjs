const path = 'backend/src/qaTelemetryChain.integration.test.ts';
const suite = 'authenticated telemetry to durable lifecycle and public emulator projection';
const telemetryMappings = [
  ['GNSS01', 'publishes valid device presence without fabricating passenger service', 'Actual Device authentication, parser, scrypt registry, RTDB transaction and public projection; software only.'],
  ['GNSS03', 'rejects invalid credentials authority fields and original oversized bytes without a live write', 'Forged bus field and invalid credential rejected with absent RTDB/session mutation.'],
  ['GNSS10', 'rejects invalid credentials authority fields and original oversized bytes without a live write', '513 original HTTP bytes rejected before JSON normalization; other partitions remain separate.'],
  ['GNSS11', 'preserves durable ride identity through HTTP duplicate and delayed older fixes', 'Exact retry acknowledges duplicate; persistent/session/public state retains newest fix.'],
  ['GNSS12', 'preserves durable ride identity through HTTP duplicate and delayed older fixes', 'Delayed higher-sequence older capture cannot overwrite newer accepted state.'],
  ['GNSS32', 'publishes valid device presence without fabricating passenger service', 'Observed no-store ingress/responded headers, distinct from browser rendering.'],
].map(([caseId, title, scope]) => ({ caseId, scope,
  sourcePaths: ['backend/src/routes/devices.ts', 'backend/src/services/deviceTelemetryService.ts', 'backend/src/services/liveBusProjection.ts'],
  tests: [{ path, name: `${suite} > ${title}`, level: 'L2', semantics: scope }] }));

export const emulatorTestMap = [...telemetryMappings, {
  caseId: 'TRIP14',
  scope: 'Actual loopback Firestore/RTDB reconciliation expires an unused automatic return after one day of inactivity while preserving overnight readiness and a newer bus lock. Physical GNSS and live cloud behavior remain separate.',
  sourcePaths: ['backend/src/services/abandonedRideReconciler.ts', 'backend/src/services/abandonedRideReconciliationLogic.ts'],
  tests: [{ path: 'backend/src/reconciliation.integration.test.ts',
    name: 'bounded reconciliation against actual Firebase emulators > expires an unused automatic return after a day while protecting overnight readiness and a replacement lock', level: 'L2',
    semantics: 'Seeds armed automatic returns at 18 and 48 hours of inactivity in actual emulators; the production sweep protects the overnight session, interrupts expired returns, removes the matching live node/lock, and preserves a replacement session lock.' }],
}, {
  caseId: 'SEC02',
  scope: 'Actual Firestore and RTDB rules reject stale/missing authorization versions, reassigned/unassigned/deleted drivers and demoted admins while preserving current operator/admin and passenger membership/public reads. Tokens are synthetic; live Auth/provider propagation is separate.',
  sourcePaths: ['firestore.rules', 'database.rules.json'],
  tests: [
    'rejects stale driver tokens after reassignment, unassignment, deletion and repeated assignment',
    'requires current admin authorization in both databases and never revives an old version',
  ].map(title => ({ path: 'backend/src/rulesIntegration.test.ts', name: `Firebase security rules integration > ${title}`, level: 'L2',
    semantics: 'Synthetic old/current tokens exercise actual committed rules against isolated loopback Firestore/RTDB, including forbidden metadata reads and writes.' })),
}, {
  caseId: 'AUTH13',
  scope: 'Production fleet routes publish real emulator authorization records; a saved token loses access after reassignment/deletion/unassignment and cannot regain it when the same identity and assignment are restored. Auth SDK is mocked; live revocation and browser convergence are separate.',
  sourcePaths: ['backend/src/services/userAuthorization.ts', 'backend/src/routes/fleet.ts', 'backend/src/syncRoleClaims.ts'],
  tests: [{ path: 'backend/src/reconciliation.integration.test.ts',
    name: 'bounded reconciliation against actual Firebase emulators > denies a saved token through actual rules after production fleet reassignment and deletion', level: 'L2',
    semantics: 'Real fleet HTTP routes and Admin Firestore/RTDB SDK writes followed by saved-token rules reads; also verifies that null fields do not trigger recurring unassigned-driver revocation.' },
    { path: 'backend/src/reconciliation.integration.test.ts',
      name: 'bounded reconciliation against actual Firebase emulators > serializes CLI publication and fleet demotion with the real durable mutex', level: 'L2',
      semantics: 'Real Firestore mutex contention prevents concurrent fleet demotion/CLI publication; later CLI reads passenger state and publishes matching records in both emulators. Auth is synthetic.' }],
}];
emulatorTestMap.push({
  caseId: 'AUTH14',
  scope: 'Local Firestore sub-oracle: a preserved ride manifest loses passenger chat-read authority when the backend-owned profile is removed; admin and assigned-driver reads remain allowed. Actual OAuth revocation, disabled-account and deployed App Check behavior remain separate.',
  sourcePaths: ['firestore.rules'],
  tests: [{
    path: 'backend/src/rulesIntegration.test.ts',
    name: 'Firebase security rules integration > retained ride membership cannot authorize chat reads after the profile is deleted',
    level: 'L2',
    semantics: 'The same signed emulator principal reads a retained message with its profile present, then is denied after profile deletion while the manifest/message are retained; trusted operator/admin neighbors still succeed.',
  }],
});

// Public projection leaf writes (EKI-EVD-068): the stale-leader fence enforced by the committed rules, and measured bytes per fix.
const projectionSuite = 'R14 actual SDK publisher fences, recovery and listener isolation';
const projectionSources = ['backend/src/lib/workerFence.ts', 'backend/src/services/liveBusProjection.ts', 'backend/src/services/liveBusProjectionWriter.ts', 'database.rules.json'];
emulatorTestMap.push({
  caseId: 'TRIP26',
  scope: 'Loopback RTDB emulator with the committed rules: a public projection leaf update is accepted only from the generation that claimed the route, at the next revision, with a bus identity matching its keys; a still-running former leader is refused at the destination once its successor claims. Deployed rules and multi-replica acceptance remain separate.',
  sourcePaths: projectionSources,
  tests: [
    { path: 'backend/src/liveBusProjection.fences.integration.test.ts', name: `${projectionSuite} > accepts a fenced leaf update only from the claimed generation at the next revision, under the committed rules`, level: 'L2',
      semantics: 'A resent update, a skipped or omitted revision, a lower or unclaimed generation, a bus whose identity does not match its keys and the former leader after a successor claim are all refused by the committed rules; the writer identity has no other write.' },
    { path: 'backend/src/liveBusProjection.fences.integration.test.ts', name: `${projectionSuite} > stops a still-running former leader at the destination once its successor has claimed the route`, level: 'L2',
      semantics: 'With both generations publishing, the former leader makes one refused attempt and then stops, and the route holds only the successor state.' },
    { path: 'backend/src/rulesIntegration.test.ts', name: 'Firebase security rules integration > grants the projection writer identity only a route write fenced by the stored generation and the next revision', level: 'L2',
      semantics: 'Passenger, administrator and unauthenticated clients cannot write the projection; the writer uid gets only the fenced route write, once per revision, with matching bus identities.' },
  ],
}, {
  caseId: 'OBS07',
  scope: 'Loopback RTDB emulator measurement of protocol bytes per fix to a passenger route listener, the admin fleet listener and the publisher connections, for whole-route transactions against leaf writes with 1, 5 and 10 buses on a route. TLS and production billing remain separate.',
  sourcePaths: ['backend/src/services/liveBusProjection.ts', 'backend/src/services/liveBusProjectionWriter.ts'],
  tests: [{ path: 'backend/src/liveBusProjection.fences.integration.test.ts', name: `${projectionSuite} > delivers a route listener only the changed leaves of a fix, whatever the number of buses on the route`, level: 'L2',
    semantics: 'Leaf listener bytes per fix stay within 2 % across 1, 5 and 10 buses while transaction bytes grow with the bus count; the measurement is printed as R14_LISTENER_WIRE_MEASUREMENT.' }],
});
