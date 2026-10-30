# HTTPS Response Reuse

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-HW-004 | 1.0 | Current | 2026-10-30 |

## 1. Introduction

The telemetry publisher keeps one verified HTTPS connection open between samples, so a sample sent every second normally skips DNS, TCP and TLS setup. This document describes when the firmware reuses that connection and when it closes it. Reuse does not make the first certificate verification faster, and the firmware does not use TLS session tickets. New connections follow the [DNS cold connect](DNS_COLD_CONNECT.md) design. Diagnostics, release checks and firmware downloads open a new connection each time and are outside this design.

## 2. Context

`hardware/platformio.ini` pins `espressif32@7.0.1`, which selects Arduino-ESP32 2.0.17. The design depends on these behaviours of that release [1], [2], [3]:

- A request-local `HTTPClient` closes an externally owned client in its destructor. `end()` keeps the socket only while reuse remains valid.
- On an already connected client, the request path discards buffered bytes before `sendHeader()` performs the first write.
- `Client::available`, `write` and `stop` are virtual, so a wrapper can intercept them.
- `HTTPClient::getSize()` returns `-1` when no length is known, and `getStreamPtr()` can be null after a disconnect.
- `WiFiClientSecure::flush()` does nothing, reads must follow reported availability, and `setHandshakeTimeout()` takes seconds.

## 3. Design

### 3.1 Connection ownership

One publisher-owned, static `HTTPClient` lives for the whole process, so its destructor never closes the socket between samples. It is configured once: 1 s connect timeout, 1.5 s request timeout, reuse on, redirects off, and six collected response headers (`Retry-After`, `X-Eki-Server-Received-At`, `X-Eki-Server-Responded-At`, `Ngrok-Error-Code`, `Content-Length`, `Transfer-Encoding`). Root CA, hostname and clock validation stay on. The backend's keep-alive timeout is 65 s, so the 1 s telemetry cadence keeps the socket warm.

### 3.2 Request boundary guard

`ReuseGuardedClient` in [`http_response.h`](../../hardware/include/http_response.h) wraps the telemetry client. The publisher arms the guard before each request. From then until the first byte of the request is written, the wrapper closes the transport if it sees buffered data, either from the library's reuse check or from a final availability check before that write. Data that arrives after the first request write stays visible to response parsing; the library's reuse path cannot silently consume it.

### 3.3 Accepted response drain

The connection stays open only after a response that meets every condition:

1. The status is `200` or `202`.
2. There is exactly one exposed decimal `Content-Length` from 0 to 1,024, it agrees with `HTTPClient::getSize()`, and there is no `Transfer-Encoding`.
3. The firmware reads the whole body through a 128-byte stack buffer within one 1,000 ms deadline, and no bytes follow it.

Any other outcome closes the socket: an unknown, malformed, chunked or oversized length, truncation, a slow drip past the deadline, a stream error, or trailing data. The pinned parser keeps only one value for a repeated header, so this check does not replace a full wire parser. A complete acknowledgement still counts as accepted when the cleanup closes the socket; the firmware never replays a POST that the backend accepted.

## 4. Constraints and risks

- Request duration includes backend processing; it is not a measure of certificate work.
- Physical acceptance still needs cold and warm telemetry, idle expiry, peer close, Wi-Fi loss and recovery, certificate rejection, sustained heap, watchdog and GNSS checks, and connection counts before and after a change.

## 5. Verification

The native suites `test_http_response` and `test_http_reuse_guard` cover:

- every accepted body length from 0 to 1,024 bytes;
- rejected statuses, missing, malformed or mismatched lengths, transfer encoding and oversized lengths;
- fragmented reads, peer close after a complete body and trailing bytes;
- truncation, slow-drip data, the final-read deadline boundary and clock rollover;
- read, availability, disconnect and missing-stream failures;
- buffered bytes during the library reuse check, bytes arriving before the first request write, availability failures, clean guard release and unguarded response visibility.

Run the repository gates before a release:

```powershell
platformio test --project-dir hardware -e native
platformio run --project-dir hardware -e esp32dev
platformio run --project-dir hardware -e esp32dev-secure
```

## 6. References

[1] Espressif Systems, "HTTPClient.cpp," arduino-esp32 release 2.0.17, github.com/espressif/arduino-esp32/blob/2.0.17/libraries/HTTPClient/src/HTTPClient.cpp. Accessed: 2026-10-30.

[2] Espressif Systems, "Client.h," arduino-esp32 release 2.0.17, github.com/espressif/arduino-esp32/blob/2.0.17/cores/esp32/Client.h. Accessed: 2026-10-30.

[3] Espressif Systems, "WiFiClientSecure," arduino-esp32 release 2.0.17, github.com/espressif/arduino-esp32/tree/2.0.17/libraries/WiFiClientSecure/src. Accessed: 2026-10-30.
