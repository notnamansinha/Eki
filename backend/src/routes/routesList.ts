import { Router, type Request, type Response } from "express";
import { FieldPath } from "firebase-admin/firestore";
import { db } from "../lib/firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { apiReadFailure, routeListCache } from "../services/apiReadCache";

const router = Router();
export const routesCollectionRoutes = Router();
/** Compact authenticated catalogs; cached server reads still incur Firestore costs. */
const listRoutes = async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  const { limit, after } = req.query;
  if (Object.keys(req.query).some(key => key !== "limit" && key !== "after") ||
      (limit !== undefined && (typeof limit !== "string" || !/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 250)) ||
      (after !== undefined && (typeof after !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(after)))) {
    res.status(400).json({ error: "Invalid catalog page." }); return;
  }
  const pageSize = limit === undefined ? 250 : Number(limit);
  const paged = limit !== undefined || after !== undefined;
  try {
    const result = await routeListCache.read(`${pageSize}:${after ?? ""}:${paged}`, async () => {
      let query = db.collection("routes").select("name", "color", "stops").orderBy(FieldPath.documentId());
      if (after !== undefined) query = query.startAfter(after);
      const snapshot = await query.limit(pageSize + (paged ? 1 : 0)).get();
      const rows = snapshot.docs.slice(0, pageSize);
      const routes = rows.map(doc => { const data = doc.data(); return {
        id: doc.id, name: data.name ?? doc.id, color: data.color ?? "#3b82f6", stops: data.stops ?? [],
      }; });
      return { routes, ...(paged ? { nextCursor: snapshot.docs.length > pageSize ? rows.at(-1)!.id : null } : {}) };
    });
    res.json(result);
  } catch (error) { apiReadFailure(res, error, "Failed to fetch routes"); }
};
router.get("/", requireAuth, listRoutes);
routesCollectionRoutes.get("/", requireAuth, listRoutes);
export default router;
