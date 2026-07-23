# Eki — Backend

This is the Node.js/Express backend for the Eki application. It handles Google Maps Routes API integration, real-time WebSocket coordination via Socket.io, and secure interactions with Firebase Admin.

## Prerequisites
- Node.js ≥ 20.x
- A Google Cloud Service Account JSON for Firebase Admin.
- A Google Maps Server API Key (restricted to your backend IPs).

## Environment Variables
Copy `.env.example` to `.env` and fill it out:

```bash
cp .env.example .env
```

Critical variables include:
- `FIREBASE_SERVICE_ACCOUNT`: Stringified JSON of your service account.
- `GOOGLE_MAPS_API_KEY`: Server-side API key for Routes API.
- `ADMIN_API_SECRET`: A secure random string for protected endpoints.

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

Realtime Database write access is authorized with Firebase custom claims rather
than client-writable profile data. After changing a user's Firestore `role`, a
driver assignment, or a bus's assigned routes, run:

```bash
npm run sync-role-claims
```

Affected users must refresh their Firebase ID token (sign out and back in) before
the new role takes effect.

## Core Modules
- `src/server.ts`: The main Express application and Socket.io setup.
- `src/sockets/trackingGateway.ts`: The unified WebSocket handler for location updates and passenger requests.
- `src/lib/etaService.ts`: Core logic for computing polylines and real-time ETAs using the Google Maps Routes API.
