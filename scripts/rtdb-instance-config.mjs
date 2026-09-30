import { pathToFileURL } from "node:url";

const REGIONAL_HOST = /^([a-z0-9-]+)\.(asia-southeast1|europe-west1)\.firebasedatabase\.app$/;
const IOWA_HOST = /^([a-z0-9-]+)\.firebaseio\.com$/;

/** Parse only Firebase RTDB instance origins. Never return credentials or data. */
export function parseRtdbInstanceUrl(value, label = "RTDB URL") {
  if (!value?.trim()) throw new Error(`${label} is required.`);
  const parsed = new URL(value.trim());
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new Error(`${label} must be a credential-free Firebase RTDB HTTPS origin.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const iowa = hostname.match(IOWA_HOST);
  const regional = hostname.match(REGIONAL_HOST);
  if (!iowa && !regional) {
    throw new Error(`${label} is not a supported Firebase RTDB instance hostname.`);
  }
  return {
    databaseName: (iowa ?? regional)[1],
    hostname,
    region: iowa ? "us-central1" : regional[2],
  };
}

export function verifyMatchingRtdbInstances({ backendUrl, frontendUrl, expectedRegion }) {
  const backend = parseRtdbInstanceUrl(backendUrl, "FIREBASE_DATABASE_URL");
  const frontend = parseRtdbInstanceUrl(
    frontendUrl,
    "NEXT_PUBLIC_FIREBASE_DATABASE_URL",
  );
  if (backend.hostname !== frontend.hostname) {
    throw new Error("Backend and frontend RTDB instances do not match.");
  }
  if (expectedRegion && backend.region !== expectedRegion) {
    throw new Error(
      `Configured RTDB region ${backend.region} does not match expected region ${expectedRegion}.`,
    );
  }
  return { region: backend.region };
}

const invokedDirectly = process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  const result = verifyMatchingRtdbInstances({
    backendUrl: process.env.FIREBASE_DATABASE_URL,
    frontendUrl: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    expectedRegion: process.env.RTDB_EXPECTED_REGION?.trim() || undefined,
  });
  console.log(`RTDB configuration verified: one ${result.region} instance.`);
}
