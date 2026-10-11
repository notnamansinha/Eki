# Stationary GNSS and hotspot recovery — 11 October 2026

All timestamps below are UTC on 11 October 2026 (add 05:30 for IST). The ESP32
remained stationary and powered during the three phone-hotspot cycles. No ride was
armed, and no live telemetry or session was written by the test host. This is
stationary evidence for [issue #245](https://github.com/notnamansinha/Eki/issues/245),
not moving-route or production acceptance.

## Identity and capture

- Source checkout: `testing` at `3356651f2b3546d5d4b6013122a4822b34bf869d`.
  COM3 enumerated as FTDI `VID:PID=0403:6001`, serial `A5069RR4A`, matching the
  previously used development ESP port. No eFuses were changed and no image was
  flashed. The runtime diagnostic reported firmware version `development`, with
  Secure Boot and flash encryption both false. The image SHA-256 previously
  recorded for PR #291 was not independently read back in this session. The
  later #294 hardware source change only adds a secure-fleet compile guard; it
  does not change the development firmware path used here.
- A 35-second baseline and a 480-second capture used `scripts/capture-serial.py`.
  Raw local traces are ignored at `hardware/.pio/stationary-baseline-20261011.log`
  and `hardware/.pio/stationary-cycles-20261011.log`; they are not published
  because raw telemetry can contain device identity and location. Counts below
  come from parsed, timestamped records. Serial output occasionally interleaved
  fragments from concurrent tasks, so counts are lower bounds for parsable
  events.
- Before physical actions, `check-stationary-runtime.mjs` passed frontend 200,
  backend health 200, CORS preflight 204, and unauthenticated Places 401 for
  `localhost:3000` and `localhost:4000`. During the 480-second capture, 24
  read-only probes each of local `/live`, local `/health`, and the configured
  public tunnel `/live` returned 200. These serially executed probes do not
  prove availability at every instant of a device failure.

## GNSS and stationary telemetry

- Baseline: 35 receiver-backed captures, 36 accepted HTTP 202 responses, all
  reported `stopped`; no retry in the parsed interval. GNSS time and location
  ages were at most 1 ms at the traced RMC commit, and system-minus-GNSS clock
  offset ranged from -52 to -18 ms.
- Main capture: 477 parsed captures were receiver-backed; all 305 parsed HTTP
  attempts reported `stopped`. Of those attempts, 296 returned 202, seven
  returned transport `-1`, one returned `-5`, and one returned `-11`.
  The 480 parsed GNSS trace records had time and location age at most 1 ms at
  RMC commit; system-minus-GNSS offset ranged from 59 to 117 ms, median 80 ms.
  These traces establish receiver acquisition and stationary motion state, not
  satellite count, HDOP, absolute positioning accuracy, or route matching.

| Cycle | Last parsed 202 before loss | Wi-Fi loss / return | First parsed 202 after return | Confirmed stale drops | Observation |
| --- | --- | --- | --- | ---: | --- |
| About 10 s hotspot off | 07:10:46.535 | 07:10:55.485 / 07:11:07.085 | 07:11:09.744 | 0 | One `-11` read timeout and four `-1` connection refusals preceded reassociation; fresh delivery resumed 2.659 s after Wi-Fi connected. |
| About 60 s hotspot off | 07:11:45.685 | 07:11:46.120 / 07:12:53.467 | 07:12:57.535 | 14 | The device retried Wi-Fi without a power cycle; one `-1` occurred after association; fresh delivery resumed 4.068 s later. |
| Longer hotspot off | 07:13:33.866 | 07:13:34.676 / 07:14:57.324 | 07:15:05.302 | 34 | A `-5` accompanied loss, followed by `-1` refusals after association; fresh delivery resumed 7.978 s later. |

The second and third cycles had at least 67 and 82 seconds from the serial
Wi-Fi-loss message to reconnection. Stale-drop counts include only intact,
parsable serial lines. The public tunnel's local ngrok inspector showed no
telemetry ingress during the third cycle's post-association `-1` responses,
then HTTP 202 telemetry ingress beginning at 07:15:04. Nearby tunnel `/live`
probes returned 200. This narrows those refusals to the device-to-tunnel path;
it does not identify the exact socket or carrier cause. The repeated transient
HTTPS failures keep stability acceptance open.

At 07:19:46, a read-only cloud snapshot found the RTDB live node and public
route projection both `online` and `stopped`, with sample timestamps about two
seconds apart. The route catalog reported one available vehicle and zero active
rides. The durable `active_rides` record was absent. The passenger browser
showed “Vehicle available — service not started” before the cycles, during the
second outage, and after recovery. The compact Firestore `bus_locations` record
was offline/pre-departure; it is a durable lifecycle projection rather than a
per-fix stream and did not supply a current ride. No passenger marker or moving
ETA could be validated without an armed service.

## Read-only deployed index probes

At 07:28 UTC, the seven query shapes from
`scripts/verify-firestore-indexes.mjs` were executed against the backend's
configured cloud project with a service-account access token. Each request
selected only document names, limited results to one, and returned HTTP 200:
ride-session retention; `messages` and `messageRateLimits` privacy deletion;
pending privacy queue; abandoned ride reconciliation; processing route-preview
recovery; and processing fleet-job recovery. No document contents were printed
or changed. This verifies query/index readiness in that configured project at
that time. It does not establish readiness in a different production project,
worker recovery, privacy deletion, or release sign-off.

## Capture-tool finding and validation

The diagnostic received at 07:18:58 showed only 30.330 seconds of uptime and
`queueStaleDrops=0`, although serial had recorded the stale drops above. That
places a new boot near 07:18:28, immediately after the original serial capture
closed. The capture tool previously constructed `serial.Serial(port, ...)`,
which opened COM3 with pySerial's default asserted DTR and RTS control lines.
Those lines can reset an ESP32 development board. This timing is strong evidence
of a capture-induced reset, though the exact reset cause was not independently
read from the board. It explains why the later diagnostic cannot be used as a
cumulative counter for the outage run.

The tool now sets DTR and RTS inactive before opening COM3. A 25-second
follow-up capture showed no boot banner, 24 consecutive HTTP 202 records with
sequences 25295–25318, and a later RTDB live sequence of 25355 after the port
closed. That demonstrates sequence continuity across this follow-up close. It
does not prove all board variants or USB drivers are immune to control-line
glitches.

GNSS antenna interruption was declined because it did not fit the physical
setup. GNSS loss/reacquisition, moving route behavior, backend-only fault
injection, credential/assignment faults, and deployed browser/App Check gates
remain unchecked. No real credential or registry setting was changed.
