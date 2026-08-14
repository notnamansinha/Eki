# Eki backend

The TypeScript/Express backend is the authority for hardware ingestion, fleet/route/device commands and ordered ride lifecycle. It uses Firebase Admin with service-account JSON or Application Default Credentials, writes current data to RTDB and durable state to Firestore, and elects one background worker with a Firestore lease.

```powershell
npm install
Copy-Item backend/.env.example backend/.env
npm run dev --workspace=backend
```

Important configuration is fully described in `.env.example`: exact CORS origins, `FIREBASE_DATABASE_URL`, server-restricted Maps key, device/auth limits, stale/reconciliation periods, worker identity and explicit retention opt-in. Production should prefer Workload Identity/ADC; if `FIREBASE_SERVICE_ACCOUNT` is used, provide the complete JSON through a secret manager.

```powershell
npm run lint --workspace=backend
npm run test --workspace=backend
npm run build --workspace=backend
```

Provision a device only after bus and route records exist:

```powershell
npm run provision-device --workspace=backend -- `
  --device-id device_01 --bus-id bus_01 --route-id route_01
```

This transaction rejects duplicate assignment/active ride/active bus lock, generates a random secret, stores only its salted scrypt verifier, and prints the plaintext once.

See [API reference](API.md), [LLD](../design/LOW_LEVEL_DESIGN.md), [Firebase model](../data/FIREBASE_DATA_MODEL.md), and [test strategy](../testing/TEST_STRATEGY.md).

For a first-time setup, role/workflow explanation, environment-variable
reference, troubleshooting, and the boundary between Hosting deployment and
backend/runtime deployment, read [Getting started](../GETTING_STARTED.md)
and [configuration](../CONFIGURATION.md).
