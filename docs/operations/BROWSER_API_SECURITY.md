# Browser API security and fleet viewing

The owner confirmed on 9 October 2026 that any signed-in Google account may
view a bus while it is live. Institutional affiliation is not an access
requirement. Mutation privileges remain server-authorized: administrator and
operator roles do not come from profile editing or browser storage. Freshness
and service state still control passenger availability; authentication does
not make an offline bus bookable.

## App Check transport and staged enforcement

The browser API client sends `X-Firebase-AppCheck` when an App Check provider is
configured, alongside the caller's existing ID-token authorization. Token
acquisition shares the existing bounded SDK work and the API's ten-second
response deadline. An unavailable token cannot leave an unbounded request
waiting or turn into an administrator grant. Non-loopback HTTP backend URLs
are rejected; only localhost, 127.0.0.1 and ::1 may use HTTP for development.

`API_APPCHECK_MODE=off|enforce` controls additional backend attestation.
`off` is the compatibility default; invalid values fail startup. `enforce`
verifies Firebase App Check for browser mutations, legacy route/Places/planning
reads and v2 route geometry reads. Ordinary identity/RBAC checks still apply.
Exact device POST telemetry/diagnostics and GET firmware routes remain under
device credential authentication and do not require browser attestation.
Method/path mismatches cannot obtain a device exemption by supplying a header.

Verification permits at most 64 raw fills and 32 coalesced waiters per token
digest, with a two-second response budget. Unsettled fills retain their permits.
Missing or invalid attestation is 403; dependency/capacity failure is 503 with
Retry-After. No token, verifier detail or precise location is included in the
public error body. Invalidations and identity quotas retain their own contracts.

Before enabling enforcement in a deployed environment, inventory supported
API consumers, deploy the attestation-capable browser, register its real
hostname/provider and exercise valid/missing/expired tokens plus authenticated
device intake there. This PR adds and tests enforcement software; it does not
change Firebase Console settings or enable enforcement in the current backend.
See [admin enrollment](../testing/ADMIN_PERMISSION_RECOVERY.md) and
[API retirement](API_READS_AND_RETIREMENT.md) for separate acceptance gates.

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

After a 401 credential fault, firmware halts authenticated publishing,
including diagnostics. A 403 keeps the radio on and retries after assignment
repair. Alert on missing diagnostic heartbeat and stale last
accepted telemetry; correlate the last credential rejection/registry change
with the last received health report and authorized local serial evidence.
Silence alone does not distinguish loss of power, network, fix or credentials.
Do not add an unauthenticated location/health beacon. Roll out the new firmware
only through the existing signed-build and physical acceptance process.
