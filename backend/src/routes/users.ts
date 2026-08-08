import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { db } from "../lib/firebaseAdmin";

const router = Router();

type AuthenticatedRequest = Request & {
  user?: {
    uid: string;
    role?: string;
    driverId?: string;
    assignedBusId?: string;
    admin?: boolean;
  };
};

/**
 * POST /api/users/bootstrap
 *
 * Server-authoritative user profile bootstrap. New/legacy accounts without a
 * custom role claim previously wrote their own `users/{uid}` doc from the
 * client. The backend now creates the profile; the client only reads.
 * The profile is always created as role "passenger" — the same invariant the
 * old rules enforced — and never overwrites an existing profile.
 */
router.post("/bootstrap", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    if (typeof uid !== "string") {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const { displayName, email, photoURL } = req.body ?? {};
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();

    let role = "passenger";
    if (userSnap.exists) {
      const existing = userSnap.data()?.role;
      role = existing === "driver" || existing === "admin" ? existing : "passenger";
    } else {
      await userRef.set({
        uid,
        email: typeof email === "string" ? email.slice(0, 320) : "",
        displayName: typeof displayName === "string" ? displayName.slice(0, 100) : "Unknown User",
        photoURL: typeof photoURL === "string" ? photoURL.slice(0, 2048) : "",
        role,
        createdAt: Date.now(),
      });
    }

    res.status(201).json({ role });
  } catch (error) {
    console.error("[Users] Failed to bootstrap profile:", error);
    res.status(500).json({ error: "Unable to bootstrap profile." });
  }
});

export default router;
