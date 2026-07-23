# Eki — Backend

This is the Node.js/Express backend for Eki. It handles Google Maps Routes API
integration, authenticated REST operations, and secure Firebase Admin access.

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
- `NOMINATIM_USER_AGENT`: Identifying contact string for the admin-only place-search proxy.

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
- `src/server.ts`: The main Express application and security middleware.
- `src/lib/etaService.ts`: Core logic for computing polylines and real-time ETAs using the Google Maps Routes API.
