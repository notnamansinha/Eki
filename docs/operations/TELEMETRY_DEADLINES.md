# Telemetry Execution Deadlines

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-023 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This document describes how long one device telemetry request may occupy the backend, what happens to work still running when that time runs out, and how a device should treat each response.

## 2. Scope

The document covers `POST /api/devices/{deviceId}/telemetry`. The queue and concurrency limits that admit the request are listed in [work admission](WORK_ADMISSION.md). The device rate limit and its RTDB lease are described in the [telemetry ingestion load test](TELEMETRY_INGESTION_LOAD_TEST.md). The firmware side of the retry policy is described in [hardware telemetry](../hardware/HARDWARE_TELEMETRY.md).

## 3. Behaviour

### 3.1 Stages and budgets

Node.js first receives and parses the body. The JSON body may be at most 512 bytes, and the server's general limits apply: 15 s to receive the request and 70 s for headers. These limits are not a service-level target.

After parsing, the request gets an 8 s response budget measured on the monotonic clock. The budget covers every later step:

1. Credential and assignment check. It runs before the request takes an ingestion slot and is bounded by the credential fill and KDF limits.
2. Wait for an ingestion slot. One device can have one running request and one waiting request.
3. Device rate limit.
4. Telemetry commit: one ordered RTDB transaction on `activeBuses/{busId}_{routeId}`.

Stages 1, 3 and 4 each get at most 5 s, capped by what remains of the 8 s budget. A stage that succeeds does not reset the budget, and a wall-clock change cannot extend it.

### 3.2 Expiry

When the caller's budget expires, work that has not been dispatched is dropped and later stages do not start. A dispatched SDK call cannot be recalled: its real promise keeps the ingestion slot and the device's ordering until it settles. A retry can take the device's single waiting slot but cannot start a second pipeline for that device until the earlier call settles. Queue expiry removes the waiting payload, its timer and its metadata. Queued KDF work rechecks its credential fill and deadline when it is dispatched, so expired callers do not leave expensive work waiting. A caller deadline does not release a credential fill's registry or KDF slot.

Before the rate-limit and commit stages, and on every RTDB transaction callback retry, the backend rechecks the deadline, even when the event loop delayed the timer. An expired callback aborts. Every telemetry callback also compares the capture timestamp and sequence with the stored ones, so a late callback cannot overwrite a newer sample. A late acknowledgement does not schedule matching or recovery work and does not return success to an expired caller. A transaction that did commit may already have emitted RTDB events; those go through the normal ordered lifecycle processing.

### 3.3 Responses

| Status | Meaning | Device action |
|---|---|---|
| 202 | New sample committed. Matching and lifecycle repair run afterwards. | None. |
| 200 | The sample was not newer than the stored one (a duplicate or a late retry), so nothing was written. | None. |
| 400 | Invalid ID or payload, including a capture time more than 60 s old or more than 10 s ahead of the server. | Do not retry the same payload. |
| 401, 403 | Invalid credentials, or the device has no current assignment. | Check provisioning. |
| 413 | Body larger than 512 bytes. | Do not retry the same payload. |
| 429 | Device rate limit; `Retry-After` and `retryAfterMs` give the wait. | Wait, then send the newest fix. |
| 503 | Dependency, admission or deadline failure. Always carries `Retry-After: 1`, `retryAfterMs: 1000` and `commitState`. | Retry after 1 s with the same capture timestamp and sequence, or send a newer valid fix. |

`commitState: not_dispatched` means this request never dispatched a telemetry write. `commitState: unknown` means a write was dispatched, or the outcome cannot be established. A 503 never proves that the write failed, so a device must not move timestamps backwards or report success it did not receive. The firmware treats 429 and every 5xx as retryable.

## 4. Configuration

None of these values is configurable at run time.

| Item | Value | Source |
|---|---|---|
| Response budget, per-stage budget | 8 s, 5 s | `backend/src/lib/executionDeadline.ts:25` |
| Stage names | `credentials`, `rate limit`, `telemetry commit` | `backend/src/services/deviceTelemetryService.ts:815`, `backend/src/services/deviceTelemetryService.ts:837`, `backend/src/services/deviceTelemetryService.ts:844` |
| Request and header timeouts | 15 s, 70 s | `backend/src/server.ts:107`, `backend/src/server.ts:108` |
| Telemetry body limit | 512 bytes | `backend/src/server.ts:168` |
| 503 contract | `Retry-After: 1`, `retryAfterMs: 1000`, `commitState` | `backend/src/routes/devices.ts:161` |
| Accepted capture-time window | 60 s behind to 10 s ahead | `backend/src/services/telemetryPayload.ts:126` |

## 5. Failure modes and recovery

| Condition | Effect | Action |
|---|---|---|
| A dependency stalls | Requests return 503 within 8 s; dispatched calls keep their slots, so capacity shrinks while the stall lasts. | Watch `telemetry.workQueues.ingestion` and `telemetry.workQueues.kdf` in admin health. |
| An SDK call never settles | Its slot and the device's ordering stay held by design. | Restore the dependency or restart the process. |
| Late commit after a 503 | The sample is stored; a retry with the same timestamp and sequence is answered with 200. | None. |

## 6. Verification

| Behaviour | Tests |
|---|---|
| Budgets across stages, wall-clock rollback, timers delayed past a stage deadline | `backend/src/lib/executionDeadline.test.ts` |
| Held acknowledgement, repeated retries, expired SDK callback, quota expiry, queued request expiry | `backend/src/services/deviceTelemetryDeadline.test.ts` |
| HTTP responses for both commit states | `backend/src/routes/devicesTelemetry.test.ts` |
| A real committed update with a held acknowledgement keeps its slot, then a newer update is admitted (Firebase emulators) | `backend/src/workerFence.integration.test.ts`, run by `npm run test:rules` |

These tests use controlled dependency faults, not production load. Staging latency and replica capacity are measured with the [telemetry ingestion load test](TELEMETRY_INGESTION_LOAD_TEST.md).
