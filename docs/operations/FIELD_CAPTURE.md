# Field Capture

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-008 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This procedure records a physical GNSS ride so that device, backend and browser timings can be correlated afterwards. It uses four repository tools:

| Tool | Purpose | Arguments |
|---|---|---|
| `scripts/capture-serial.py` | Records the device's serial output without resetting or commanding it | `--port`, `--baud` (default `115200`), `--duration` (seconds; `0` records until the stop file exists), `--out`, `--stop-file` |
| `scripts/supervise-field-capture.py` | Runs several recorders, restarts any that exit, and stops them all on one stop file | `--config <manifest.json>` |
| `scripts/analyze-telemetry-trace.mjs` | Correlates device trace lines with a browser trace export | `--device`, `--browser` (repeatable), `--health` (repeatable), `--out` |
| `scripts/archive-field-evidence.py` | Builds a verified private ZIP of a finished run | `--source`, `--out`, `--exclude` (repeatable) |

What a capture can show depends on the ride state. A moving trace without a ride session measures delivery only; stop arrivals, boarding, completion and the return service need a running service.

## 2. Prerequisites

- Python 3 with pySerial (`python -m pip install pyserial`). Do not create a file named `serial.py` next to the scripts; it would shadow pySerial.
- Node.js and the repository at the commit under test.
- A device build that prints `[TelemetryTrace]` lines (`esp32dev`; the `esp32dev-quiet` build removes them).
- Output folders under the ignored `temp/` and `artifacts/` directories, or another private location. Every run uses a new folder.
- One serial tool per port. Close any PlatformIO monitor before recording.

## 3. Before the ride

