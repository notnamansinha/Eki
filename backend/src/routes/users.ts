import { Router, type Request, type Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/requireAuth";
import { db } from "../lib/firebaseAdmin";

const router = Router();

type AuthenticatedRequest = Request & {
  user?: {
    uid: string;
    role?: string;
    name?: string;
    email?: string;
    picture?: string;
  };
};

function cleanClaim(value: unknown, maximumLength: number, fallback = ""): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximumLength)
    : fallback;
}

/**
 * POST /api/users/bootstrap
 *
 * Creates a passenger profile from verified ID-token claims. The transaction
 * never overwrites an existing profile or role, including concurrent retries.
 */
router.post("/bootstrap", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    if (typeof uid !== "string") {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const userRef = db.collection("users").doc(uid);
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);
      if (snapshot.exists) {
        const existingRole = snapshot.data()?.role;
        const role = existingRole === "driver" || existingRole === "admin"
          ? existingRole
          : "passenger";
        return { role, created: false };
      }

      transaction.create(userRef, {
        uid,
        email: cleanClaim(req.user?.email, 320),
        displayName: cleanClaim(req.user?.name, 100, "Unknown User"),
        photoURL: cleanClaim(req.user?.picture, 2048),
        role: "passenger",
        createdAt: FieldValue.serverTimestamp(),
      });
      return { role: "passenger", created: true };
    });

    res.setHeader("Cache-Control", "no-store");
    res.status(result.created ? 201 : 200).json({ role: result.role });
  } catch (error) {
    console.error("[Users] Failed to bootstrap profile:", error);
    res.status(500).json({ error: "Unable to bootstrap profile." });
  }
});

export default router;
