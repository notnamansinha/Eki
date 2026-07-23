# Eki — Frontend

This is the Next.js frontend for the Eki application, containing the passenger, driver, and admin portals.

## Prerequisites
- Node.js ≥ 20.x
- Firebase Authentication and Firestore configured.
- Two Google Maps API keys (Browser and Server).

## Environment Variables
Create a `.env.local` file in this directory based on the following template:

```env
# Firebase public config (safe to expose)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# Google Maps — BROWSER key (restrict to your domain)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_browser_key_here

# Backend URLs
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
```

## Running the Application
```bash
# Install dependencies (run from root or here)
npm install

# Start development server on localhost:3000
npm run dev

# Build for production
npm run build
```

## Architecture Notes
- All rendering is client-heavy due to mapping requirements (`@vis.gl/react-google-maps`).
- Role-based routing is managed by `RoleGuard`, preventing unauthorized access to the `/admin` and `/driver` portals.
- **Typography & UI**: The application is globally styled using the `Sora` font via `next/font/google` and utilizes semantic `lucide-react` iconography across all panels.
