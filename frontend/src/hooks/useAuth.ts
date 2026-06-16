"use client";

import { useEffect, useState } from "react";
import { auth, googleProvider, rtdb, db } from "@/lib/firebase";
import { signInWithPopup, onAuthStateChanged, User, signOut } from "firebase/auth";
import { ref, set } from "firebase/database";
import { doc, getDoc, setDoc, DocumentSnapshot } from "firebase/firestore";

export type UserRole = "passenger" | "driver" | "admin" | null;

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: UserRole;
}

export function useAuth() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Safety net: force loading to false if Firebase auth takes too long (e.g. offline)
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 8000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Optimistically set the user so Name/PFP renders instantly from local cache
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
          role: "passenger", // Fallback until fetched
        });

        try {
          // 1. SOURCE OF TRUTH: FIRESTORE
          const userDocRef = doc(db, "users", firebaseUser.uid);

          // Wrap getDoc in a timeout so the loading screen can never hang forever
          const getDocWithTimeout = (ms: number): Promise<DocumentSnapshot> =>
            new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error("Firestore timeout")), ms);
              getDoc(userDocRef)
                .then((snap) => { clearTimeout(timer); resolve(snap); })
                .catch((err) => { clearTimeout(timer); reject(err); });
            });

          let role: UserRole = "passenger";

          try {
            const userSnapshot = await getDocWithTimeout(5000);

            if (userSnapshot && userSnapshot.exists()) {
              role = (userSnapshot.data()?.role as UserRole) ?? "passenger";
            } else {
              // First time login - Force user to be passenger
              role = "passenger";
              
              const userData = {
                uid: firebaseUser.uid,
                email: firebaseUser.email || "",
                displayName: firebaseUser.displayName || "Unknown User",
                photoURL: firebaseUser.photoURL || "",
                role,
                createdAt: Date.now()
              };

              try {
                // Write to Firestore (Source of truth for Roles & Admin Panel)
                await setDoc(userDocRef, userData);
                
                // Write to RTDB (mirror)
                const userDbRef = ref(rtdb, `users/${firebaseUser.uid}`);
                await set(userDbRef, userData);
                
                console.log("Successfully recorded user in Firestore and RTDB!");
              } catch (dbErr) {
                console.error("CRITICAL ERROR: Failed to write user. Check rules...", dbErr);
              }
            }
          } catch (firestoreErr) {
            // Firestore timed out or threw — still let the user in with their cached auth
            console.warn("Firestore role fetch failed or timed out, defaulting to passenger:", firestoreErr);
            role = "passenger";
          }

          // Update user state with the TRUE role now that Firestore has responded
          setUser((prev) => prev ? { ...prev, role } : {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            role,
          });
          
          // CRITICAL: Unblock full UI dependencies
          setLoading(false);

          // ARCH-06 fix: removed Firebase Storage credential backup.
          // The Firestore `users` document is the single source of truth.
          // Uploading credential.json on every login was:
          //   1. Redundant data (already in Firestore)
          //   2. PII storage without a data-retention policy
          //   3. Additional auth-path latency

        } catch (err) {
          console.error("Error in auth state handler:", err);
          setUser(null);
          setLoading(false);
        }
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return { user, loading, loginWithGoogle, logout };
}
