import * as admin from "firebase-admin";
import "dotenv/config";

/**
 * BusTrack Firebase Admin Initialization
 * Using environment variables for security.
 */

if (!admin.apps.length) {
  try {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    
    if (rawServiceAccount) {
      try {
        const serviceAccount = JSON.parse(rawServiceAccount);
        if (serviceAccount.private_key) {
          serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        }
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: process.env.FIREBASE_DATABASE_URL || "https://bustrack-be165-default-rtdb.firebaseio.com"
        });
        console.log(`✅ Firebase Admin initialized via Service Account [Project: ${serviceAccount.project_id}]`);
      } catch (parseError) {
        console.error("❌ Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:", parseError);
        admin.initializeApp({
          databaseURL: process.env.FIREBASE_DATABASE_URL || "https://bustrack-be165-default-rtdb.firebaseio.com"
        });
      }
    } else {
      admin.initializeApp({
        databaseURL: process.env.FIREBASE_DATABASE_URL || "https://bustrack-be165-default-rtdb.firebaseio.com"
      });
      console.log("ℹ️ Firebase Admin initialized with default credentials (No FIREBASE_SERVICE_ACCOUNT env var found)");
    }
  } catch (error) {
    console.error("❌ Firebase Admin initialization error:", error);
    // If it's already initialized or something, just let it be, but ensure at least one app is there
    if (!admin.apps.length) {
        admin.initializeApp(); // Last ditch
    }
  }
}

export const db = admin.firestore();
export const auth = admin.auth();
export const rtdb = admin.database();
