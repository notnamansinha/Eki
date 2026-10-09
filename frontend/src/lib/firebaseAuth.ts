import {
  initializeAuth,
  browserLocalPersistence,
  indexedDBLocalPersistence,
  browserSessionPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
} from "firebase/auth";
import { firebaseApp } from "./firebaseCore";

// Keep the landing route's Firebase dependency limited to authentication.
// Select the same persistence at restoration and sign-in. getAuth defaults to
// IndexedDB first; moving it back to local storage on each page load removes
// the other tab's auth record and briefly signs that tab out.
export const auth = initializeAuth(firebaseApp, {
  persistence: [browserLocalPersistence, indexedDBLocalPersistence, browserSessionPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});
export const googleProvider = new GoogleAuthProvider();
