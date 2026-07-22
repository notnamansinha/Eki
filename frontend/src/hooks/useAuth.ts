"use client";

import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { notifyAuthReady } from "@/lib/authState";

export type UserRole = "passenger" | "driver" | "admin" | null;

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: UserRole;
  isAnonymous: boolean;
}

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  loginLoading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function useAuthState(): AuthContextValue {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    let generation = 0;
    let disposed = false;
    let unsubscribe = () => {};

    void Promise.all([import("firebase/auth"), import("@/lib/firebaseAuth")]).then(
      ([{ onAuthStateChanged }, { auth }]) => {
        if (disposed) return;

        unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const currentGen = ++generation;
      notifyAuthReady();

      if (firebaseUser) {
        try {
          // Role claims are already present in a persisted Firebase session, so
          // this returns without a Firestore round trip for normal app starts.
          // They are issued by the trusted admin sync job, unlike client data.
          const tokenResult = await firebaseUser.getIdTokenResult();
          const claimedRole = tokenResult.claims.role;

          if (
            claimedRole === "passenger" ||
            claimedRole === "driver" ||
            claimedRole === "admin"
          ) {
            if (currentGen !== generation) return;
            setUser({
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              displayName: firebaseUser.displayName,
              photoURL: firebaseUser.photoURL,
              role: claimedRole,
              isAnonymous: firebaseUser.isAnonymous,
            });
            return;
          }

          // Legacy/new accounts without a custom role claim fall back to
          // Firestore so their user profile can be created or migrated.
          const [{ getFirestore, doc, getDoc, setDoc }, { firebaseApp }] =
            await Promise.all([
              import("firebase/firestore"),
              import("@/lib/firebaseCore"),
            ]);
          const db = getFirestore(firebaseApp);
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const userSnap = await getDoc(userDocRef);
          
          if (currentGen !== generation) return;

          let role: UserRole = "passenger";

          if (userSnap.exists()) {
            role = (userSnap.data()?.role as UserRole) ?? "passenger";
          } else {
            const userData = {
              uid: firebaseUser.uid,
              email: firebaseUser.email || "",
              displayName: firebaseUser.displayName || "Unknown User",
              photoURL: firebaseUser.photoURL || "",
              role,
              createdAt: Date.now(),
            };
            try {
              await setDoc(userDocRef, userData);
            } catch (dbErr) {
              console.error("Failed to write new user to Firestore:", dbErr);
            }
          }

          if (currentGen !== generation) return;

          setUser({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            role,
            isAnonymous: firebaseUser.isAnonymous,
          });
        } catch (err) {
          console.error("Firestore role fetch failed:", err);
          if (currentGen !== generation) return;
          setUser({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            role: "passenger",
            isAnonymous: firebaseUser.isAnonymous,
          });
        } finally {
          if (currentGen === generation) setLoading(false);
        }
      } else {
        if (currentGen !== generation) return;
        setUser(null);
        setLoading(false);
      }
        });
      },
    );

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const loginWithGoogle = useCallback(async () => {
    setLoginLoading(true);
    try {
      const [{ signInWithPopup }, { auth, googleProvider }] = await Promise.all([
        import("firebase/auth"),
        import("@/lib/firebaseAuth"),
      ]);
      await signInWithPopup(auth, googleProvider);
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (
        code !== "auth/cancelled-popup-request" &&
        code !== "auth/popup-closed-by-user"
      ) {
        console.error("Login failed:", error);
      }
    } finally {
      setLoginLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const [{ signOut }, { auth }] = await Promise.all([
        import("firebase/auth"),
        import("@/lib/firebaseAuth"),
      ]);
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }, []);

  return { user, loading, loginLoading, loginWithGoogle, logout };
}

/**
 * Keeps one Firebase auth observer and one role lookup alive for the whole
 * app. Route changes no longer re-run sign-in or Firestore role verification.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuthState();

  return createElement(AuthContext.Provider, { value: auth }, children);
}

export function useAuth(): AuthContextValue {
  const auth = useContext(AuthContext);

  if (!auth) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return auth;
}
