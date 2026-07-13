import { Router } from "express";
import { db } from "../lib/firebaseAdmin";
import { requireAdmin } from "../middleware/requireAdmin";

const router = Router();

// Retrieve fleet statistics — admin only (reads Firestore bus_locations collection)
router.get("/fleet", requireAdmin, async (_req, res) => {
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

export default router;
