"use client";

import { useEffect, useState, useCallback, useLayoutEffect } from "react";
import { auth, googleProvider, rtdb, db } from "@/lib/firebase";
import { signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import { ref, set } from "firebase/database";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { notifyAuthReady } from "@/lib/authState";

export type UserRole = "passenger" | "driver" | "admin" | null;

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: UserRole;
}

// ── Auth cache (localStorage) ─────────────────────────────────────────────────
// Persists the resolved user so returning visitors get their UI instantly
// without waiting for Firebase cold-boot. Firebase still validates in the
// background and updates the role if it changed.
const CACHE_KEY = "eki_auth_cache";

function readCache(): AppUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AppUser;
  } catch {
    return null;
  }
}

function writeCache(user: AppUser) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(user));
  } catch {
    // Storage quota exceeded or private-browsing — silent fail
  }
}

function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {}
}

// ── Hook ───────────────────────────────────────────────────────────────────────
export function useAuth() {
  // Always initialize to null/true to ensure client hydration matches SSR.
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loginLoading, setLoginLoading] = useState(false);

  // useLayoutEffect runs synchronously immediately after React has performed all DOM mutations
  // during the initial render, before the browser has a chance to paint. This completely
  // eliminates the "flash of loading state" while keeping hydration perfectly matched.
  const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

  useIsomorphicLayoutEffect(() => {
    const cached = readCache();
    if (cached) {
      setUser(cached);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Hard safety-net: never show spinner > 6 s even if everything fails
    const timeout = setTimeout(() => setLoading(false), 6000);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Signal to Firestore hooks that auth has resolved (ends their wait)
      notifyAuthReady();

      if (firebaseUser) {
        // Always show the user instantly with cached/optimistic role so the UI
        // unblocks immediately. Firestore fetch refines the role afterwards.
        const cached = readCache();
        const optimisticRole: UserRole =
          cached?.uid === firebaseUser.uid ? cached.role : "passenger";

        const optimisticUser: AppUser = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
          role: optimisticRole,
        };

        setUser(optimisticUser);
        // Unblock the UI immediately — role may update silently below
        setLoading(false);
        clearTimeout(timeout);

        // ── Background: fetch true role from Firestore ────────────────────
        // We do NOT await this before unblocking the UI. It updates silently.
        (async () => {
          try {
            const userDocRef = doc(db, "users", firebaseUser.uid);

            const fetchWithTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
              new Promise((resolve, reject) => {
                const t = setTimeout(() => reject(new Error("timeout")), ms);
                promise.then(
                  (v) => { clearTimeout(t); resolve(v); },
                  (e) => { clearTimeout(t); reject(e); }
                );
              });

            let role: UserRole = optimisticRole;

            const userSnap = await fetchWithTimeout(getDoc(userDocRef), 3000);

            if (userSnap.exists()) {
              role = (userSnap.data()?.role as UserRole) ?? "passenger";
            } else {
              // First login — write the user document
              role = "passenger";
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
                const userDbRef = ref(rtdb, `users/${firebaseUser.uid}`);
                await set(userDbRef, userData);
              } catch (dbErr) {
                console.error("Failed to write new user:", dbErr);
              }
            }

            // Update user with true role and persist to cache
            const resolvedUser: AppUser = {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              displayName: firebaseUser.displayName,
              photoURL: firebaseUser.photoURL,
              role,
            };
            setUser(resolvedUser);
            writeCache(resolvedUser);
          } catch (err) {
            // Firestore failed/timed out — keep optimistic user, still functional
            console.warn("Firestore role fetch failed:", err);
            writeCache(optimisticUser);
          }
        })();
      } else {
        // Signed out — clear everything
        clearCache();
        setUser(null);
        setLoading(false);
        clearTimeout(timeout);
      }
    });

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const loginWithGoogle = useCallback(async () => {
    setLoginLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      // onAuthStateChanged will handle setting the user state
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
      clearCache();
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }, []);

  return { user, loading, loginLoading, loginWithGoogle, logout };
}
