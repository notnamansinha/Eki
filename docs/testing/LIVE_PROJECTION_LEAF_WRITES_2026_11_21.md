# Live Projection Leaf Writes: 21 November 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-062 | 1.0 | Historical | 2026-11-21 |

## 1. Purpose

This record measures the Realtime Database download of the public live-bus projection before and after the worker leader changed from whole-route transactions to per-bus leaf writes. It replaces the write path and byte figures of the [R14 live projection evidence](R14_LIVE_PROJECTION.md) (EKI-EVD-043), whose body is unchanged. The [cost model](../cost/COST_MODEL.md#33-realtime-database) uses the figures in Section 4.

## 2. Change measured

Before the change, every publication of one bus ran a transaction on the whole `publicRouteBuses/route:{routeId}` node. The database then sent every bus on that route to every listener, and the backend downloaded the route node again for the transaction itself.

After the change, the leader publishes one bus as a multi-path `update()` of only the fields that changed under `buses/node:{busId}_{routeId}`, with `null` for a removed field and for a bus that leaves the route (`projectionLeafChanges` and `publishBus` in `backend/src/services/liveBusProjection.ts`).

| Part | Behaviour | Source |
|---|---|---|
| Route claim | A whole-node transaction, as before, stamps the leader's `_workerGeneration` and returns the node the leader diffs against. A publishing claim always commits, so the leader adopts only a node the server has confirmed. It runs once per route after election, after a denial, and after each 60 s recovery pass, which discards the leader's copy so that the next claim repairs edits made without a revision. In the emulator, a claim that writes back an unchanged node sends 0 bytes to listeners. | `claimRoute` |
| Leaf write | Sent through a second Admin app whose `databaseAuthVariableOverride` is `{uid: 'eki:live-projection-writer'}`, so the security rules apply to it. The update carries `_workerGeneration` and `revision` (the confirmed revision plus 1). | `liveProjectionWriterRtdb` in `backend/src/lib/firebaseAdmin.ts`, `workerRtdbFencedUpdate` in `backend/src/lib/workerFence.ts` |
| Stale-leader fence | `database.rules.json` accepts the update only when the caller has that identity, the stored `_workerGeneration` is a number equal to the one sent, and the sent revision is the stored revision plus 1. A successor's claim changes the stored generation, so every later write from the former leader is denied atomically at the destination. On a denial the leader claims again; a claim rejected by a newer generation stops the publication. | `database.rules.json`, `publishBus` |
| Rules missing | Two denials in a row, the second straight after a confirmed claim, switch the leader to whole-route transactions for 5 min and log a warning. | `LEAF_WRITE_RETRY_MS` |
| Forced transactions | `LIVE_PROJECTION_WRITE_MODE=transaction` keeps the whole-route transaction for every publication. | [Configuration](../CONFIGURATION.md) |

`GET /api/health` reports `workQueues.publicProjection.writeMode` (`leaf`, `transaction-fallback` or `transaction`) and the counters `routeClaims`, `leafWriteAttempts`, `leafWrites`, `leafWriteDenials` and `leafWriteFallbacks`. `publicBytes` now counts the JSON bytes of the changed fields written, not the whole bus value.

Browsers need no change. `frontend/src/lib/createLiveBusStore.ts` already consumes `child_added`, `child_changed` and `child_removed`, and the SDK delivers the merged bus record.

## 3. Method

| Item | Value |
|---|---|
| Test | `delivers a route listener only the changed leaves of a fix, whatever the number of buses on the route` in `backend/src/liveBusProjection.fences.integration.test.ts` |
| Run | `npm run test:rules`, which prints `R14_LISTENER_WIRE_MEASUREMENT` |
| Environment | Windows 11, Node.js 26.13.1, Java 27.0.1.1, `firebase-tools@15.14.0`, Realtime Database emulator 4.11.2, loopback only |
| Workload | One bus on route A moves for 10 fixes. Each fix is two publications, as in production: the telemetry write, then the route-match write. Routes with 1, 5 and 10 buses run in turn against the same publisher. |
| Bus record | Every public field at production precision: 1,353 JSON bytes |
| Passenger listener | A raw RTDB protocol connection listening on `publicRouteBuses/route:{routeId}/buses`. It counts the JSON text the server sends, excluding WebSocket and TLS framing. |
| Admin listener | The same, on the `publicRouteBuses` root |
| Backend | TCP bytes received by the publisher's own two connections, including WebSocket framing but not TLS. They include its `activeBuses` listener, because the test writes the source records from a separate connection; in production the backend writes them itself. |

Each mode publishes the same 20 publications per route size. The test asserts the commit counts, that leaf listener bytes vary by at most 2 % between 1, 5 and 10 buses, that transaction bytes grow with the number of buses, and that leaf backend bytes vary by at most 10 % across windows without a recovery pass. The projection's 60 s recovery pass rereads source pages and claims each route again. That download is not per fix, so the test records `recoveryReads` and `routeClaims` per window and leaves such windows out of the backend comparison.

## 4. Results

Bytes per fix (two publications), measured on 2026-11-21:

| Buses on the route | Passenger listener, transaction | Passenger listener, leaf | Admin fleet listener, transaction | Admin fleet listener, leaf | Backend, transaction | Backend, leaf |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 2,952 | 1,152 | 3,031 | 1,257 | 10,296 | 972 |
| 5 | 13,936 | 1,152 | 14,016 | 1,258 | 43,375 | 973 |
| 10 | 27,666 | 1,152 | 27,746 | 1,258 | 84,447 | 973 |

- Listener bytes per fix no longer depend on the number of buses on the route. With 10 buses a passenger listener receives 24 times fewer bytes per fix.
- With transactions, a listener received about `0.21 + 2.75 * n_r` KB per fix of one bus (least-squares fit), so one listener on a route with `n_r` moving buses received about `n_r * (0.21 + 2.75 * n_r)` KB/s.
- The backend's projection download fell from about `2.06 + 8.24 * n_r` KB per fix to 0.97 KB. Of the 10.3 KB at one bus, about 9.3 KB was the transaction downloading and echoing the route node.
- The initial snapshot a listener receives on attach is unchanged: 1,684, 7,176 and 14,041 bytes for 1, 5 and 10 buses.

The fence is covered by these emulator cases in the same file, run against the committed `database.rules.json` with the real Admin override:

| Case | Shows |
|---|---|
| `accepts a fenced leaf update only from the claimed generation at the next revision, under the committed rules` | A resent update, a skipped revision, a partial bus record, an update without `revision`, a lower or unclaimed generation, and the former leader after a successor's claim are all denied. The writer identity has no other read or write. |
| `stops a still-running former leader at the destination once its successor has claimed the route` | Two live publishers: the former leader's one attempt is denied, it then stops writing, and the route holds only the successor's state. |

`backend/src/rulesIntegration.test.ts` shows that passenger, administrator and unauthenticated clients cannot write the projection, and that the writer uid gets only the fenced write.

## 5. Limits

- These are emulator measurements on loopback. They exclude TLS, which Firebase bills, and they are not production usage. Moving-bus measurements in production are still needed.
- Only one bus moved. With every bus on a route moving, the passenger figure per second is `n_r * 1.15` KB.
- Each route claim downloads the route node once, about `1.35 * n_r` KB. With leaf writes a claim follows each 60 s recovery pass, so it adds about `0.02 * n_r` KB/s per route, not per fix. The recovery pass itself is unchanged by this work.
- The backend figures cover the projection's own connections only. The trip-state engine's `activeBuses` listener and the backend's telemetry transactions are unchanged by this work and not measured here.
- On a production RTDB instance the second connection carries only writes and their acknowledgements.
- Rules evaluate the merged result of an update, so they cannot tell an omitted `_workerGeneration` from an unchanged one. The fence relies on `workerRtdbFencedUpdate` always writing the caller's own generation, as the whole-route transaction relied on `workerRtdbTransaction` stamping it. An update without the next `revision` is always denied.
- The rules identify the writer by `auth.uid` only. Ordinary sign-in cannot produce that uid, but a custom token minted with the project's service-account signing rights can; in the emulator such a token's claims also appear as top-level `auth` variables, so no claim check separates it from the Admin override. That capability already amounts to Admin access.

## 6. Rollout

The leaf write needs the rules in this change deployed to the same instance (`bustrack-be165-asia-rtdb`). Either order works:

| State | Behaviour |
|---|---|
| New rules, old backend | The old backend writes through the unrestricted Admin handle, which the rules do not restrict. No change. |
| New backend, old rules | The rules deny the leaf write. The leader falls back to whole-route transactions, logs a warning every 5 min and reports `writeMode: transaction-fallback`. Publication continues at the old cost. |
| Both deployed | `writeMode: leaf`, `leafWrites` increasing and `leafWriteFallbacks` 0 on `GET /api/health`. |

Deploy the rules first so the backend starts in leaf mode. To return to whole-route transactions while keeping the new rules, set `LIVE_PROJECTION_WRITE_MODE=transaction` on the backend.
