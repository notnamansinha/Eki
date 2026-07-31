# Eki backend

The Express backend authenticates HTTPS GNSS telemetry, owns trip state, writes
Firebase through the Admin SDK, and exposes role-protected application APIs.

## Run

```bash
npm install
Copy-Item .env.example .env
npm run dev
```

Important settings are Firebase Admin credentials/database URL, exact CORS
origins, server-restricted Maps key, `HTTPS_DEVICE_RATE_PER_MINUTE`,
`BUS_STALE_MS`, and worker/retention controls.

Devices post to `/api/devices/{deviceId}/telemetry` with
`Authorization: Device <secret>`. They never receive Firebase credentials.
See [API reference](API.md) and
[architecture](../docs/ARCHITECTURE.md).

For a local demo, provision one device without placing a secret in shell
history:

```bash
npm run provision-device -- --device-id device_01 --bus-id bus_01 --route-id route_01
```

```bash
npm run lint
npm test
npm run build
```
