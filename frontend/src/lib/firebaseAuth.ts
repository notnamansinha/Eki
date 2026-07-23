import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { firebaseApp } from "./firebaseCore";

// Keep the landing route's Firebase dependency limited to authentication.
export const auth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
