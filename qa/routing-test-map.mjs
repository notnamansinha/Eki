// Limited regression evidence; simulated adapters do not establish road/GNSS accuracy.
export const routingTestMap = [{
  caseId: 'TRIP01',
  scope: 'Endpoint classification uses a fresh stopped quality fix, not displacement. Pure classifier evidence only.',
  sourcePaths: ['backend/src/lib/automaticRideDirection.ts'],
  tests: [{ path: 'backend/src/lib/automaticRideDirection.test.ts', name: 'automatic ride direction > resolves only a fresh, stopped, high-quality fix inside one endpoint geofence', level: 'L1', semantics: 'Classifier rejects moving, stale, poor-quality and outside-endpoint fixes and selects both unique endpoints.' }],
}, {
  caseId: 'TRIP14',
  scope: 'Real ingestion/engine/recovery with serialized in-memory Firebase adapters preserves terminal intent, unique return identity and undeparted overnight readiness. Provider and persistence transport are mocked.',
  sourcePaths: ['backend/src/services/tripStateEngine.ts', 'backend/src/services/durableRideRecovery.ts', 'backend/src/services/durableRideRecoveryPolicy.ts', 'backend/src/services/abandonedRideReconciliationLogic.ts'],
  tests: [{ path: 'backend/src/services/routingLifecycle.integration.test.ts', name: 'routing lifecycle through actual ingestion and listeners > preserves an already armed return through the real abandoned-session sweep overnight', level: 'L1', semantics: 'Actual reconciliation protects the return, then node removal/restart reuses the same armed reverse session.' },
  { path: 'backend/src/services/abandonedRideReconciliationLogic.test.ts', name: 'abandoned ride reconciliation logic > preserves an undeparted automatic return across an overnight power-off', level: 'L1', semantics: 'Pure policy distinguishes undeparted automatic readiness from an abandoned manual/departed ride.' }],
}, {
  caseId: 'MAP15',
  scope: 'Directional traffic refresh publishes versioned geometry once; ordered road legs use existing geometry. SDK/provider acceptance is a separate opt-in replay.',
  sourcePaths: ['backend/src/services/telemetryRouteService.ts', 'frontend/src/components/maps/DirectionsRoute.tsx', 'frontend/src/components/maps/PassengerMap.tsx', 'frontend/src/components/admin/DashboardPanel.tsx', 'frontend/src/lib/routeLegPaths.ts', 'frontend/src/lib/activeRouteGeometry.ts'],
  tests: [{ path: 'backend/src/services/routingLifecycle.integration.test.ts', name: 'routing lifecycle through actual ingestion and listeners > refreshes on-route geometry once, without a per-fix provider call', level: 'L1', semantics: 'Real route processing through mocked provider/storage publishes current route context and does not call the provider for every fix.' },
  { path: 'frontend/src/components/maps/DirectionsRoute.test.tsx', name: 'keeps the whole road grey and advances only the blue leg without provider calls', level: 'L1', semantics: 'Real component with observed SDK constructor fixture renders the full grey road, only selected active legs blue, advances/retires overlays, and makes no geometry API request.' },
  { path: 'frontend/src/components/admin/DashboardPanel.test.tsx', name: 'admin service creation > centers the bus glyph on its coordinate while its label stays outside the anchor box', level: 'L1', semantics: 'Mounted production admin marker supplies center anchors with an unchanged coordinate and keeps the label outside the square glyph box; actual pixel registration is separately measured by the real SDK replay.' },
  { path: 'frontend/src/lib/activeRouteGeometry.test.ts', name: 'activeRouteGeometry > fetches and decodes reroute geometry once per version', level: 'L1', semantics: 'Version cache retains the immutable first required stop used to cut a dynamic path that starts at the bus.' }],
}, {
  caseId: 'MAP02',
  scope: 'Pure marker selection bridges transient low confidence without claiming new lane precision.',
  sourcePaths: ['frontend/src/lib/liveBusMarkerPosition.ts'],
  tests: [{ path: 'frontend/src/lib/liveBusMarkerPosition.test.ts', name: 'live bus marker selection > bridges one completed low-confidence sample without jumping to the parallel road', level: 'L1', semantics: 'Selection holds the last reliable point for a bounded interval before exposing raw approximate position.' }],
}, {
  caseId: 'HIST01',
  scope: 'Session history retains raw last fix on signal loss and exposes retained messages when expanded. GNSS power-off instant and unrestricted retention are not asserted.',
  sourcePaths: ['backend/src/services/journeyLocation.ts', 'backend/src/routes/shifts.ts', 'backend/src/routes/sessions.ts', 'frontend/src/components/admin/RideHistoryPanel.tsx', 'firestore.rules'],
  tests: [{ path: 'backend/src/services/routingLifecycle.integration.test.ts', name: 'routing lifecycle through actual ingestion and listeners > archives the last raw accepted fix on each signal loss without per-fix history writes', level: 'L1', semantics: 'Two distinct signal losses save separate locations/events on the original session and fleet while ordinary fixes do not create disconnect history.' },
  { path: 'frontend/src/components/admin/RideHistoryPanel.test.tsx', name: 'ride-history controls > expands and collapses stored history without an API write', level: 'L1', semantics: 'Mounted history renders armed time, passenger section and a stored chat message, and collapses without an API mutation.' },
  { path: 'backend/src/routes/rideSessions.test.ts', name: 'versioned session identity and lifecycle > captures the final raw fix before a manual early end without losing the manifest or chat', level: 'L1', semantics: 'Mounted stop handler stores the captured session raw location, interrupts the ride, preserves its manifest/message and releases its lock using mocked storage.' },
  { path: 'backend/src/routes/sessionsMessages.test.ts', name: 'session message route v2=%s > retains retry identity and rejects changed content after live chat is archived', level: 'L1', semantics: 'Both mounted message aliases replay an archived original, reject changed text and avoid another live/rate write with mocked persistence.' },
  { path: 'backend/src/rulesIntegration.test.ts', name: 'Firebase security rules integration > restricts cleared ride chat archives to current operators and denies client mutation', level: 'L2', semantics: 'Actual emulator Firestore rules admit a current admin archive read/query and reject passenger, unauthenticated and client write/delete attempts.' }],
}];
