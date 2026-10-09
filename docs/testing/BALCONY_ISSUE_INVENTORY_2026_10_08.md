# GitHub issue inventory — 8 October 2026

Read-only inventory for the balcony readiness audit. All 115 issues are included below; GitHub state is recorded as returned. This table does not declare every issue field-accepted. Consult [the measured readiness report](BALCONY_READINESS_2026_10_08.md) for evidence and limits. Full issue bodies and 209 returned comments are retained privately in the ignored evidence folder.

| Issue | GitHub state | Title |
|---|---|---|
| [#24](https://github.com/notnamansinha/Eki/issues/24) | CLOSED | test-access |
| [#25](https://github.com/notnamansinha/Eki/issues/25) | CLOSED | [CRITICAL][Hardware] No store-and-forward: connectivity blips permanently lose telemetry |
| [#26](https://github.com/notnamansinha/Eki/issues/26) | CLOSED | [CRITICAL][Hardware] Blocking TLS in GNSS loop silently drops GNSS fixes |
| [#27](https://github.com/notnamansinha/Eki/issues/27) | CLOSED | [CRITICAL][Frontend] Remaining client writes: user bootstrap + admin settings bypass the server boundary |
| [#28](https://github.com/notnamansinha/Eki/issues/28) | CLOSED | [HIGH][Backend] Single backend instance = SPOF |
| [#29](https://github.com/notnamansinha/Eki/issues/29) | CLOSED | [HIGH][Hardware] No watchdog / brownout / crash recovery |
| [#30](https://github.com/notnamansinha/Eki/issues/30) | CLOSED | [HIGH][Hardware] Time sync depends entirely on NTP-over-WiFi; GNSS UTC is parsed but never used |
| [#31](https://github.com/notnamansinha/Eki/issues/31) | CLOSED | [HIGH][Hardware] No OTA: field updates require physical USB reflash of every bus |
| [#32](https://github.com/notnamansinha/Eki/issues/32) | CLOSED | [HIGH][Frontend] Role gating is client-side only; cached role can briefly lie after demotion |
| [#33](https://github.com/notnamansinha/Eki/issues/33) | CLOSED | [HIGH][Frontend] Two useActiveBuses hooks with divergent filter semantics |
| [#34](https://github.com/notnamansinha/Eki/issues/34) | CLOSED | [HIGH][Frontend] 7+ hand-rolled fetch call sites with zero timeouts/retries |
| [#35](https://github.com/notnamansinha/Eki/issues/35) | CLOSED | [HIGH][Frontend] Service worker update can hard-reload a driver mid-shift |
| [#36](https://github.com/notnamansinha/Eki/issues/36) | CLOSED | [MEDIUM][Backend] tripStateEngine.ts is a 551-line god module; serialized writer duplicated 3× |
| [#37](https://github.com/notnamansinha/Eki/issues/37) | CLOSED | [MEDIUM][Backend] Unbounded in-memory maps (processedTelemetry, persistedFleetState, completedTimeouts, routeStopsCache) |
| [#38](https://github.com/notnamansinha/Eki/issues/38) | CLOSED | [MEDIUM][Backend] Fire-and-forget writes swallow errors with no metrics/alerting |
| [#39](https://github.com/notnamansinha/Eki/issues/39) | CLOSED | [MEDIUM][Data/Sec] No App Check enforcement in rules; no staging project or deploy CI |
| [#40](https://github.com/notnamansinha/Eki/issues/40) | CLOSED | [MEDIUM][Data/Sec] Rules get() amplification = cost/DoS-adjacent |
| [#41](https://github.com/notnamansinha/Eki/issues/41) | CLOSED | [MEDIUM][Hardware] 401/429/5xx handled identically; 401 retries forever with doomed credential |
| [#42](https://github.com/notnamansinha/Eki/issues/42) | CLOSED | [MEDIUM][Hardware] Device secret compiled into plaintext firmware; no flash encryption / secure boot / rotation |
| [#43](https://github.com/notnamansinha/Eki/issues/43) | CLOSED | [MEDIUM][Hardware] WiFi failure loops forever; no escalation, config mode, or LED fault codes |
| [#44](https://github.com/notnamansinha/Eki/issues/44) | CLOSED | [MEDIUM][Hardware] All config compile-time; no provisioning or remote diagnostics channel |
| [#45](https://github.com/notnamansinha/Eki/issues/45) | CLOSED | [MEDIUM][Frontend] useSmoothPosition re-renders per rAF frame per bus (60/sec/marker) |
| [#46](https://github.com/notnamansinha/Eki/issues/46) | CLOSED | [MEDIUM][Frontend] useCollection cache key ignores where constraints |
| [#47](https://github.com/notnamansinha/Eki/issues/47) | CLOSED | [MEDIUM][Frontend] Errors swallowed into 'empty' — 'data failed' vs 'no data' render identically |
| [#48](https://github.com/notnamansinha/Eki/issues/48) | CLOSED | [LOW][Backend] Polish: scrypt concurrency, dead analytics check, timestamp trust, health probe |
| [#49](https://github.com/notnamansinha/Eki/issues/49) | CLOSED | [LOW][Data/Sec] Dead config, dual fields, ISO string, stale comments, missing catch-all deny |
| [#50](https://github.com/notnamansinha/Eki/issues/50) | CLOSED | [LOW][Frontend+Hardware] Polish: mojibake, dead prop, fallback coords, String fragmentation, 200 km/h clamp |
| [#51](https://github.com/notnamansinha/Eki/issues/51) | CLOSED | [DOC] Complete LIVE_DEMO_RUNBOOK before professor demonstration |
| [#52](https://github.com/notnamansinha/Eki/issues/52) | CLOSED | [DOC] Complete UNIVERSITY_DEPLOYMENT_CHECKLIST for production acceptance |
| [#56](https://github.com/notnamansinha/Eki/issues/56) | CLOSED | Hardware: provision ESP32 securely for local-backend testing |
| [#60](https://github.com/notnamansinha/Eki/issues/60) | CLOSED | Hardware Acceptance: Watchdog and Brownout Recovery Testing |
| [#62](https://github.com/notnamansinha/Eki/issues/62) | CLOSED | [HIGH][Data/Sec] Missing composite index devices(busId, routeId) breaks device provisioning in production |
| [#63](https://github.com/notnamansinha/Eki/issues/63) | CLOSED | [HIGH][Hardware] Recovery provisioning portal binds 0.0.0.0:80 and bypasses its WPA2 gate on the campus STA interface |
| [#64](https://github.com/notnamansinha/Eki/issues/64) | CLOSED | [HIGH][Backend] Shift restart within ~30s of automatic completion resurrects the completed session and freezes the new ride |
| [#65](https://github.com/notnamansinha/Eki/issues/65) | CLOSED | [MEDIUM][Backend] /api/shifts/delay writes RTDB and Firestore non-atomically; stale delay silently reverts on reconnect |
| [#66](https://github.com/notnamansinha/Eki/issues/66) | CLOSED | [MEDIUM][Backend] Engine can recreate a stale-swept RTDB node via plain update(); child_removed is not serialized with the per-node queue |
| [#67](https://github.com/notnamansinha/Eki/issues/67) | CLOSED | [MEDIUM][Frontend] Stale ETA persists after the last bus leaves the route (or on route switch), showing countdowns for a bus that no longer exists |
| [#68](https://github.com/notnamansinha/Eki/issues/68) | CLOSED | [MEDIUM][Frontend] Passenger tracked ride silently re-binds to a new ride session, permanently losing post-ride feedback eligibility |
| [#69](https://github.com/notnamansinha/Eki/issues/69) | CLOSED | [MEDIUM][Hardware] Cross-core data race on the shared TinyGPSPlus object (GNSS loop writes, publisher reads) |
| [#70](https://github.com/notnamansinha/Eki/issues/70) | CLOSED | [MEDIUM][Hardware] RTC telemetry queue samples have no integrity protection; torn samples could be accepted after a brownout mid-write |
| [#71](https://github.com/notnamansinha/Eki/issues/71) | CLOSED | [MEDIUM][Hardware] currentFix() gates location age but not HDOP/speed/course age — stale-HDOP fixes pass |
| [#72](https://github.com/notnamansinha/Eki/issues/72) | CLOSED | [MEDIUM][Data/Sec] passenger_requests client-write rule is a dead surface; API.md documents a flow the frontend never implements |
| [#73](https://github.com/notnamansinha/Eki/issues/73) | CLOSED | [MEDIUM][Data/Sec] Driver status-update rule permits arbitrary passenger-request transitions (no ordering enforcement) |
| [#74](https://github.com/notnamansinha/Eki/issues/74) | CLOSED | [MEDIUM][Backend] Per-IP rate limits break behind campus NAT — fleet ingress and a full lecture demo can share one IP budget |
| [#75](https://github.com/notnamansinha/Eki/issues/75) | CLOSED | [LOW][Backend] Unbounded passenger manifest can push ride_sessions past Firestore's 1 MiB document limit |
| [#76](https://github.com/notnamansinha/Eki/issues/76) | CLOSED | [LOW][Backend] Seed-time Google Maps call has no timeout/abort while runtime callers do |
| [#77](https://github.com/notnamansinha/Eki/issues/77) | CLOSED | [LOW][Frontend] liveBusStore has no recovery path after a permanent RTDB listener error — stale fleet persists with no user signal |
| [#78](https://github.com/notnamansinha/Eki/issues/78) | CLOSED | [LOW][Hardware] Diagnostics marked attempted before send; no retry on transport/5xx/429 |
| [#79](https://github.com/notnamansinha/Eki/issues/79) | CLOSED | [LOW][Hardware] 429/404/5xx retry delays (>=60s) exceed the 55s freshness margin — retried samples are always stale-dropped |
| [#80](https://github.com/notnamansinha/Eki/issues/80) | CLOSED | [LOW][Hardware] 32-bit time_t 2038 wrap halts telemetry publishing entirely |
| [#81](https://github.com/notnamansinha/Eki/issues/81) | CLOSED | [LOW][Hardware] Recovery AP password is permanent and cannot be rotated |
| [#82](https://github.com/notnamansinha/Eki/issues/82) | CLOSED | [LOW][Data/Sec] Frontend dev script uses Windows-only `set` syntax, breaking npm run dev on POSIX |
| [#90](https://github.com/notnamansinha/Eki/issues/90) | CLOSED | Repo Audit: Temp Check |
| [#115](https://github.com/notnamansinha/Eki/issues/115) | CLOSED | Hardware Compilation: Terminal Output |
| [#119](https://github.com/notnamansinha/Eki/issues/119) | CLOSED | Revert Temporary Local Testing Changes (HTTPS Bypass) |
| [#122](https://github.com/notnamansinha/Eki/issues/122) | CLOSED | AFTER TESTING OVER: move from the local ngrok test tunnel to permanent backend hosting |
| [#143](https://github.com/notnamansinha/Eki/issues/143) | CLOSED | Fix GPS Update Lag, Motion-State Write Suppression, and Route Direction Backtracking |
| [#144](https://github.com/notnamansinha/Eki/issues/144) | CLOSED | # Map Matching, Route Adherence, Dynamic Rerouting, and Direction Correctness |
| [#149](https://github.com/notnamansinha/Eki/issues/149) | CLOSED | Fix ride direction, directional route geometry, live GPS accuracy, and admin route management |
| [#158](https://github.com/notnamansinha/Eki/issues/158) | CLOSED | P[0] [Tracking][Main] Complete telemetry and routing audit; rebuild useful excluded-branch fixes |
| [#159](https://github.com/notnamansinha/Eki/issues/159) | CLOSED | [P0][Telemetry] Measure end-to-end latency, update gaps and device clock skew on main |
| [#160](https://github.com/notnamansinha/Eki/issues/160) | CLOSED | [P0][Backend] Reduce blocking telemetry ingestion while preserving distributed limits and ordering |
| [#161](https://github.com/notnamansinha/Eki/issues/161) | CLOSED | [P0][Maps] Prevent raw-to-matched marker twitching with bounded pending-match behavior |
| [#162](https://github.com/notnamansinha/Eki/issues/162) | CLOSED | [P0][GPS] Validate adaptive GNSS plausibility and directional matching quality |
| [#163](https://github.com/notnamansinha/Eki/issues/163) | CLOSED | [P0][Direction] Keep unresolved direction pending across backend and frontend |
| [#164](https://github.com/notnamansinha/Eki/issues/164) | CLOSED | [P1][Lifecycle] Resolve pending direction from current endpoints and preserve safe turnaround |
| [#165](https://github.com/notnamansinha/Eki/issues/165) | CLOSED | [P1][Routes] Invalidate matcher caches and reject obsolete route work after admin edits |
| [#166](https://github.com/notnamansinha/Eki/issues/166) | CLOSED | [P1][Backend] Bound per-bus route processing to the latest pending telemetry |
| [#167](https://github.com/notnamansinha/Eki/issues/167) | CLOSED | [P1][Rerouting] Measure and reduce wrong-turn-to-visible-route latency |
| [#168](https://github.com/notnamansinha/Eki/issues/168) | CLOSED | [P1][Firmware] Tune heartbeat, motion hysteresis and retries from measured traces |
| [#169](https://github.com/notnamansinha/Eki/issues/169) | CLOSED | [P1][Infrastructure] Measure RTDB region latency and decide whether migration is justified |
| [#170](https://github.com/notnamansinha/Eki/issues/170) | CLOSED | [P1][Admin] Rebuild reliable authenticated place search with actionable errors on main |
| [#171](https://github.com/notnamansinha/Eki/issues/171) | CLOSED | [P1][Admin] Add endpoint swap, preserve stop IDs and avoid routing calls for metadata edits |
| [#172](https://github.com/notnamansinha/Eki/issues/172) | CLOSED | [P1][Admin] Make route saves idempotent, concurrency-safe and recoverable after timeouts |
| [#173](https://github.com/notnamansinha/Eki/issues/173) | CLOSED | [P1][Status] Separate device presence from passenger service eligibility and live counts |
| [#174](https://github.com/notnamansinha/Eki/issues/174) | CLOSED | [P2][Architecture] Measure RTDB contention and decide whether telemetry/display/lifecycle need separation |
| [#175](https://github.com/notnamansinha/Eki/issues/175) | CLOSED | [P1][Dependencies] Reassess and rebuild the excluded backend Express/qs security fix on main |
| [#191](https://github.com/notnamansinha/Eki/issues/191) | CLOSED | [P2][API] Standardize HTTP and realtime contracts across current endpoints |
| [#192](https://github.com/notnamansinha/Eki/issues/192) | CLOSED | [P2][API] Align resource methods and paths without breaking current clients |
| [#193](https://github.com/notnamansinha/Eki/issues/193) | CLOSED | [P2][API] Define versioned ride-session and boarding resource contracts |
| [#194](https://github.com/notnamansinha/Eki/issues/194) | CLOSED | [P2][API] Model route and fleet operations with durable status resources |
| [#195](https://github.com/notnamansinha/Eki/issues/195) | CLOSED | [P2][Architecture] Decide realtime transports from measured client needs |
| [#196](https://github.com/notnamansinha/Eki/issues/196) | CLOSED | [P2][API] Publish an OpenAPI contract for all backend HTTP endpoints |
| [#204](https://github.com/notnamansinha/Eki/issues/204) | CLOSED | [BUG] UI Bugs on Admin Page |
| [#206](https://github.com/notnamansinha/Eki/issues/206) | CLOSED | [P1] Ride stop history can lose crossings or diverge from its recovery checkpoint |
| [#207](https://github.com/notnamansinha/Eki/issues/207) | CLOSED | [P1] Recover completion after Firestore commits and RTDB publication fails |
| [#208](https://github.com/notnamansinha/Eki/issues/208) | CLOSED | [P1] Feedback page props prevent the production frontend build |
| [#209](https://github.com/notnamansinha/Eki/issues/209) | CLOSED | [P1] Retention can strand ride subcollections after a partial recursive delete |
| [#211](https://github.com/notnamansinha/Eki/issues/211) | CLOSED | [P2] Retire duplicate RTDB commit timestamp and unused inline route geometry |
| [#212](https://github.com/notnamansinha/Eki/issues/212) | CLOSED | [P2] Route context resets leave completed matcher sample IDs behind |
| [#213](https://github.com/notnamansinha/Eki/issues/213) | CLOSED | [P2] Invalid RTDB reroute geometry rejects the browser fetch batch |
| [#214](https://github.com/notnamansinha/Eki/issues/214) | CLOSED | [P2] Legacy RTDB copies and historical reroute geometry bypass retention |
| [#216](https://github.com/notnamansinha/Eki/issues/216) | CLOSED | [P1] Invisible passenger tracking panels intercept live route clicks |
| [#217](https://github.com/notnamansinha/Eki/issues/217) | CLOSED | [P2] Frontend writes can report success for proxy pages and omit tunnel transport safeguards |
| [#218](https://github.com/notnamansinha/Eki/issues/218) | CLOSED | [P2] Passenger availability and admin controls expose misleading or unnamed actions |
| [#219](https://github.com/notnamansinha/Eki/issues/219) | CLOSED | [P2] Ride-history delete confirmation loses focus and ignores Escape |
| [#220](https://github.com/notnamansinha/Eki/issues/220) | CLOSED | [P2] Admin feedback status updates omit the JSON content-type header |
| [#221](https://github.com/notnamansinha/Eki/issues/221) | CLOSED | [P2] Settings edits made during an in-flight save are silently discarded |
| [#224](https://github.com/notnamansinha/Eki/issues/224) | CLOSED | [P1] RTC-only unsent telemetry cannot recover from complete power loss |
| [#225](https://github.com/notnamansinha/Eki/issues/225) | CLOSED | [P2] Moving-marker latency is underreported and pending traces can be cancelled |
| [#228](https://github.com/notnamansinha/Eki/issues/228) | CLOSED | Online stationary vehicles and pending rides must open the passenger map |
| [#229](https://github.com/notnamansinha/Eki/issues/229) | CLOSED | Passenger map selection and quiet signal loss retain stale ride context |
| [#230](https://github.com/notnamansinha/Eki/issues/230) | CLOSED | Validate admin acknowledgements and reconcile service creation retries |
| [#231](https://github.com/notnamansinha/Eki/issues/231) | CLOSED | Expose operator subscription recovery and make tab and timeline controls keyboard accessible |
| [#232](https://github.com/notnamansinha/Eki/issues/232) | CLOSED | Passenger navigation overlaps the route timeline header |
| [#233](https://github.com/notnamansinha/Eki/issues/233) | CLOSED | Upgrade vulnerable Firebase Admin multipart parser dependency |
| [#234](https://github.com/notnamansinha/Eki/issues/234) | CLOSED | Track unpatched development-only braces advisory in Next lint tooling |
| [#235](https://github.com/notnamansinha/Eki/issues/235) | CLOSED | Passenger preview hides configured route when stationary bus is off-route |
| [#237](https://github.com/notnamansinha/Eki/issues/237) | CLOSED | Legacy development board cannot checkpoint with stock flash core dumps enabled |
| [#239](https://github.com/notnamansinha/Eki/issues/239) | CLOSED | [P1] Plausible movement stays frozen after a short telemetry outage |
| [#240](https://github.com/notnamansinha/Eki/issues/240) | CLOSED | [P2] Live RTDB boundary accepts invalid speed and heading ranges |
| [#241](https://github.com/notnamansinha/Eki/issues/241) | CLOSED | [P2] Missing explicit GNSS accuracy overrides valid HDOP |
| [#243](https://github.com/notnamansinha/Eki/issues/243) | CLOSED | [UI] Passenger map selectors should open an in-app dropdown |
| [#245](https://github.com/notnamansinha/Eki/issues/245) | OPEN | [Acceptance] Remaining live testing, hardware and production rollout checklist |
| [#246](https://github.com/notnamansinha/Eki/issues/246) | OPEN | Remaining fixes and optimizations from four audits — AB testing 722ab6e |
