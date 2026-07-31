import { Router, type Request, type Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/requireAuth";
import { db } from "../lib/firebaseAdmin";

type AuthenticatedRequest = Request & {
  user?: { uid: string; role?: string };
};

const router = Router();

router.post("/deletion-request", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user?.uid || req.user.role !== "passenger") {
    res.status(409).json({
      error: "Operator and administrator accounts must be offboarded by university IT.",
    });
    return;
  }
  try {
    await db.collection("_privacy_deletion_requests").doc(req.user.uid).set({
      status: "pending",
      attempts: 0,
      requestedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.status(202).json({ accepted: true });
  } catch (error) {
    console.error("[Privacy] Failed to queue deletion request:", error);
    res.status(500).json({ error: "Unable to queue the deletion request." });
  }
});

export default router;

