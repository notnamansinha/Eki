import { db } from "../lib/firebase";
import { doc, setDoc } from "firebase/firestore";
import { BRTS_ROUTES } from "../config/brtsRoutes";
import { UNI_ROUTES } from "../config/uniRoutes";

/**
 * Migration Script: Seed Firestore with hardcoded routes
 * to centralize route management.
 */

async function seed() {
  console.log("🚀 Starting Firestore Route Seeding...");

  const allRoutes = [
    ...BRTS_ROUTES.map(r => ({
      ...r,
      stops: r.stops.map(s => ({
        id: s.id,
        name: s.name,
        shortName: s.shortName,
        lat: s.lat,
        lng: s.lng
      }))
    })),
    ...UNI_ROUTES.map(r => ({
      ...r,
      stops: r.stops.map(s => ({
        id: s.id,
        name: s.name,
        shortName: s.shortName,
        lat: s.lat,
        lng: s.lng
      })),
      color: "#10b981" // Default emerald for uni routes
    }))
  ];

  for (const route of allRoutes) {
    try {
      console.log(`📡 Seeding route: ${route.name} (${route.id})...`);
      await setDoc(doc(db, "routes", route.id), route);
      console.log(`✅ Success: ${route.id}`);
    } catch (err) {
      console.error(`❌ Failed to seed ${route.id}:`, err);
    }
  }

  console.log("🏁 Seeding complete.");
}

seed().catch(console.error);
