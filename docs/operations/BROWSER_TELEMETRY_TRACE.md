# Browser telemetry context

Last updated: 2026-10-20 18:50 IST (UTC+05:30).

Open an authenticated Eki view with `?telemetryTrace=1` before recording. Keep
each role/tab's export separate and use **Download telemetry trace** before and
after the observation window. The [physical capture guide](FIELD_CAPTURE.md)
describes the serial/cloud evidence to retain alongside browser observations.

Every trace event includes the browser visibility state (`visible`, `hidden` or
`unknown`), its online hint and reduced-motion preference. Unavailable APIs remain
`unknown`/`null`. Events retain wall time and timing events retain the tab's
monotonic time. Visibility changes, online/offline transitions and pagehide/pageshow
are recorded as `browser_lifecycle` events; the page lifecycle events include the
browser's `persisted` flag for back/forward-cache context. Clearing the trace starts
a new run without adding another set of observers. Tracing remains opt-in and the
existing 25,000-event cap still applies.

Use this context to investigate listener, React snapshot and marker-target
intervals. An online hint does not prove that Firebase, the backend or Maps is
reachable. A lifecycle event is not independent proof of OS suspension or display
paint. A long interval still requires recording-coverage, clock and foreground
context; a missing event cannot be treated as zero delay. Older exports lack these
fields and cannot acquire this evidence retrospectively.

The passenger silence banner says **Live location updates delayed** and clears
when a fresh update arrives. An old fix or an offline device projection alone
does not identify a GNSS receiver failure, Wi-Fi failure or an active reconnect.
This wording does not change expiry thresholds, boarding eligibility or ride state.

Browser traces are application evidence. They do not replace Chrome Network HAR
or Performance traces, independent position/timing instruments, genuine role
accounts or the required live provider/field acceptance. Keep precise positions,
message content and credentials private when handling supporting evidence.
