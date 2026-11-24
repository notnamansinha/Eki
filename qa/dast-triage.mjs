/**
 * Reviewed dispositions for ZAP alerts raised by `npm run qa:dast` and
 * `npm run qa:dast:staging` (qa/DAST.md, Section 6).
 *
 * alertRef    ZAP alert reference (plugin ID, with a suffix for variants)
 * profiles    'local', 'staging' or both
 * disposition 'fixed' (a reappearance fails the run), 'false-positive',
 *             'accepted-risk' or 'not-applicable'
 * rationale   Why, in terms a reviewer can check against the code
 *
 * Every alert of Low risk or above needs an entry for the profile that raised
 * it, or the run fails with UNTRIAGED_ALERTS. Informational alerts are listed
 * in the report and need no entry.
 */
export const dastTriage = [
  {
    alertRef: '40018',
    profiles: ['local'],
    disposition: 'false-positive',
    rationale: 'The backend has no SQL database or driver (backend/package.json); it stores data in Firestore and RTDB. '
      + 'The boolean-based alerts of 2026-11-23 on POST /api/plan and PUT /api/fleet/buses/{id} and /api/fleet/drivers/{id} '
      + 'compared responses that varied with scanner state, not payload: the admin scan\'s own fleet reconciliation requests '
      + 'held the fleet lock, and 156 fleet mutations answered 409 (FleetReconciliationBusy) in one run. Replayed one at a time '
      + 'from a reset fixture, and back to back, every true, false and original variant returned the same response '
      + '(docs/testing/DAST_LOCAL_2026_11_23.md).',
  },
  {
    alertRef: '40045',
    profiles: ['local'],
    disposition: 'false-positive',
    rationale: 'Spring4Shell needs a Java Spring application; the backend is Node.js and Express. The alert fired because '
      + 'GET /api/v2/routes/{routeId}/segments answers 400 to any query key other than from, to and via '
      + '(backend/src/routes/plan.ts). A replay with the key zz=1 returned the same 400 as the class.module.classLoader key.',
  },
];
