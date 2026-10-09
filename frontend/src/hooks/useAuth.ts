"use client";

import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { beginAuthVerification, getAuthVerificationGeneration, notifyAuthReady } from "@/lib/authState";
import { withTimeout } from "@/lib/promiseTimeout";
import { apiRequest } from "@/lib/apiClient";

const ROLE_VERIFICATION_TIMEOUT_MS = 10_000;

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
  loginReady: boolean;
  loginError: string | null;
  loginFallbackAvailable: boolean;
  loginLoading: boolean;
  loginWithGoogle: () => Promise<void>;
  loginWithGoogleRedirect: () => Promise<void>;
  logout: () => Promise<void>;
  refreshAccess: () => Promise<void>;
}

type FirebaseLoginDependencies = {
  signInWithPopup: typeof import("firebase/auth").signInWithPopup;
  signInWithRedirect: typeof import("firebase/auth").signInWithRedirect;
  getRedirectResult: typeof import("firebase/auth").getRedirectResult;
  auth: typeof import("@/lib/firebaseAuth").auth;
  googleProvider: typeof import("@/lib/firebaseAuth").googleProvider;
};

function authErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^auth\/[a-z-]+$/.test(code) ? code : undefined;
}

function loginErrorMessage(code: string | undefined): string {
  if (code === "auth/popup-blocked") {
    return "Your browser blocked the Google sign-in popup. Allow popups for this site or use full-page sign-in.";
  }
  if (code === "auth/unauthorized-domain") {
    return "This site is not authorized for Google sign-in. Contact the app administrator.";
  }
  if (code === "auth/operation-not-allowed") {
    return "Google sign-in is disabled for this app. Contact the app administrator.";
  }
  if (code === "auth/internal-error" || code === "auth/network-request-failed") {
    return `Google sign-in could not finish${code ? ` (${code})` : ""}. Try again or use full-page sign-in.`;
  }
  return `Google sign-in failed${code ? ` (${code})` : ""}. Please try again.`;
}

