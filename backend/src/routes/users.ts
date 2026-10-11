import { Router, type Request, type Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/requireAuth";
import { auth, db } from "../lib/firebaseAdmin";

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

async function ensurePassengerRoleClaim(uid: string): Promise<{
  role: "passenger" | "driver" | "admin";
  claimsUpdated: boolean;
}> {
  const user = await auth.getUser(uid);
  const existingClaims = user.customClaims ?? {};
  // A profile can lag the fleet/admin claim update. Bootstrap must not undo
  // current privileged Auth state based only on that stale profile. Revocation
  // and demotion belong to the dedicated authorization workflow.
  if (existingClaims.admin === true || existingClaims.role === "admin" || existingClaims.role === "driver") {
    return {
      role: existingClaims.admin === true || existingClaims.role === "admin" ? "admin" : "driver",
      claimsUpdated: false,
    };
  }
  const alreadySynchronized =
    existingClaims.role === "passenger" &&
    existingClaims.admin === undefined &&
    existingClaims.driverId === undefined &&
    existingClaims.assignedBusId === undefined;
  if (alreadySynchronized) return { role: "passenger", claimsUpdated: false };

  const passengerClaims = { ...existingClaims };
  delete passengerClaims.admin;
  delete passengerClaims.driverId;
  delete passengerClaims.assignedBusId;
  passengerClaims.role = "passenger";

  await auth.setCustomUserClaims(uid, passengerClaims);
  return { role: "passenger", claimsUpdated: true };
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

    // Only the least-privileged role is repaired here. Driver/admin claims
    // require the dedicated fleet authorization workflow and its assignment
    // validation; a profile bootstrap must never manufacture those claims.
    const synchronized = result.role === "passenger"
      ? await ensurePassengerRoleClaim(uid)
      : { role: result.role, claimsUpdated: false };

    res.setHeader("Cache-Control", "no-store");
    res.status(result.created ? 201 : 200).json({
      role: synchronized.role,
      ...(synchronized.claimsUpdated ? { claimsUpdated: true } : {}),
    });
  } catch (error) {
    console.error("[Users] Failed to bootstrap profile:", error);
    res.status(500).json({ error: "Unable to bootstrap profile." });
  }
});

export default router;
