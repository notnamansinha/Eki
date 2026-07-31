import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type Credential,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import "dotenv/config";

/**
 * Firebase Admin initialization.
 *
 * Production fails closed when the RTDB URL is absent or an explicitly
 * supplied service-account value is malformed. When no JSON credential is
 * supplied, Application Default Credentials are used for managed runtimes.
 */
let firebaseAdminApp = getApps()[0];
if (!firebaseAdminApp) {
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  if (process.env.NODE_ENV === "production" && !databaseURL) {
    throw new Error("FIREBASE_DATABASE_URL is required in production.");
  }

  let credential: Credential;
  if (rawServiceAccount) {
    const serviceAccount = JSON.parse(rawServiceAccount);
    if (typeof serviceAccount.private_key === "string") {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }
    credential = cert(serviceAccount);
  } else {
    credential = applicationDefault();
  }

  firebaseAdminApp = initializeApp({
    credential,
    ...(databaseURL ? { databaseURL } : {}),
  });
}

export { firebaseAdminApp };
export const db = getFirestore(firebaseAdminApp);
export const auth = getAuth(firebaseAdminApp);
export const rtdb = getDatabase(firebaseAdminApp);