function canUseRedirectFallback(code: string | undefined): boolean {
  return code === "auth/popup-blocked" ||
    code === "auth/internal-error" ||
    code === "auth/network-request-failed";
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function useAuthState(): AuthContextValue {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [loginReady, setLoginReady] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginFallbackAvailable, setLoginFallbackAvailable] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const loginDependencies = useRef<FirebaseLoginDependencies | null>(null);
  const refreshVerification = useRef<null | (() => Promise<void>)>(null);
  const refreshFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let generation = 0;
    let disposed = false;
    let unsubscribe = () => {};
    const authTimeout = window.setTimeout(() => {
      if (!disposed) {
        console.warn("Firebase auth restoration timed out.");
        setRoleError("Sign-in restoration timed out. Reload the page to try again.");
        setLoading(false);
      }
    }, 8000);

    void Promise.all([import("firebase/auth"), import("@/lib/firebaseAuth")])
      .then(async (dependencies) => {
        const [authModule, { auth, googleProvider }] = dependencies;
        if (disposed) return;

        // Cache these before enabling login so the click handler can open the
        // popup synchronously within the browser's user activation.
        loginDependencies.current = {
          signInWithPopup: authModule.signInWithPopup,
          signInWithRedirect: authModule.signInWithRedirect,
          getRedirectResult: authModule.getRedirectResult,
          auth,
          googleProvider,
        };

        // firebaseAuth chooses persistent storage before restoring the account.
        // Do not migrate storage here: removing the old auth record signs out
        // other tabs, and an unavailable local store must retain its fallback.
        if (disposed) return;

        const verifyUser = async (firebaseUser: import("firebase/auth").User | null, forceRefresh = false) => {
          clearTimeout(authTimeout);
          const currentGen = ++generation;
          beginAuthVerification();
          const verificationGeneration = getAuthVerificationGeneration();
          setUser(null);

          if (firebaseUser) {
            setLoading(true);
            setLoginLoading(false);
            setLoginError(null);
            setLoginFallbackAvailable(false);

            // Signed-out visitors never need App Check. For signed-in users,
            // wait for the first App Check token before publishing the user;
            // Firestore listeners use that state to avoid permission-denied
            // requests made before App Check is ready.
            const isCurrentAuth = () =>
              !disposed &&
              currentGen === generation &&
              verificationGeneration === getAuthVerificationGeneration() &&
              auth.currentUser?.uid === firebaseUser.uid;
            setRoleError(null);

            try {
              const { ensureAppCheck } = await import("@/lib/firebaseAppCheck");
              await ensureAppCheck({ forceRefresh });
              if (!isCurrentAuth()) return;
              // Refresh persisted tokens so newly synchronized admin claims and
              // revoked/downgraded access are observed before publishing a workspace.
              // Only trusted Auth claims authorize a privileged workspace.
              const tokenResult = await withTimeout(
                firebaseUser.getIdTokenResult(true),
                ROLE_VERIFICATION_TIMEOUT_MS,
                "Role verification timed out.",
              );
              const claimedRole = tokenResult.claims.role;
              if (claimedRole === "admin" && tokenResult.claims.admin !== true) {
                throw Object.assign(new Error("Your administrator access is not synchronized. Sign in again or ask an administrator to synchronize trusted Auth claims."), { name: "RoleClaimsMissingError" });
              }

              if (
                claimedRole === "passenger" ||
                claimedRole === "driver" ||
                claimedRole === "admin"
              ) {
                if (!isCurrentAuth()) return;
                window.localStorage.setItem(`eki:role:${firebaseUser.uid}`, claimedRole);
                setUser({
                  uid: firebaseUser.uid,
                  email: firebaseUser.email,
                  displayName: firebaseUser.displayName,
                  photoURL: firebaseUser.photoURL,
                  role: claimedRole,
                  isAnonymous: firebaseUser.isAnonymous,
                });
                notifyAuthReady();
                return;
              }

              // Legacy/new accounts without a custom role claim fall back to
              // Firestore so their user profile can be read. Profile creation
              // is server-authoritative (POST /api/users/bootstrap).
              const [{ getFirestore, doc, getDoc }, { firebaseApp }] =
                await Promise.all([
                  import("firebase/firestore"),
                  import("@/lib/firebaseCore"),
                ]).then(([firestore, core]) => [firestore, core] as const);
              const db = getFirestore(firebaseApp);
              if (!isCurrentAuth()) return;
              const userDocRef = doc(db, "users", firebaseUser.uid);
              const userSnap = await withTimeout(
                getDoc(userDocRef),
                ROLE_VERIFICATION_TIMEOUT_MS,
                "Role verification timed out.",
              );

              if (!isCurrentAuth()) return;

              let role: UserRole = userSnap.exists()
                ? (userSnap.data()?.role as UserRole) ?? "passenger"
                : "passenger";

              // A missing token claim is repaired through the authenticated
              // backend even when the Firestore profile already exists. The
              // backend may issue only the least-privileged passenger claim;
              // driver/admin authorization remains assignment-controlled.
              try {
                const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
                const idToken = await firebaseUser.getIdToken();
                if (backendUrl) {
                  const result = await apiRequest<{ role?: string; claimsUpdated?: boolean }>("/api/users/bootstrap", {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${idToken}`,
                    },
                    fallbackError: "Unable to bootstrap user profile.",
                  });
                  if (
                    result.role === "passenger" ||
                    result.role === "driver" ||
                    result.role === "admin"
                  ) {
                    role = result.role;
                  }
                  if (result.claimsUpdated === true) {
                    await firebaseUser.getIdToken(true);
                  }
                }
              } catch (dbErr) {
                console.error("Failed to synchronize user profile role:", dbErr);
              }

              if (!isCurrentAuth()) return;
              if (role === "admin" || role === "driver") {
                const trusted = await withTimeout(firebaseUser.getIdTokenResult(true), ROLE_VERIFICATION_TIMEOUT_MS, "Role verification timed out.");
                if (!isCurrentAuth()) return;
                if (trusted.claims.role !== role || (role === "admin" && trusted.claims.admin !== true)) {
                  throw Object.assign(new Error("Your administrator or driver profile is waiting for trusted Auth claim synchronization. Sign in again after an administrator synchronizes access."), { name: "RoleClaimsMissingError" });
                }
              }
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
              notifyAuthReady();
            } catch (err) {
              if (err instanceof Error && err.name === "AppCheckVerificationError") {
                // Do not publish an authenticated user when App Check failed;
                // otherwise every protected Firestore listener immediately
                // retries and surfaces a misleading permission-denied error.
                if (!isCurrentAuth()) return;
                setUser(null);
                setRoleError("Security verification is unavailable. Check App Check configuration and try again.");
                return;
              }
              if (err instanceof Error && err.name === "RoleClaimsMissingError") {
                if (!isCurrentAuth()) return;
                setUser(null); setRoleError(err.message); return;
              }
              const code = (err as { code?: string })?.code;
              if (code === "permission-denied") {
                console.warn("[Auth] Firestore role document read permission denied");
              } else {
                console.error("Firebase role verification failed:", err);
              }
              if (!isCurrentAuth()) return;
              setRoleError(
                code === "permission-denied"
                  ? "Your account is not permitted to verify this workspace."
                  : "We could not verify your access. Check your connection and try again.",
              );
              setUser(null);
            } finally {
              if (isCurrentAuth()) setLoading(false);
            }
          } else {
            if (currentGen !== generation) return;
            setUser(null);
            setRoleError(null);
            setLoading(false);
            notifyAuthReady();
          }
        };
        refreshVerification.current = () => verifyUser(auth.currentUser, true);
        unsubscribe = authModule.onAuthStateChanged(auth, firebaseUser => verifyUser(firebaseUser));
        setLoginReady(true);

        // Complete a full-page OAuth fallback if the prior page redirected here.
        void authModule.getRedirectResult(auth).then((result) => {
          if (result?.user && !disposed) {
            setLoginError(null);
            setLoginFallbackAvailable(false);
          }
        }).catch((error: unknown) => {
          if (disposed) return;
          const code = authErrorCode(error);
          console.error("[Auth] Google redirect sign-in failed.", code);
          setLoginError(loginErrorMessage(code));
          setLoginFallbackAvailable(false);
        });
      })
      .catch((error) => {
        const code = authErrorCode(error);
        console.error("[Auth] Firebase auth initialization failed.", code);
        clearTimeout(authTimeout);
        if (!disposed) {
          loginDependencies.current = null;
          setLoginReady(false);
          setLoginError("Google sign-in could not initialize. Reload the page and try again.");
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
      refreshVerification.current = null;
      clearTimeout(authTimeout);
      unsubscribe();
    };
  }, []);

  const refreshAccess = useCallback((): Promise<void> => {
    if (refreshFlight.current) return refreshFlight.current;
    if (!refreshVerification.current) {
      setRoleError("Sign-in has not initialized. Reload the page and try again.");
      return Promise.resolve();
    }
    const flight = refreshVerification.current().finally(() => {
      if (refreshFlight.current === flight) refreshFlight.current = null;
    });
    refreshFlight.current = flight;
    return flight;
  }, []);

  const loginWithGoogle = useCallback(async () => {
    const dependencies = loginDependencies.current;
    if (!dependencies) {
      console.error("Google sign-in is unavailable because Firebase Auth is not initialized.");
      setLoginError("Google sign-in is still initializing. Reload the page and try again.");
      return;
    }

    setLoginError(null);
    setLoginFallbackAvailable(false);
    setLoginLoading(true);
    let showRedirectFallback = false;
    const fallbackTimer = window.setTimeout(() => {
      showRedirectFallback = true;
      setLoginError("Google sign-in is taking longer than usual.");
      setLoginFallbackAvailable(true);
    }, 8_000);
    try {
      // Do not await module loading before this call: browsers may block a
      // popup that is no longer directly associated with the user's click.
      await dependencies.signInWithPopup(dependencies.auth, dependencies.googleProvider);
      showRedirectFallback = false;
      setLoginError(null);
      setLoginFallbackAvailable(false);
    } catch (error: unknown) {
      const code = authErrorCode(error);
      if (
        code !== "auth/cancelled-popup-request" &&
        code !== "auth/popup-closed-by-user"
      ) {
        console.error("[Auth] Google popup sign-in failed.", code);
        setLoginError(loginErrorMessage(code));
        showRedirectFallback = canUseRedirectFallback(code);
        setLoginFallbackAvailable(showRedirectFallback);
      }
    } finally {
      window.clearTimeout(fallbackTimer);
      setLoginLoading(false);
      if (!showRedirectFallback) setLoginFallbackAvailable(false);
    }
  }, []);

  const loginWithGoogleRedirect = useCallback(async () => {
    const dependencies = loginDependencies.current;
    if (!dependencies) {
      setLoginError("Google sign-in is still initializing. Reload the page and try again.");
      return;
    }
    setLoginError(null);
    setLoginFallbackAvailable(false);
    setLoginLoading(true);
    try {
      await dependencies.signInWithRedirect(dependencies.auth, dependencies.googleProvider);
    } catch (error: unknown) {
      const code = authErrorCode(error);
      console.error("[Auth] Google full-page sign-in failed.", code);
      setLoginError(loginErrorMessage(code));
      setLoginLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    let logoutGeneration: number | null = null;
    try {
      const [{ signOut }, { auth }] = await Promise.all([
        import("firebase/auth"),
        import("@/lib/firebaseAuth"),
      ]);
      const signedOutUid = auth.currentUser?.uid;
      beginAuthVerification();
      logoutGeneration = getAuthVerificationGeneration();
      setUser(null);
      setLoading(true);
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
    } catch (error) {
      console.error("Logout failed:", error);
      if (logoutGeneration !== null && logoutGeneration === getAuthVerificationGeneration()) {
        setLoading(false);
        setRoleError("Sign-out could not complete. Reload the page and try again.");
      }
    }
  }, []);

  return {
    user,
    loading,
    roleError,
    loginReady,
    loginError,
    loginFallbackAvailable,
    loginLoading,
    loginWithGoogle,
    loginWithGoogleRedirect,
    logout,
    refreshAccess,
  };
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
