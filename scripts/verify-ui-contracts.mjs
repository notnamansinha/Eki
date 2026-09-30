import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

const [routePanel, routePayload, routeApi, passengerMap, frontendFiles] = await Promise.all([
  read("frontend/src/components/admin/RouteManagementPanel.tsx"),
  read("frontend/src/lib/routeStopPayload.ts"),
  read("backend/src/routes/polyline.ts"),
  read("frontend/src/components/maps/PassengerMap.tsx"),
  Promise.all([
    "frontend/src/components/admin/RouteManagementPanel.tsx",
    "frontend/src/lib/routeStopPayload.ts",
    "frontend/src/components/passenger/PassengerWorkspace.tsx",
  ].map(read)),
]);

for (const [label, source] of [
  ["route editor", routePanel],
  ["route payload", routePayload],
  ["route API", routeApi],
]) {
  if (/ROUTE_TYPES|Route type|state\.type|route\.type/.test(source)) {
    throw new Error(`Obsolete route-type behavior remains in ${label}.`);
  }
}
if (/String\.fromCharCode\s*\(\s*65\s*\+/.test(passengerMap)) {
  throw new Error("Passenger map still has a private A-Z-only stop label implementation.");
}
if (!passengerMap.includes('from "@/lib/stopLabel"')) {
  throw new Error("Passenger map does not use the shared stop-label helper.");
}
if (frontendFiles.some((source) => source.includes("GOOGLE_MAPS_API_KEY"))) {
  throw new Error("A frontend route path references the server Google Maps key.");
}
for (const required of [
  "scripts/verify-web-backend-contract.mjs",
  "playwright.config.ts",
  "e2e/admin-responsive.spec.ts",
]) {
  await access(path.join(root, required));
}

console.log("UI source contracts verified.");
