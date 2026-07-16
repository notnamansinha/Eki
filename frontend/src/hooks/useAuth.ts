"use client";

import { useEffect, useState, useCallback } from "react";
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
  isAnonymous: boolean;
}

export function useAuth() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    let generation = 0;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const currentGen = ++generation;
      notifyAuthReady();

      if (firebaseUser) {
        try {
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

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = useCallback(async () => {
    setLoginLoading(true);
    try {
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
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }, []);

  return { user, loading, loginLoading, loginWithGoogle, logout };
}
