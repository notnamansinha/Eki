# Telemetry HTTPS response reuse

## Scope

This change hardens the existing persistent telemetry connection on the current
`testing` branch. It does not replace the telemetry trace format, DNS/TLS timing,
retry classification, diagnostic worker, maintenance client or OTA client.

The optimization is HTTP connection reuse. It avoids another DNS/TCP/TLS setup
while the peer keeps a verified socket open. It does not make the first
certificate-chain verification faster and does not claim TLS ticket resumption.

## Version-matched behavior

`hardware/platformio.ini` selects `espressif32@7.0.1`, whose manifest selects
Arduino-ESP32 `~3.20017.0` (core 2.0.17). The implementation follows these
versioned contracts:

- [`HTTPClient::~HTTPClient`, `end`, `disconnect`, `sendRequest` and `connect`](https://github.com/espressif/arduino-esp32/blob/2.0.17/libraries/HTTPClient/src/HTTPClient.cpp): a request-local parser closes its externally owned client in the destructor; `end()` retains the socket only when reuse remains valid; request sends clear collected response-header values; an already connected request path discards buffered bytes.
- [`HTTPClient::getSize` and `getStreamPtr`](https://github.com/espressif/arduino-esp32/blob/2.0.17/libraries/HTTPClient/src/HTTPClient.cpp): the parsed content length is `-1` when no length is available, and the stream pointer can be absent after disconnect.
- [`WiFiClientSecure::flush`, `available`, `read` and `setHandshakeTimeout`](https://github.com/espressif/arduino-esp32/tree/2.0.17/libraries/WiFiClientSecure/src): secure `flush()` is empty, reads must follow reported availability, and the handshake timeout setter takes seconds.

CA, hostname and time validation remain enabled. Redirect following is disabled
for the credential-bearing telemetry request.

## Response boundary

One publisher-owned `HTTPClient` keeps its response-header table for the process
lifetime. Before a new request, any late buffered data closes the old transport
so `HTTPClient::connect()` cannot silently discard it.

Only HTTP 200/202 acknowledgements with one exposed decimal `Content-Length`
from 0 through 1,024 bytes and no `Transfer-Encoding` are eligible for reuse.
The strict raw value must agree with `HTTPClient::getSize()`. The body is consumed
through a 128-byte stack buffer under one 1,000 ms monotonic deadline.
Unknown-length, malformed, chunked, oversized, truncated, stalled, stream-error
or immediately trailing data closes the socket. The pinned parser exposes only
one collected value for a repeated header, so this helper is not a replacement
wire parser. A complete acknowledgement remains accepted even when cleanup
prevents reuse; there is no hidden POST replay.

## Validation

The focused host suite covers:

- every accepted body length from 0 through 1,024 bytes;
- rejected status, missing/malformed/mismatched length, transfer encoding and
  oversized length;
- fragmented reads, peer close after a complete body and trailing bytes;
- truncation, slow-drip data, final-read deadline boundaries and clock rollover;
- read, availability, disconnect and missing-stream failures.

Run the repository gates before release:

```sh
platformio test --project-dir hardware -e native
platformio run --project-dir hardware -e esp32dev
platformio run --project-dir hardware -e esp32dev-secure
```

Physical acceptance still requires cold and warm telemetry, idle expiry, peer
close, Wi-Fi loss/recovery, certificate rejection, sustained heap/watchdog/GNSS
checks and before/after connection counts. Request duration includes backend work;
it is not certificate-only latency.
