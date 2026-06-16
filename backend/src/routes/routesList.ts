import { Router, Request, Response } from "express";
import { db } from "../lib/firebaseAdmin";

const router = Router();

/**
 * GET /api/routes-list
 *
 * Returns all BRTS routes with their stops for the frontend planner dropdowns.
 * Data comes from Firestore cache — no Google API calls.
 *
 * RUNTIME COST: $0 (Firestore read, 1 req per page load)
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const snapshot = await db.collection("routes").get();
    const routes = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name ?? doc.id,
        color: data.color ?? "#3b82f6",
        stops: data.stops ?? [],
        // Omit polyline — that's only returned by /api/plan
      };
    });
    res.json({ routes });
  } catch (err) {
    console.error("❌ /api/routes-list error:", err);
    res.status(500).json({ error: "Failed to fetch routes" });
  }
});

export default router;