1. In Live Ops, confirm the device, bus and route. In Fleet & People, confirm the bus's route and its single operator. Expected: the IDs match.
2. Power the device at the route origin. Expected: the service starts by itself and the Live Ops card changes from `Service setup pending` to `Direction Pending`, `Awaiting Stop 1` or `In Service` ([automatic GNSS service](AUTOMATIC_GNSS_SERVICE.md#2-lifecycle)). Record the session ID. If the card shows `Tracking paused`, use `Resume tracking`. An online marker or a moving speed alone is not a started service.
3. Let direction resolve from a stopped fix within 10 m of the origin stop. Without one, the backend needs at least three fresh, reliable moving fixes covering 30 m along one unambiguous first leg; until then direction stays pending. Do not force a direction or invent coordinates.
4. Open the Admin and Passenger views with `?telemetryTrace=1` in the URL and keep each tab open without refreshing. Use `Download telemetry trace` in each tab before and after the run, and note which tab was in the foreground ([browser telemetry trace](BROWSER_TELEMETRY_TRACE.md)).
5. Record the source commit and any uncommitted diff, the build hashes, the receiver and antenna setup, sky conditions and any independent position reference. A hash computed on the laptop does not prove what is flashed. The identity fields are listed in [field acceptance](../../qa/FIELD_ACCEPTANCE.md).
6. Confirm that the backend and its tunnel receive fresh fixes. Record a stopped baseline and the start time. Keep the USB connection, hotspot and laptop awake. Name the person responsible for physical actions and note every intentional disconnect or stop.

## 4. Record the serial log

1. Start the recorder from the repository root with the device's port and a new output path:

   ```powershell
   python scripts/capture-serial.py --port COM3 --duration 1800 --out temp/field-run/serial.log --stop-file temp/field-run/STOP
   ```

   Expected: the recorder runs silently and creates three files: `serial.log` (each line prefixed with the host time in milliseconds), `serial.log.raw.bin` (exact bytes) and `serial.log.events.jsonl` (start, port open, chunk offsets, serial errors and end).
2. To record without a deadline, use `--duration 0`; this requires `--stop-file`.
3. To stop early, create the stop file, for example `New-Item -ItemType File temp/field-run/STOP`. Expected: the recorder writes `capture_end` to the events file and prints a JSON summary with line, byte and serial error counts.

The recorder sets DTR and RTS inactive before opening the port and sends nothing to the device. Some USB adapters reset the board regardless. After a serial error it retries every second within the original deadline; a partial line is flushed at the disconnect, so lines never join across reconnects. It refuses to overwrite any existing output file.

## 5. Supervise several recorders

Use the supervisor when a run needs several recorders or must survive recorder crashes.

1. Write a private manifest. `run` must be a folder that does not exist yet; each worker is an argument array run without a shell from `cwd`, and `{segment}` and `{stop_file}` are replaced at launch:

   ```json
   {
     "run": "C:/capture/new-run",
     "cwd": "C:/path/to/Eki",
     "workers": {
       "serial": ["python", "scripts/capture-serial.py", "--port", "COM3", "--duration", "0", "--out", "{segment}/serial.log", "--stop-file", "{stop_file}"]
     }
   }
   ```

   Optional keys: `graceSeconds` (default `90`) and `minimumFreeBytes` (default `1073741824`, 1 GiB). Worker names are lower-case letters, digits, `_` and `-`. Every worker must stop when `{stop_file}` exists and write only below `{segment}`. Do not supervise the application under test with this tool.
2. Start the supervisor:

   ```powershell
   python scripts/supervise-field-capture.py --config C:/capture/private-manifest.json
   ```

   Expected: `C:/capture/new-run` contains `segments/serial/0001/`, `supervisor-events.jsonl` and `recorder-status.json`.
3. When recording is finished, create the stop file from another terminal:

   ```powershell
   New-Item -ItemType File C:/capture/new-run/STOP
   ```

   Expected: workers exit within `graceSeconds`; any still running are terminated and listed as forced terminations. The supervisor exits `0` only when it stopped on the stop file, nothing was forced, and every worker's last segment exited `0`.

A worker that exits is restarted into the next numbered segment after 2, 4, 8, 16, 32 and then 60 s. Earlier segments are kept. Free space below `minimumFreeBytes` stops the run with reason `CRITICAL_STORAGE`. If Windows blocks the status file, the supervisor records `status_publish_deferred` and keeps the previous `recorder-status.json`; check its `atUtc` timestamp. Other storage errors stop the supervisor.

## 6. Check the recording during the run

1. Before announcing that recording has started, confirm that every required stream grows: serial segment, browser tabs, backend logs and any reference instrument. Expected: each file's size increases within a minute. Running processes alone do not prove capture.
2. Repeat the check during the run. Record any missing stream as a gap in scope.

The [21 October capture record](../testing/MOVING_GNSS_CAPTURE_2026_10_21.md) shows a run in which a running supervisor did not establish complete capture.

## 7. Analyse the traces

Analyse each browser role separately:

```powershell
node scripts/analyze-telemetry-trace.mjs --device temp/field-run/serial.log --browser temp/field-run/passenger.json --out temp/field-run/passenger-report.md
node scripts/analyze-telemetry-trace.mjs --device temp/field-run/serial.log --browser temp/field-run/admin.json --out temp/field-run/admin-report.md
```

Add `--health <file>` for each saved administrator `GET /api/health` response. Expected: a Markdown report with latency tables per stage.

Interpretation rules:

- Capture and ingress intervals are intervals between accepted samples seen on the serial port. A gap there does not prove a backend outage; check the recorder's events file, the browser cadence and an independent cloud record before assigning it to a stage.
- Browser cadence uses each tab's monotonic clock. Background tabs and truncated exports can create apparent gaps.
- Do not convert sequence gaps into packet-loss percentages. A device read timeout can coincide with a backend acceptance; compare sequence numbers and device send times.
- A React snapshot or marker-target callback is not a measured screen paint.

## 8. Archive the evidence

1. Stop every recorder and supervisor. Expected: no process holds files in the run folder.
2. Archive to a new path outside the source folder:

   ```powershell
   python scripts/archive-field-evidence.py --source temp/field-run --out artifacts/field-run.private.zip
   ```

   Expected: a JSON summary with `crcVerified: true` and `everyEvidenceSha256Verified: true`, the ZIP, and a `.sha256` file next to it.
3. If a process still holds a file, stop it, or pass `--exclude <relative-path>` and keep that file separately; the exclusion is listed in the archive manifest.

The archiver hashes every file, writes `<out>.partial`, checks the ZIP CRC and every SHA-256 inside it, then publishes the ZIP. It refuses existing outputs, symbolic links, an empty folder, an output inside the source and a source file named `SHA256SUMS.json` (reserved for the manifest). It never deletes source files. After a failure the partial file stays for inspection; investigate, then use a new output name.

A verified local ZIP is not an off-device backup. Keep raw evidence private; publish only redacted reports and aggregate measurements. Precise positions and device-specific firmware stay private.

## 9. Verify the tools

Run `python scripts/field-capture-checks.py`. Expected: 19 tests pass without pySerial or hardware. The same checks run inside `npm test` through `scripts/field-capture.test.mjs`.

## 10. Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| `FileExistsError` or a refused output | The output path or run folder already exists | Use a new path; never reuse an evidence folder |
| `Duration zero requires --stop-file` | `--duration 0` without `--stop-file` | Add `--stop-file` |
| `ModuleNotFoundError: serial` | pySerial missing, or a local `serial.py` shadows it | Install pySerial; rename the local file |
| Recorder logs `serial_error` repeatedly | Cable, port or another tool holding the port | Reseat the cable; close other serial tools |
| Analyzer report has no device samples | Device build without `[TelemetryTrace]` lines | Record with an `esp32dev` build |
| Supervisor exit code `1` after a normal stop | A worker was forced or its last segment failed | Inspect every segment's `stderr.log` and the events file before using the evidence |
