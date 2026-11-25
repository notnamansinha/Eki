import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type Credential,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase, type Database } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import "dotenv/config";
import { RTDB_FENCED_WRITER_AUTH } from "./workerFence";

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
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(rawServiceAccount);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT must contain valid JSON.");
    }
    if (!serviceAccount || typeof serviceAccount !== "object" || Array.isArray(serviceAccount)) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT must contain a JSON object.");
    }
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

const LIVE_PROJECTION_WRITER_APP = "live-projection-writer";
let liveProjectionWriter: Database | undefined;

/**
 * RTDB handle whose writes are evaluated by `database.rules.json` with
 * `auth = RTDB_FENCED_WRITER_AUTH`, unlike `rtdb`, which bypasses rules.
 * The worker leader publishes the public live-bus projection through it so
 * the rules can reject a superseded generation (see `workerRtdbFencedUpdate`).
 * Created on first use: only the leader opens this second connection.
 */
export function liveProjectionWriterRtdb(): Database {
  if (!liveProjectionWriter) {
    const app = getApps().find(candidate => candidate.name === LIVE_PROJECTION_WRITER_APP) ?? initializeApp({
      ...firebaseAdminApp.options,
      databaseAuthVariableOverride: { ...RTDB_FENCED_WRITER_AUTH },
    }, LIVE_PROJECTION_WRITER_APP);
    liveProjectionWriter = getDatabase(app);
  }
  return liveProjectionWriter;
}
