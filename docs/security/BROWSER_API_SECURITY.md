# Browser API security and fleet viewing

Last updated: 2026-10-16 00:23 IST (UTC+05:30).

The owner confirmed on 9 October 2026 that any signed-in Google account may
view a bus while it is live. Institutional affiliation is not an access
requirement. Mutation privileges remain server-authorized: administrator and
operator roles do not come from profile editing or browser storage. Freshness
and service state still control passenger availability; authentication does
not make an offline bus bookable.

## Browser authentication

App Check is removed from the browser and API. Browser requests use Firebase
ID tokens; role checks, revocation checks, identity quotas and per-device
credential authentication still apply. Protected listeners wait for trusted
Auth role verification. API calls retain their response deadline.

Deployment workflows disable App Check enforcement for Firestore and RTDB
before publishing the browser. For a manual rollout, follow
[Auth configuration](../CONFIGURATION.md#local-auth-setup). An already deployed
Firebase project's enforcement setting does not change when source is edited.

## Diagnostic interpretation

New firmware sends the existing eighteen health fields plus
`gnssFixAvailable`, `gnssNoFixMs` and `lastTelemetryResponseCode`. The last field
is zero before a telemetry HTTP response, negative for a transport error, or
the latest HTTP status. A healthy fix has zero no-fix duration. Durations use
unsigned 32-bit elapsed arithmetic; first-diagnostic scheduling latches its
elapsed deadline even while Wi-Fi/clock readiness prevents sending. Legacy
eighteen-field devices remain accepted; operators must not infer the three new
fields from missing legacy data.

Detailed backend telemetry status now includes bounded reason counters for
timestamp, credential, rate-limit, payload and dependency rejections, and
accepted sequenced/HDOP versus legacy schema counts. Their scope is explicitly
**this process since startup**, not a persistent per-device or fleet aggregate.
Restart resets them. Existing aggregate rejected-fix counts remain separate.
Invalid HDOP values have their own rejection counter. Accepted samples also
count HDOP at or below the motion-quality threshold, HDOP above that threshold,
and legacy samples without HDOP. The backend exports those fixed-cardinality
counters through OpenTelemetry without device identifiers or coordinates.
An accepted high-HDOP sample is a quality warning, not an intake rejection.

After a 401 credential fault, firmware halts authenticated publishing,
including diagnostics. A 403 keeps the radio on and retries after assignment
repair. Alert on missing diagnostic heartbeat and stale last
accepted telemetry; correlate the last credential rejection/registry change
with the last received health report and authorized local serial evidence.
Silence alone does not distinguish loss of power, network, fix or credentials.
Do not add an unauthenticated location/health beacon. Roll out the new firmware
only through the existing signed-build and physical acceptance process.
