const path = 'e2e/production-audit/audit.spec.ts';
export const productionAuditTestMap = [
  {
    caseId: 'PAX01',
    scope: 'Synthetic-browser sub-oracle: long route/endpoint text is not clipped and its route card enters tracking at three viewport sizes. Genuine provider and full journey acceptance remain separate.',
    sourcePaths: ['frontend/src/components/passenger/ui/RouteCarousel.tsx'],
    tests: [{ path, name: 'long route and endpoint labels remain fully rendered and selectable', level: 'L3',
      semantics: 'Actual carousel text boxes fit their content without horizontal page overflow; a real pointer click opens the selected route workspace.' }],
  }, {
    caseId: 'PAX14',
    scope: 'Synthetic-browser sub-oracle: loss of the selected live snapshot preserves an unclipped route label in the waiting state. Does not certify complete recovery or feedback behavior.',
    sourcePaths: ['frontend/src/components/passenger/PassengerWorkspace.tsx', 'frontend/src/components/admin/DashboardPanel.tsx'],
    tests: [{ path, name: 'tracking keeps the full route name while waiting for live data', level: 'L3',
      semantics: 'Select an actual rendered route, remove its synthetic live snapshot, then verify the fallback route label remains visible and fully rendered.' },
    { path, name: 'admin and passenger label 90 to 200 second telemetry gaps and recover without reload', level: 'L3',
      semantics: 'Real admin and passenger components use the same shared receipt-age threshold with 90.001, 120 and 200 second synthetic gaps, then remove the warning on a fresh delivery without navigation refresh.' }],
  }, {
    caseId: 'ROUTE08',
    scope: 'Local stop-rename sub-oracle: empty and whitespace Enter/blur retain the prior valid stop name with immediate inline feedback. Valid retry and Escape remain tested; persistence/provider acceptance is separate.',
    sourcePaths: ['frontend/src/components/admin/RouteManagementPanel.tsx'],
    tests: [{ path: 'frontend/src/components/admin/RouteManagementPanel.test.tsx',
      name: 'route editing and operation recovery > keeps the previous stop name and explains a blank rename: %j', level: 'L1',
      semantics: 'Four actual form interactions cover empty/whitespace and Enter/blur; subsequent save payload retains Alpha instead of an invalid blank.' },
    { path: 'frontend/src/components/admin/RouteManagementPanel.test.tsx',
      name: 'route editing and operation recovery > cancels a stop rename with Escape, then allows a fresh rename to commit once', level: 'L1',
      semantics: 'Escape fences the removed input blur; the following valid rename commits once with the original route object untouched.' }],
  }, {
    caseId: 'HIST01',
    scope: 'History provenance sub-oracle: show persisted manual-end/inactivity reasons and explicit unknown/missing fallbacks without inferring GNSS/network/phone failure. Existing backend writes and broader status/time acceptance are separate.',
    sourcePaths: ['frontend/src/components/admin/RideHistoryPanel.tsx'],
    tests: [{ path, name: 'history shows actual interruption reasons and honest legacy fallbacks', level: 'L3',
      semantics: 'The actual history component renders four synthetic persisted reason states with no invented GPS-timeout or phone-failure claim.' }],
  },
];
