# Live Projection Leaf Writes: 21 November 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-068 | 1.0 | Historical | 2026-11-25 |

## 1. Purpose

This record measures the Realtime Database download of the public live-bus projection before and after the worker leader changed from whole-route transactions to per-bus leaf writes. It replaces the write path and byte figures of the [R14 live projection evidence](R14_LIVE_PROJECTION.md) (EKI-EVD-043), whose body is unchanged. The [cost model](../cost/COST_MODEL.md#33-realtime-database) uses the figures in Section 4.

## 2. Change measured

Before the change, every publication of one bus ran a transaction on the whole `publicRouteBuses/route:{routeId}` node. The database then sent every bus on that route to every listener, and the backend downloaded the route node again for the transaction itself.

After the change, the leader publishes one bus as a multi-path `update()` of only the fields that changed under `buses/node:{busId}_{routeId}`, with `null` for a removed field and for a bus that leaves the route (`projectionLeafChanges` and `publish` in `backend/src/services/liveBusProjectionWriter.ts`).

| Part | Behaviour | Source |
|---|---|---|
| Route claim | A whole-node transaction, as before, stamps the leader's `_workerGeneration` and returns the node the leader diffs against. A publishing claim always commits, so the leader adopts only a node the server has confirmed. It runs once per route after election and after a denial. Each 60 s recovery pass adds two more. The pass marks every copy stale when it starts, so its first replay on a route claims again and compares the source buses with the stored node. A bus or a whole route erased without a revision is therefore restored by that same pass, even when the bus sends nothing new. After the pass, the leader discards its copy, so the next publication claims again. In the emulator, a claim that writes back an unchanged node sends 0 bytes to listeners. | `claim`, `restoreLineage` |
| Leaf write | Sent through a second Admin app whose `databaseAuthVariableOverride` is `{uid: 'eki:live-projection-writer'}`, so the security rules apply to it. The update carries `_workerGeneration` and `revision` (the confirmed revision plus 1). | `liveProjectionWriterRtdb` in `backend/src/lib/firebaseAdmin.ts`, `workerRtdbFencedUpdate` in `backend/src/lib/workerFence.ts` |
| Stale-leader fence | `database.rules.json` accepts the update only when the caller has that identity, the stored `_workerGeneration` is a number equal to the one sent, and the sent revision is the stored revision plus 1. A successor's claim changes the stored generation, so every later write from the former leader is denied atomically at the destination. On a denial the leader claims again; a claim rejected by a newer generation stops the publication. | `database.rules.json`, `publish` |
| Bus identity | Each bus written must keep `busId` and `routeId` as strings matching the keys it is stored under: `route:{routeId}` and `node:{busId}_{routeId}`. Removing a bus or one of its other fields is allowed. | `database.rules.json` |
| Rules missing | After two denials in a row, the second straight after a confirmed claim, the leader reads the stored `_workerGeneration` and `revision`. If they still match the write it sent, the rules refused a valid update: it switches to whole-route transactions for 5 min and logs a warning. Otherwise the route moved under the claim: that publication goes by transaction, `leafWriteDrifts` counts it, and the next publication claims again with leaf writes. | `LEAF_WRITE_RETRY_MS`, `rulesRefusedValidWrite` |
| Forced transactions | `LIVE_PROJECTION_WRITE_MODE=transaction` keeps the whole-route transaction for every publication. | [Configuration](../CONFIGURATION.md) |

`GET /api/health` reports `workQueues.publicProjection.writeMode` (`leaf`, `transaction-fallback` or `transaction`) and the counters `routeClaims`, `leafWriteAttempts`, `leafWrites`, `leafWriteDenials`, `leafWriteFallbacks` and `leafWriteDrifts` (`backend/src/server.ts:281` spreads `getLiveBusProjectionStatus()` into that object). `publicBytes` now counts the JSON bytes of the changed fields written, not the whole bus value.

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

The fence and recovery are covered by these emulator cases in the same file, run against the committed `database.rules.json` with the real Admin override:

| Case | Shows |
|---|---|
| `accepts a fenced leaf update only from the claimed generation at the next revision, under the committed rules` | A resent update, a skipped revision, a partial bus record, an update without `revision`, a lower or unclaimed generation, and the former leader after a successor's claim are all denied. The writer identity cannot write any other path, and it cannot read the route node or `activeBuses`. |
| `stops a still-running former leader at the destination once its successor has claimed the route` | Two live publishers: the former leader's one attempt is denied, it then stops writing, and the route holds only the successor's state. |
| `%s mode restores a stationary bus on the first recovery pass after %s was erased` | In both leaf and transaction modes, a bus whose public record, or whose whole route node, was erased without a revision is back after one recovery pass, while its source record is unchanged. Before each pass claimed its routes again, leaf mode needed a second pass, 60 s later. Run on 2026-11-23. |

`backend/src/rulesIntegration.test.ts` shows that passenger, administrator and unauthenticated clients cannot write the projection, and that the writer uid gets only the fenced write.

The rules grant the writer uid no write other than the fenced one. They do not limit its reads, however. The uid is a signed-in `auth`, so it can read every path open to any signed-in client:

| Path | Contents |
|---|---|
| `publicRouteBuses/{routeId}/buses` | Route buses |
| `activeRouteGeometry` | Active route geometry |
| `liveRouteCatalog/values` | Catalog values |
| `clientProjectionStatus/public` | Public readiness |

It cannot read anything outside these four paths, such as the `publicRouteBuses` root, a route node, `activeBuses` or `liveRouteCatalog/revisions`. The same test checks each of these reads.

## 5. Limits

- These are emulator measurements on loopback. They exclude TLS, which Firebase bills, and they are not production usage. Moving-bus measurements in production are still needed.
- Only one bus moved. With every bus on a route moving, the passenger figure per second is `n_r * 1.15` KB.
- Each route claim downloads the route node once, about `1.35 * n_r` KB. With leaf writes, each 60 s recovery pass adds up to two claims per route: one when the pass first replays the route, and one after the pass discards the leader's copy. Together they add about `0.045 * n_r` KB/s per route, not per fix. The rest of the recovery pass is unchanged by this work.
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

Both orders occur in `.github/workflows/deploy.yml`. The automatic staging release after a green `main` build releases Hosting and `database:rtdb` only (line 402), so the rules reach the instance before any new backend. A manual dispatch with `deploy_backend=true` deploys the backend first and then the rules (`deploy-staging` needs `deploy-backend-staging`, line 276). Between those two jobs the new backend publishes by whole-route transaction at the old cost, and its next leaf attempt after the 5 min pause succeeds once the rules are released, with no restart. The production job releases Hosting and rules and deploys no backend. No deploy gate is needed for correctness, because each order publishes correctly. To return to whole-route transactions while keeping the new rules, set `LIVE_PROJECTION_WRITE_MODE=transaction` on the backend.
