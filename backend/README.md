# Eki — Backend

This is the Node.js/Express backend for Eki. It handles Google Maps Routes API
integration, authenticated REST operations, and secure Firebase Admin access.

## Prerequisites
- Node.js ≥ 20.x
- A Google Cloud Service Account JSON for Firebase Admin.
- A Google Maps Server API Key (restricted to your backend IPs).
- A TLS MQTT 3.1.1 broker with per-device credentials and topic ACLs.

## Environment Variables
Copy `.env.example` to `.env` and fill it out:

```bash
cp .env.example .env
```

Critical variables include:
- `FIREBASE_SERVICE_ACCOUNT`: Stringified JSON of your service account.
- `GOOGLE_MAPS_API_KEY`: Server-side API key for Routes and Places Text Search APIs.
- `MQTT_BROKER_URL`: Must use `mqtts://` in production.
- `MQTT_USERNAME` / `MQTT_PASSWORD`: Read-only telemetry ingestor credential.

## Running the Application
```bash
# Install dependencies
npm install

# Start development server with live reload on localhost:4000
npm run dev

# Build TypeScript to /dist
npm run build

# Start production server
npm run start
```

## Seeding Data
To populate your Firestore database with the initial BRTS routes and stops:
```bash
npm run seed
```

## Role claims

Realtime Database is client-read/server-write. Browsers and hardware devices
cannot mutate live state. Fleet changes made through the admin UI synchronize
claims and revoke stale tokens immediately. For bulk/imported data, run:

```bash
npm run sync-role-claims
```

The script revokes refresh tokens when an assignment is invalid. Affected users
must sign in again.

## Core Modules
- `src/server.ts`: The main Express application and security middleware.
- `src/lib/etaService.ts`: Core logic for computing polylines and real-time ETAs using the Google Maps Routes API.
