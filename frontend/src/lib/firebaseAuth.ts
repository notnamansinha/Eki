import {
  initializeAuth,
  browserLocalPersistence,
  indexedDBLocalPersistence,
  browserSessionPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
} from "firebase/auth";
import { firebaseApp } from "./firebaseCore";
import { isGoogleRedirectPending, prefersGoogleRedirect } from "./googleSignInFlow";

// With a resolver installed here, Firebase loads Google's sign-in iframe on
// phones before it reports the first auth state, so a flaky network stalls
// every reopen even for signed-out visitors. Phones sign in by redirect, which
// receives the resolver per call; they need it at startup only while returning
// from Google. Popup platforms keep it so the popup still opens within the click.
const needsResolverAtStartup = typeof window === "undefined" ||
  isGoogleRedirectPending(firebaseApp.options.apiKey) || !prefersGoogleRedirect(firebaseApp.options.authDomain);

export const popupRedirectResolver = browserPopupRedirectResolver;

// Keep the landing route's Firebase dependency limited to authentication.
// Select the same persistence at restoration and sign-in. getAuth defaults to
// IndexedDB first; moving it back to local storage on each page load removes
// the other tab's auth record and briefly signs that tab out.
export const auth = initializeAuth(firebaseApp, {
  persistence: [browserLocalPersistence, indexedDBLocalPersistence, browserSessionPersistence],
  ...(needsResolverAtStartup ? { popupRedirectResolver } : {}),
});
export const googleProvider = new GoogleAuthProvider();
