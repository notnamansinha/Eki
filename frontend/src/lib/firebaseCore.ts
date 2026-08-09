import { getApps, initializeApp } from "firebase/app";

// Static non-deployment builds intentionally run without project secrets. A
// syntactically valid local placeholder prevents the RTDB SDK from emitting a
// misleading fatal URL error while rendering client-only pages. The strict
// production build in next.config.ts still fails closed if any real value is
// missing.
const buildProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "eki-build-placeholder";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL:
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
    `https://${buildProjectId}-default-rtdb.firebaseio.com`,
  projectId: buildProjectId,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

export const firebaseApp =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
