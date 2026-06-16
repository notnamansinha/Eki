/**
 * patch-stops.ts
 *
 * One-time script to add the `stops` field to existing Firestore route documents.
 * 
 * Run with:
 *   cd backend
 *   npx ts-node -e "require('dotenv').config({path:'./.env'})" src/patch-stops.ts
 *
 * This is FREE — it only writes to Firestore, no Google Maps API calls.
 * After running, the route-planner /api/plan endpoint will work immediately.
 */

import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../../.env") });

import { db } from "./lib/firebaseAdmin";
// @ts-ignore: shared file
import { PREDEFINED_ROUTES } from "../../frontend/src/lib/predefinedRoutes";

async function patchStops() {
  console.log("🩹 Patching Firestore routes with stops data (no API calls)...\n");

  let patched = 0;

  for (const route of PREDEFINED_ROUTES) {
    const routeRef = db.collection("routes").doc(route.id);
    const doc = await routeRef.get();

    if (!doc.exists) {
      console.warn(`⚠️  Route ${route.id} not found in Firestore. Run full seed first.`);
      continue;
    }

    const formattedStops = (route.stops ?? []).map(
      ({ id, name, shortName, lat, lng, waypointIndex }: {
        id: string; name: string; shortName: string;
        lat: number; lng: number; waypointIndex: number;
      }) => ({ id, name, shortName, lat, lng, waypointIndex })
    );

    await routeRef.update({
      stops: formattedStops,
      patchedAt: new Date().toISOString(),
    });

    console.log(`✅ Patched: ${route.name} (${formattedStops.length} stops)`);
    patched++;
  }

  console.log(`\n🎉 Done. Patched ${patched} routes with stops data.`);
  console.log("   The /api/plan endpoint is now ready to use.\n");
  process.exit(0);
}

patchStops().catch((err) => {
  console.error("❌ Patch failed:", err);
  process.exit(1);
});
