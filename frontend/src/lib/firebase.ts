/**
 * firebase.ts — backward-compat re-export barrel.
 *
 * All components that import { db, auth, rtdb, googleProvider } from "@/lib/firebase"
 * continue to work unchanged. Under the hood they now get the singleton instances
 * from the split modules (firebaseAuth, firebaseFirestore, firebaseDatabase),
 * which avoids duplicate initializeApp / getAuth / getFirestore / getDatabase calls
 * and allows better tree-shaking per page bundle.
 */
export { auth, googleProvider } from "./firebaseAuth";
export { db } from "./firebaseFirestore";
export { rtdb } from "./firebaseDatabase";
export { firebaseApp as default } from "./firebaseCore";
