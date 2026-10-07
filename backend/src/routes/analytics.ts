import { Filter } from "firebase-admin/firestore";
import { apiReadFailure, createApiReadCache } from "../services/apiReadCache";
import { Router } from "express";
import { db } from "../lib/firebaseAdmin";
import { requireAdmin } from "../middleware/requireAdmin";
import { countRidesByDirection } from "../lib/rideDirection";

const router = Router();
export const analyticsCache = createApiReadCache<unknown>("fleetAnalytics", 10000, 2);

// Retrieve fleet statistics — admin only (reads Firestore bus_locations collection)
router.get("/fleet", requireAdmin, async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (Object.keys(req.query).some(key => key !== "scope") || (req.query.scope !== undefined && req.query.scope !== "all")) {
    res.status(400).json({ error: "Invalid analytics scope." }); return;
  }
  try {
    const scope = req.query.scope === "all" ? "all" : "sample";
    const result = await analyticsCache.read(scope, async () => {
      if (scope === "all") {
        // Read-only aggregation is idempotent: no counters or retry-sensitive writes.
        // One consistent transaction prevents cross-query double counts during edits.
        return db.runTransaction(async transaction => {
          const fleet = db.collection("bus_locations"); const trips = db.collection("completed_trips");
          const queries = [fleet, fleet.where("status", "==", "active"),
            fleet.where(Filter.or(Filter.where("deviceState", "==", "offline"), Filter.where("motionState", "==", "uncertain"))),
            trips, trips.where("direction", "==", "forward"), trips.where("direction", "==", "reverse")];
          const [total, active, lost, completed, forward, reverse] = await Promise.all(queries.map(async query => (await transaction.get(query.count())).data().count));
          return { totalBuses: total, activeBuses: active, idleBuses: total - active, signalLostBuses: lost, ongoingTrips: active,
            passengerCount: null, completedTripsByDirection: { forward, reverse, unresolved: completed - forward - reverse, total: completed, sampleLimit: null },
            statistics: { sampled: false, sampleLimit: null, generatedAt: new Date().toISOString() } };
        }, { readOnly: true });
      }
      // Get persistent bus count from Firestore
      const [busSnapshot, completedTrips] = await Promise.all([
        db.collection("bus_locations").select("deviceState", "motionState", "status").limit(1_000).get(),
        db.collection("completed_trips").select("direction").limit(1_000).get(),
      ]);
      let activeCount = 0;
      let idleCount = 0;
      let signalLostCount = 0;

      busSnapshot.forEach((doc) => {
        const data = doc.data();
        if (
          data.deviceState === "offline" ||
          data.motionState === "uncertain"
        ) signalLostCount++;
        if (data.status === "active") activeCount++;
        else idleCount++;
      });

      const directionalTrips = countRidesByDirection(
        completedTrips.docs.map((doc) => doc.data()),
      );

      return {
        totalBuses: busSnapshot.size,
        activeBuses: activeCount,
        idleBuses: idleCount,
        signalLostBuses: signalLostCount,
        ongoingTrips: activeCount,
        passengerCount: null, // Requires a dedicated analytics collection
        completedTripsByDirection: {
          ...directionalTrips,
          sampleLimit: 1_000,
        },
        statistics: { sampled: true, sampleLimit: 1000, generatedAt: new Date().toISOString() },
      };
    });
    res.json(result);
  } catch (err) {
    console.error("Failed to fetch fleet analytics from Firestore:", err);
    apiReadFailure(res, err, "Failed to retrieve fleet analytics");
  }
});

export default router;
