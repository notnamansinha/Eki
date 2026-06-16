import { Router } from "express";
import { db } from "../lib/firebaseAdmin";

const router = Router();

// Retrieve fleet statistics from Firestore (persistent) + in-memory active state
router.get("/fleet", async (_req, res) => {
  try {
    // Get persistent bus count from Firestore
    const busSnapshot = await db.collection("bus_locations").get();
    let activeCount = 0;
    let idleCount = 0;
    let maintenanceCount = 0;

    busSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.status === "active") activeCount++;
      else if (data.status === "idle") idleCount++;
      else if (data.status === "maintenance") maintenanceCount++;
    });

    res.json({
      totalBuses: busSnapshot.size,
      activeBuses: activeCount,
      idleBuses: idleCount,
      maintenanceBuses: maintenanceCount,
      ongoingTrips: activeCount,
      passengerCount: null, // Requires a dedicated analytics collection
    });
  } catch (err) {
    console.error("Failed to fetch fleet analytics from Firestore:", err);
    res.status(500).json({ error: "Failed to retrieve fleet analytics" });
  }
});

// Retrieve aggregated trip analytics graph data
router.get("/trips", (_req, res) => {
  // Returns empty until a trips collection is implemented
  res.json({ trips: [] });
});

// Retrieve aggregated feedback table
router.get("/feedback", (_req, res) => {
  // Returns empty until a feedback collection is implemented
  res.json({ feedback: [] });
});

export default router;
