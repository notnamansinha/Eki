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
import { ensureAppCheck } from "@/lib/firebaseAppCheck";

export type UserRole = "passenger" | "driver" | "admin" | null;

interface AppUser {
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
  roleError: string | null;
  loginLoading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function useAuthState(): AuthContextValue {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    let generation = 0;
    let disposed = false;
    let unsubscribe = () => {};
    const authTimeout = window.setTimeout(() => {
      if (!disposed) {
        console.warn("Firebase auth restoration timed out.");
        notifyAuthReady();
        setLoading(false);
      }
    }, 8000);

    void Promise.all([import("firebase/auth"), import("@/lib/firebaseAuth")])
      .then(async ([{ browserLocalPersistence, onAuthStateChanged, setPersistence }, { auth }]) => {
        if (disposed) return;

        // Initialise AppCheck here (post first-paint) rather than as a bare
        // side-effect import in Providers. This keeps the reCAPTCHA iframe
        // injection off the LCP critical path while still running before any
        // Firestore / RTDB calls that AppCheck needs to gate.
        ensureAppCheck();

        // Keep an explicitly signed-in account across navigation, PWA restarts
        // and normal reloads. Only an explicit sign-out should end the session.
        await setPersistence(auth, browserLocalPersistence);
        if (disposed) return;

        unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
          clearTimeout(authTimeout);
          const currentGen = ++generation;
          notifyAuthReady();

          if (firebaseUser) {
            setRoleError(null);
            const storedRole = window.localStorage.getItem(`eki:role:${firebaseUser.uid}`);
            const cachedRole: UserRole =
              storedRole === "passenger" || storedRole === "driver" || storedRole === "admin"
                ? storedRole
                : null;

            // Restore identity for display only. A cached role must never unlock a
            // workspace while authoritative claims/profile verification is pending.
            if (cachedRole) {
              setUser({
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                displayName: firebaseUser.displayName,
                photoURL: firebaseUser.photoURL,
                role: null,
                isAnonymous: firebaseUser.isAnonymous,
              });
            }

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
                window.localStorage.setItem(`eki:role:${firebaseUser.uid}`, claimedRole);
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
              // Firestore so their user profile can be read. Profile creation
              // is server-authoritative (POST /api/users/bootstrap).
              const [{ getFirestore, doc, getDoc }, { firebaseApp }] =
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
                // Ask the backend to create the profile (always as 'passenger';
                // it never overwrites an existing role).
                try {
                  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
                  const idToken = await firebaseUser.getIdToken();
                  if (backendUrl) {
                    const response = await fetch(`${backendUrl}/api/users/bootstrap`, {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${idToken}`,
                      },
                      signal: AbortSignal.timeout(10_000),
                    });
                    const result = await response.json().catch(() => ({})) as {
                      role?: string;
                      error?: string;
                    };
                    if (!response.ok) {
                      throw new Error(result.error || "Unable to bootstrap user profile.");
                    }
                    if (
                      result.role === "passenger" ||
                      result.role === "driver" ||
                      result.role === "admin"
                    ) {
                      role = result.role;
                    }
                  }
                } catch (dbErr) {
                  console.error("Failed to bootstrap user profile:", dbErr);
                }
              }

              if (currentGen !== generation) return;
              setRoleError(null);
              window.localStorage.setItem(`eki:role:${firebaseUser.uid}`, role || "passenger");

              setUser({
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                displayName: firebaseUser.displayName,
                photoURL: firebaseUser.photoURL,
                role,
                isAnonymous: firebaseUser.isAnonymous,
              });
            } catch (err) {
              const code = (err as { code?: string })?.code;
              if (code === "permission-denied") {
                console.warn("[Auth] Firestore role document read permission denied");
              } else {
                console.error("Firestore role fetch failed:", err);
              }
              if (currentGen !== generation) return;
              setRoleError("We could not verify your access. Check your connection and try again.");
              setUser({
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                displayName: firebaseUser.displayName,
                photoURL: firebaseUser.photoURL,
                role: null,
                isAnonymous: firebaseUser.isAnonymous,
              });
            } finally {
              if (currentGen === generation) setLoading(false);
            }
          } else {
            if (currentGen !== generation) return;
            setUser(null);
            setRoleError(null);
            setLoading(false);
          }
        });
      })
      .catch((error) => {
        console.error("Firebase auth initialization failed:", error);
        clearTimeout(authTimeout);
        notifyAuthReady();
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
      clearTimeout(authTimeout);
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
      const signedOutUid = auth.currentUser?.uid;
      await signOut(auth);
      if (signedOutUid) {
        window.localStorage.removeItem(`eki:role:${signedOutUid}`);
      }
      window.localStorage.removeItem("eki:last-workspace");
      const [
        { clearCollectionCache },
        { clearSettingsCache },
        { invalidateLiveBusCache },
      ] = await Promise.all([
        import("@/hooks/useCollection"),
        import("@/hooks/useSettings"),
        import("@/lib/liveBusStore"),
      ]);
      clearCollectionCache();
      clearSettingsCache();
      invalidateLiveBusCache();
      setUser(null);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }, []);

  return { user, loading, roleError, loginLoading, loginWithGoogle, logout };
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
