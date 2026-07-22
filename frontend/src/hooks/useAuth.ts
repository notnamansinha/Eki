"use client";

import { useEffect, useState, useCallback } from "react";
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

export function useAuth() {
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
          // Firestore and RTDB are only needed after a signed-in session exists.
          // Keeping them out of the unauthenticated route removes their parsing and
          // evaluation cost from first paint.
          const [{ getFirestore, doc, getDoc, setDoc }, { getDatabase, ref, set }, { firebaseApp }] =
            await Promise.all([
              import("firebase/firestore"),
              import("firebase/database"),
              import("@/lib/firebaseCore"),
            ]);
          const db = getFirestore(firebaseApp);
          const rtdb = getDatabase(firebaseApp);
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const userSnap = await getDoc(userDocRef);
          
          if (currentGen !== generation) return;

          let role: UserRole = "passenger";

          if (userSnap.exists()) {
            role = (userSnap.data()?.role as UserRole) ?? "passenger";
            // Backfill RTDB independently to ensure sync
            try {
              const userDbRef = ref(rtdb, `users/${firebaseUser.uid}`);
              await set(userDbRef, {
                uid: firebaseUser.uid,
                email: firebaseUser.email || "",
                displayName: firebaseUser.displayName || "Unknown User",
                photoURL: firebaseUser.photoURL || "",
                role,
                createdAt: userSnap.data()?.createdAt || Date.now(),
              });
            } catch (rtdbErr) {
              console.error("Failed to backfill user to RTDB:", rtdbErr);
            }
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
            try {
              const userDbRef = ref(rtdb, `users/${firebaseUser.uid}`);
              await set(userDbRef, userData);
            } catch (dbErr) {
              console.error("Failed to write new user to RTDB:", dbErr);
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
