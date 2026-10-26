// Actual React/jsdom components/hooks; SDK, HTTP, GPS and selected children are mocked.
// These L1 observations do not establish browser/provider/emulator acceptance.
const auth = title => ({ path: 'frontend/src/hooks/useAuth.test.tsx', name: `verified auth publication > ${title}`, level: 'L1' });
const boarding = title => ({ path: 'frontend/src/components/passenger/PassengerBoardingView.test.tsx', name: `passenger boarding workflow > ${title}`, level: 'L1' });
const budget = title => ({ path: 'frontend/src/components/passenger/PassengerBoardingView.budgets.test.tsx', name: `boarding preparation and API budgets > ${title}`, level: 'L1' });
const restore = title => ({ path: 'frontend/src/components/passenger/PassengerWorkspace.restore.test.tsx', name: `verified reload boarding recovery > ${title}`, level: 'L1' });
const feedback = title => ({ path: 'frontend/src/components/shared/FeedbackModal.test.tsx', name: `passenger feedback workflow > ${title}`, level: 'L1' });
const authSources = ['frontend/src/hooks/useAuth.ts', 'frontend/src/lib/authState.ts', 'frontend/src/lib/firebaseAppCheck.ts'];
const boardingSources = ['frontend/src/components/passenger/PassengerBoardingView.tsx'];
const feedbackSources = ['frontend/src/components/shared/FeedbackModal.tsx', 'frontend/src/lib/feedbackStore.ts'];
const rows = [
  ['AUTH07', 'Mounted auth provider keeps readiness closed after the eight-second restoration guard and before mocked role verification resolves; actual ten-second role-fetch/browser recovery remains separate.', authSources, [
    auth('does not mark an auth restoration timeout ready'), auth('does not publish cached/admin identity or open readiness before trusted role verification')]],
  ['AUTH08', 'Mounted auth provider rejects an admin role string without the trusted admin bit and exposes mocked role verification failure/recovery; real Firestore permission/malformed/profile partitions remain separate.', authSources, [
    auth('does not publish admin access from a role string without the trusted admin bit'), auth('keeps role verification failures visible and data readiness closed')]],
  ['AUTH11', 'Mounted auth provider suppresses pending verification/sign-out completions and shows sign-out failure recovery; private listener/chat/map cleanup and focus remain separate.', authSources, [
    auth('keeps pending verification from republishing access during sign-out'), auth('discards a token completion after sign-out'), auth('shows recovery when Firebase sign-out fails instead of leaving a silent closed gate')]],
  ['AUTH12', 'Mounted auth provider discards old-account completion; workspace refuses another UID local hint and aborts delayed previous-account recovery. Map/boarding children and status transport are mocked; all private listener/cache isolation remains separate.', [...authSources, 'frontend/src/components/passenger/PassengerWorkspace.tsx', 'frontend/src/lib/joinedRidePointer.ts'], [
    auth('discards old-account completion during a switch'), restore("does not query another account's local ride hint"), restore('ignores a delayed previous-account response')]],
  ['AUTH13', 'Manual access refresh publishes current mocked passenger claims after admin revocation and forces token refresh; actual deployed revocation and operator assignment propagation remain separate.', authSources, [auth('observes a revoked admin role during manual access refresh')]],
  ['AUTH18', 'Mounted auth provider coalesces manual/online/visible recovery, retries only transient failures with a bounded burst and keeps trusted access closed through timeout/offline recovery. SDK transport is mocked; deployed revocation and provider recovery remain separate.', authSources, [
    auth('coalesces simultaneous access retries, closes the old data gate and forces new security verification'), auth('refreshes a persisted passenger token to the current trusted admin claims before publishing access'),
    auth('recovers transient access with bounded backoff and current trusted claims without relogin'),
    auth('pauses a transient retry offline and coalesces online, visible and manual recovery'),
    auth('bounds a failed retry burst then resumes after ten minutes offline'),
    auth('stops automatic recovery if the next trusted request reveals revoked access'),
    auth('pauses retries while hidden and recovers only on visible resume'),
    auth('discards a timed-out verification after a successful retry'),
    auth('cancels queued automatic recovery on sign-out, account change and unmount')]],
  ['BOARD01', 'Actual boarding component sends selected stops and mocked GPS once without a code, announcing only a joined acknowledgement. Server UID manifest/proximity/transaction acceptance remains separate.', boardingSources, [boarding('submits chosen stops and GPS once and only announces a confirmed join'), boarding('allows stop selection and boarding without displaying or submitting a code')]],
  ['BOARD02', 'Actual boarding component resets destination when boarding stop changes, synchronizes changed destination props without losing its draft, and disables incomplete stop selection. Passenger boarding has no code-length requirement.', boardingSources, [boarding('keeps boarding and destination stops distinct'), budget('synchronizes changed destination props while preserving the boarding draft and local edits')]],
  ['BOARD04', 'Actual boarding component displays permission denial without an API/join and bounds a never-settling GPS callback at ten seconds with late completion ignored. GPS/browser permissions are mocked; server manifest and retry partitions remain separate.', boardingSources, [
    boarding('does not call the API or confirm boarding when location permission is denied'), budget('bounds a GPS callback that never settles, with no HTTP request')]],
  ['BOARD09', 'Actual selector excludes the same stop and invalidates destination after a boarding stop change. Unknown/duplicate/reverse choices and authoritative server ordering remain separate.', boardingSources, [boarding('keeps boarding and destination stops distinct')]],
  ['BOARD13', 'Mounted boarding component corrects an acknowledged member destination without reacquiring GPS and reacquires GPS for another session; mocked HTTP does not prove retained joinedAt or atomic membership recheck.', boardingSources, [budget("allows an existing passenger's stop correction without GPS and requires GPS in a different session")]],
  ['BOARD18', 'Mounted boarding component ignores a previous session acknowledgement and coalesces immediate clicks before GPS/token acquisition; malformed/lost-commit reconciliation and durable membership remain separate.', boardingSources, [
    budget('ignores an old HTTP acknowledgement after the session changes'), budget('coalesces two clicks in the same render before acquiring location')]],
  ['BOARD19', 'Mounted boarding component fences GPS/token completion after unmount or session change, aborts in-flight HTTP, and ignores obsolete preparation failures. SDK/GPS/HTTP are mocked; real browser lifecycle and server effects remain separate.', boardingSources, [
    boarding('aborts an in-flight join when the boarding view unmounts'), budget('does not start a request when GPS completes after unmount'), budget('discards token completion after unmount'), budget("fences a former session's preparation and lets the new session board"), budget('ignores late preparation failures after a session change')]],
  ['PAX25', 'Mounted workspace waits for mocked membership verification before restoring stops, clears a denied forged hint and refuses an ended ride; map/boarding children are mocked and real reload/mobile back/HTTP authority remain separate.', ['frontend/src/components/passenger/PassengerWorkspace.tsx', 'frontend/src/lib/joinedRidePointer.ts', ...boardingSources], [
    restore('restores tracking and stops only after membership verification'), restore('clears a forged pointer after membership denial'), restore('does not restore an ended ride as on board'), boarding('shows verified restored choices without replaying boarding or caching a code')]],
  ['FEED05', 'Mounted feedback modal displays mocked server cooldown without claiming storage; exact 24-hour transactional concurrency/account isolation remain separate.', feedbackSources, [feedback('honors the server cooldown without claiming the feedback was stored')]],
  ['FEED06', 'Mounted feedback modal preserves request ID across an ambiguous mocked network failure and retry. Durable replay and changed-payload conflict remain separate.', feedbackSources, [feedback('reuses the request ID after an ambiguous failure and retries the same feedback')]],
  ['FEED07', 'Mounted feedback modal submits without a backend URL or tunnel and refuses Firestore connection failures without a success or local cooldown; durable atomic rules outcomes are covered by the emulator suite.', feedbackSources, [
    feedback('shows a connection error without success or a local cooldown'), feedback('submits to Firestore with the tunnel offline and no backend URL')]],
  ['FEED09', 'Mounted general-feedback modal disables empty submission and handles Escape/close without sending; rating/backdrop/focus and retained draft partitions remain separate.', feedbackSources, [feedback('supports close and Escape without submitting an empty form')]],
];
export const componentTestMap = rows.map(([caseId, scope, sourcePaths, tests]) => ({ caseId, scope, sourcePaths,
  tests: tests.map(link => ({ ...link, semantics: scope })) }));
