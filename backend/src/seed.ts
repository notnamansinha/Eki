import { db } from "./lib/firebaseAdmin";
// @ts-ignore: Intentionally grabbing frontend file
import { PREDEFINED_ROUTES } from "../../frontend/src/lib/predefinedRoutes";
import { computeRouteGeometry } from "./lib/googleMaps";
import * as dotenv from "dotenv";
import { resolve } from "path";

// Load backend .env file
dotenv.config({ path: resolve(__dirname, "../../.env") });

async function seedFirebase() {
  console.log("🌱 Starting Firebase Seed with Google Maps geometry...");

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error("❌ FIREBASE_SERVICE_ACCOUNT is not set in the .env file.");
    process.exit(1);
  }

  try {
    const routesCollection = db.collection("routes");

    let count = 0;
    for (const route of PREDEFINED_ROUTES) {
      console.log(`\nProcessing route: ${route.name} (${route.id})...`);

      // Flatten waypoints from [lng, lat] to {lat, lng} to fix Firestore "nested arrays" error
      const formattedWaypoints = route.waypoints.map(([lng, lat]) => ({
        lat,
        lng,
      }));

      const origin = formattedWaypoints[0];
      const destination = formattedWaypoints[formattedWaypoints.length - 1];
      const intermediates = formattedWaypoints.slice(1, -1);

      console.log(`- Fetching road-snapped path from Google Maps...`);
      let geometry = {
        encodedPolyline: "",
        distanceMeters: 0,
        duration: "0s",
      };

      try {
        geometry = await computeRouteGeometry(origin, destination, intermediates);
        console.log(`- Success: ${geometry.distanceMeters}m, ${geometry.duration}`);
      } catch (error: any) {
        console.error(`- ⚠️ Google Maps API error for ${route.id}: ${error.message}`);
        console.log(`- Proceeding with default structure...`);
      }

      const routeDoc = routesCollection.doc(route.id);
      
      // Format stops: remove waypointIndex (internal use only) and include essential fields
      const formattedStops = (route.stops ?? []).map(({ id, name, shortName, lat, lng, waypointIndex }) => ({
        id, name, shortName, lat, lng, waypointIndex,
      }));

      await routeDoc.set({
        id: route.id,
        name: route.name,
        waypoints: formattedWaypoints, // Stored as array of objects
        color: route.color,
        stops: formattedStops,         // Named stops for route planner
        polyline: geometry.encodedPolyline,
        distanceMeters: geometry.distanceMeters,
        duration: geometry.duration,
        updatedAt: new Date().toISOString(),
      }, { merge: true });

      count++;
    }

    console.log(`\n✅ Successfully seeded ${count} routes into Firestore with road-snapped paths!`);
    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding Firebase:", error);
    process.exit(1);
  }
}

seedFirebase();
