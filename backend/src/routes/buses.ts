import { apiReadFailure, createApiReadCache } from "../services/apiReadCache";
import { Router } from "express";
import { rtdb } from "../lib/firebaseAdmin";
import { singleRouteParam } from "../lib/requestParams";
import { publicLiveBus } from "../services/liveBusProjection";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();
const liveReads = createApiReadCache<unknown>("liveBuses", 1000);
const busReads = createApiReadCache<unknown>("busLookup", 0);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

// Live coordinates and lifecycle are read-only here. Device telemetry,
// ordered-stop progression, and completion have dedicated authoritative paths.
router.get("/", requireAuth, async (req, res) => {
  res.set("Cache-Control", "no-store");
  const { routeId, limit, after } = req.query;
  if (Object.keys(req.query).some(key => !["routeId", "limit", "after"].includes(key)) ||
      (routeId !== undefined && (typeof routeId !== "string" || !SAFE_ID.test(routeId))) ||
      (after !== undefined && (typeof after !== "string" || !SAFE_ID.test(after))) ||
      (limit !== undefined && (typeof limit !== "string" || !/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 250))) {
    res.status(400).json({ error: "Invalid bus page." }); return;
  }
  const paged = Object.keys(req.query).length > 0;
  const pageSize = limit === undefined ? 250 : Number(limit);
  try {
    const result = await liveReads.read(`${routeId ?? ""}:${after ?? ""}:${pageSize}:${paged}`, async () => {
      const source = rtdb.ref("activeBuses");
      let query: import("firebase-admin/database").Query = source;
      if (paged) {
        query = routeId === undefined ? source.orderByKey() : source.orderByChild("routeId").endAt(routeId);
        if (after !== undefined) query = routeId === undefined ? query.startAfter(after) : query.startAfter(routeId, after);
        else if (routeId !== undefined) query = query.startAt(routeId);
        query = query.limitToFirst(pageSize + 1);
      }
      const snapshot = await query.once("value");
      if (!paged) return { buses: Object.values(snapshot.val() || {}).map(publicLiveBus).filter(Boolean) };
      const rows: import("firebase-admin/database").DataSnapshot[] = [];
      snapshot.forEach(child => { rows.push(child); });
      return { buses: rows.slice(0, pageSize).map(child => publicLiveBus(child.val())).filter(Boolean), nextCursor: rows.length > pageSize ? rows[pageSize - 1].key : null };
    });
    res.json(result);
  } catch (error) { apiReadFailure(res, error, "Failed to fetch active buses"); }
});

router.get("/:busId", requireAuth, async (req, res) => {
  res.set("Cache-Control", "no-store");
  const busId = singleRouteParam(req.params.busId);
  if (busId === null || !SAFE_ID.test(busId)) {
    res.status(400).json({ error: "Invalid busId" });
    return;
  }

  try {
    const data = await busReads.read(busId, async () => {
      const snapshot = await rtdb.ref("activeBuses").orderByChild("busId").equalTo(busId).limitToFirst(1).once("value");
      return publicLiveBus(Object.values(snapshot.val() || {})[0]) ?? null;
    });
    if (!data) { res.status(404).json({ error: "Bus not found or inactive" }); return; }
    res.json(data);
  } catch (error) { apiReadFailure(res, error, "Failed to fetch bus"); }
});

export default router;
