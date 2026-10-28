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
import { consumeGoogleRedirectPending, markGoogleRedirectPending, prefersGoogleRedirect } from "@/lib/googleSignInFlow";

const ROLE_VERIFICATION_TIMEOUT_MS = 10_000;
const AUTH_STILL_RESTORING_MESSAGE = "Sign-in is still restoring. Reload the page to try again.";
const ACCESS_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

function transientAccessFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "auth/network-request-failed" || code === "unavailable" ||
    code === "deadline-exceeded" ||
    (error instanceof Error && error.message === "Role verification timed out.");
}

// Role hints and workspace memory are conveniences. Blocked or full browser
// storage must never deny a verified account or skip sign-out cache cleanup.
function writeStorage(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* Storage can be unavailable. */ }
}

function removeStorage(key: string): void {
  try { window.localStorage.removeItem(key); } catch { /* Storage can be unavailable. */ }
}

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
  const signingOut = useRef(false);
  // Until Firebase reports its first auth state (or settles a redirect result),
  // auth.currentUser === null means "unknown", not "signed out".
  const authInitialized = useRef(false);
  const loginAttempt = useRef(0);
  const invalidateLoginAttempt = useCallback(() => { loginAttempt.current++; }, []);
  const loginDependencies = useRef<FirebaseLoginDependencies | null>(null);
  const refreshVerification = useRef<null | ((onlyIfNeeded?: boolean) => Promise<void>)>(null);

  useEffect(() => {
    let generation = 0;
    let disposed = false;
    let unsubscribe = () => {};
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;
    let verifiedUser: import("firebase/auth").User | null = null;
    let verifiedGeneration = -1;
    let recoverAccess: (() => void) | null = null;
    authInitialized.current = false;
    const clearRecovery = () => {
      clearTimeout(retryTimer);
      retryTimer = undefined;
      recoverAccess = null;
    };
    // Only a failed transient verification may trigger recovery. Healthy tab
    // switches never revoke access or force another token/network request.
    const resumeAccess = () => {
      if (navigator.onLine !== false && document.visibilityState !== "hidden") {
        retryAttempt = 0;
        recoverAccess?.();
      }
    };
    window.addEventListener("online", resumeAccess);
    document.addEventListener("visibilitychange", resumeAccess);
    // signInWithRedirect never settles in the document that navigates away.
    // When Back restores that frozen page from the back/forward cache, the
    // OAuth attempt is over: re-enable sign-in instead of a stuck spinner.
    const resumeFromHistory = (event: PageTransitionEvent) => {
      if (!event.persisted || disposed) return;
      const wasRedirecting = consumeGoogleRedirectPending();
      invalidateLoginAttempt();
      setLoginLoading(false);
      if (wasRedirecting && !loginDependencies.current?.auth.currentUser) {
        // The user deliberately backed out; leave a clean, enabled button.
        setLoginError(null);
        setLoginFallbackAvailable(false);
      }
    };
    window.addEventListener("pageshow", resumeFromHistory);
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

        const verifyUser = async (firebaseUser: import("firebase/auth").User | null) => {
          clearRecovery();
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

            const isCurrentAuth = () =>
              !disposed &&
              currentGen === generation &&
              verificationGeneration === getAuthVerificationGeneration() &&
              auth.currentUser?.uid === firebaseUser.uid;
            setRoleError(null);

            try {
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
                writeStorage(`eki:role:${firebaseUser.uid}`, claimedRole);
                setUser({
                  uid: firebaseUser.uid,
                  email: firebaseUser.email,
                  displayName: firebaseUser.displayName,
                  photoURL: firebaseUser.photoURL,
                  role: claimedRole,
                  isAnonymous: firebaseUser.isAnonymous,
                });
                notifyAuthReady();
                verifiedUser = firebaseUser;
                verifiedGeneration = verificationGeneration;
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

              // Unknown legacy profile values fall back to least privilege so
              // they never publish a role no workspace or listener accepts.
              const profileRole: unknown = userSnap.exists() ? userSnap.data()?.role : undefined;
              let role: UserRole =
                profileRole === "driver" || profileRole === "admin" ? profileRole : "passenger";

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
              writeStorage(`eki:role:${firebaseUser.uid}`, role || "passenger");

              setUser({
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                displayName: firebaseUser.displayName,
                photoURL: firebaseUser.photoURL,
                role,
                isAnonymous: firebaseUser.isAnonymous,
              });
              notifyAuthReady();
              verifiedUser = firebaseUser;
              verifiedGeneration = verificationGeneration;
            } catch (err) {
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
              if (transientAccessFailure(err)) {
                recoverAccess = () => {
                  if (!isCurrentAuth() || navigator.onLine === false || document.visibilityState === "hidden") return;
                  void runVerification(firebaseUser);
                };
                const delay = ACCESS_RETRY_DELAYS_MS[retryAttempt++];
                // A bounded retry burst also bounds outstanding SDK work after
                // timeouts (the Firebase promises themselves are not cancelable).
                // Online/visible or an explicit retry starts a fresh burst.
                if (delay !== undefined) retryTimer = setTimeout(() => recoverAccess?.(), delay);
              }
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
        let flight: { user: import("firebase/auth").User | null; generation: number; promise: Promise<void> } | null = null;
        const runVerification = (firebaseUser: import("firebase/auth").User | null): Promise<void> => {
          if (flight?.user === firebaseUser && flight.generation === getAuthVerificationGeneration()) return flight.promise;
          const promise = verifyUser(firebaseUser).finally(() => {
            if (flight?.promise === promise) flight = null;
          });
          flight = { user: firebaseUser, generation: getAuthVerificationGeneration(), promise };
          return promise;
        };
        refreshVerification.current = (onlyIfNeeded = false) => {
          if (onlyIfNeeded && signingOut.current) return Promise.resolve();
          if (onlyIfNeeded && auth.currentUser === verifiedUser &&
              verifiedGeneration === getAuthVerificationGeneration()) return Promise.resolve();
          if (!authInitialized.current) {
            // Never publish a null currentUser as a confirmed sign-out while
            // Firebase is still restoring (e.g. a pending redirect). The first
            // observer callback will verify the real state.
            if (!onlyIfNeeded) {
              setRoleError(AUTH_STILL_RESTORING_MESSAGE);
              setLoading(false);
            }
            return Promise.resolve();
          }
          retryAttempt = 0;
          return runVerification(auth.currentUser);
        };
        unsubscribe = authModule.onAuthStateChanged(auth, firebaseUser => {
          authInitialized.current = true;
          retryAttempt = 0;
          return runVerification(firebaseUser);
        });
        // Complete mobile/PWA sign-in or a desktop full-page fallback.
        // Do not start another OAuth request while Firebase is restoring the
        // redirect session. Both paths share the observer's trusted role checks.
        void authModule.getRedirectResult(auth).then(async (result) => {
          if (disposed) return;
          // getRedirectResult settles only after Firebase initialization.
          authInitialized.current = true;
          const wasRedirecting = consumeGoogleRedirectPending();
          if (result?.user && auth.currentUser?.uid === result.user.uid) {
            await refreshVerification.current?.(true);
          }
          if (disposed) return;
          if (auth.currentUser) {
            setLoginError(null);
            setLoginFallbackAvailable(false);
          } else if (wasRedirecting) {
            setLoginError("Google sign-in did not restore your session. Please try signing in again.");
          }
        }).catch((error: unknown) => {
          if (disposed) return;
          consumeGoogleRedirectPending();
          const code = authErrorCode(error);
          console.error("[Auth] Google redirect sign-in failed.", code);
          setLoginError(loginErrorMessage(code));
          setLoginFallbackAvailable(false);
        }).finally(() => {
          if (!disposed) setLoginReady(true);
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
      invalidateLoginAttempt();
      loginDependencies.current = null;
      clearRecovery();
      window.removeEventListener("online", resumeAccess);
      document.removeEventListener("visibilitychange", resumeAccess);
      window.removeEventListener("pageshow", resumeFromHistory);
      refreshVerification.current = null;
      clearTimeout(authTimeout);
      unsubscribe();
    };
  }, [invalidateLoginAttempt]);

  const refreshAccess = useCallback((): Promise<void> => {
    if (!refreshVerification.current) {
      setRoleError("Sign-in has not initialized. Reload the page and try again.");
      return Promise.resolve();
    }
    return refreshVerification.current();
  }, []);

  const loginWithGoogleRedirect = useCallback(async () => {
    if (signingOut.current) return;
    const dependencies = loginDependencies.current;
    if (!dependencies) {
      setLoginError("Google sign-in is still initializing. Reload the page and try again.");
      return;
    }
    setLoginError(null);
    setLoginFallbackAvailable(false);
    setLoginLoading(true);
    const attempt = ++loginAttempt.current;
    markGoogleRedirectPending();
    try {
      await dependencies.signInWithRedirect(dependencies.auth, dependencies.googleProvider);
    } catch (error: unknown) {
      if (attempt !== loginAttempt.current) return;
      consumeGoogleRedirectPending();
      const code = authErrorCode(error);
      console.error("[Auth] Google full-page sign-in failed.", code);
      setLoginError(loginErrorMessage(code));
      setLoginLoading(false);
    }
  }, []);

  const loginWithGoogle = useCallback(async () => {
    if (signingOut.current) return;
    const dependencies = loginDependencies.current;
    if (!dependencies) {
      console.error("Google sign-in is unavailable because Firebase Auth is not initialized.");
      setLoginError("Google sign-in is still initializing. Reload the page and try again.");
      return;
    }

    if (prefersGoogleRedirect(dependencies.auth.config.authDomain)) {
      return loginWithGoogleRedirect();
    }

    setLoginError(null);
    setLoginFallbackAvailable(false);
    setLoginLoading(true);
    const attempt = ++loginAttempt.current;
    let showRedirectFallback = false;
    const fallbackTimer = window.setTimeout(() => {
      if (attempt !== loginAttempt.current) return;
      showRedirectFallback = true;
      setLoginError("Google sign-in is taking longer than usual.");
      setLoginFallbackAvailable(true);
    }, 8_000);
    try {
      // Do not await module loading before this call: browsers may block a
      // popup that is no longer directly associated with the user's click.
      const result = await dependencies.signInWithPopup(dependencies.auth, dependencies.googleProvider);
      if (attempt !== loginAttempt.current) return;
      // A successful OAuth result must also reach the shared role verifier,
      // including when an existing runtime misses an auth observer update.
      if (result?.user && dependencies.auth.currentUser?.uid === result.user.uid) {
        await refreshVerification.current?.(true);
      }
      if (attempt !== loginAttempt.current) return;
      showRedirectFallback = false;
      setLoginError(null);
      setLoginFallbackAvailable(false);
    } catch (error: unknown) {
      if (attempt !== loginAttempt.current) return;
      const code = authErrorCode(error);
      if (
        code === "auth/cancelled-popup-request" ||
        code === "auth/popup-closed-by-user"
      ) {
        // A deliberate cancellation ends the attempt: drop any slow-popup
        // notice and fallback, matching a cancellation before the timer.
        showRedirectFallback = false;
        setLoginError(null);
      } else {
        console.error("[Auth] Google popup sign-in failed.", code);
        setLoginError(loginErrorMessage(code));
        showRedirectFallback = canUseRedirectFallback(code);
        setLoginFallbackAvailable(showRedirectFallback);
      }
    } finally {
      window.clearTimeout(fallbackTimer);
      if (attempt === loginAttempt.current) {
        setLoginLoading(false);
        if (!showRedirectFallback) setLoginFallbackAvailable(false);
      }
    }
  }, [loginWithGoogleRedirect]);

  const logout = useCallback(async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    invalidateLoginAttempt();
    setLoginLoading(false);
    setLoginError(null);
    setLoginFallbackAvailable(false);
    let logoutGeneration: number | null = null;
    try {
      const [{ signOut }, { auth }] = await Promise.all([
        import("firebase/auth"),
        import("@/lib/firebaseAuth"),
      ]);
      const signedOutUid = auth.currentUser?.uid;
      consumeGoogleRedirectPending();
      beginAuthVerification();
      logoutGeneration = getAuthVerificationGeneration();
      setUser(null);
      if (authInitialized.current) {
        setLoading(true);
      } else {
        // signOut queues behind Firebase restoration; keep actionable guidance
        // visible until the observer reports the signed-out state.
        setRoleError(AUTH_STILL_RESTORING_MESSAGE);
        setLoading(false);
      }
      await signOut(auth);
      // Lazy cache cleanup must not block the next OAuth click after Firebase
      // has confirmed sign-out (those imports can be slow on mobile).
      signingOut.current = false;
      if (signedOutUid) {
        removeStorage(`eki:role:${signedOutUid}`);
      }
      removeStorage("eki:last-workspace");
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
    } finally {
      signingOut.current = false;
    }
  }, [invalidateLoginAttempt]);

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
