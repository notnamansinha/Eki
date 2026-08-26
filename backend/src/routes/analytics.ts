import { Router } from "express";
import { db } from "../lib/firebaseAdmin";
import { requireAdmin } from "../middleware/requireAdmin";
import { countRidesByDirection } from "../lib/rideDirection";

const router = Router();

// Retrieve fleet statistics — admin only (reads Firestore bus_locations collection)
router.get("/fleet", requireAdmin, async (_req, res) => {
  try {
    // Get persistent bus count from Firestore
    const [busSnapshot, completedTrips] = await Promise.all([
      db.collection("bus_locations").limit(1_000).get(),
      db.collection("completed_trips").limit(1_000).get(),
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

    res.json({
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
    });
  } catch (err) {
    console.error("Failed to fetch fleet analytics from Firestore:", err);
    res.status(500).json({ error: "Failed to retrieve fleet analytics" });
  }
});

export default router;
