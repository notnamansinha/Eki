import { fileURLToPath } from "node:url";

const APP_CHECK_API = "https://firebaseappcheck.googleapis.com/v1beta";
const FIREBASE_MANAGEMENT_API = "https://firebase.googleapis.com/v1beta1";
const REQUIRED_SERVICES = ["firestore.googleapis.com", "firebasedatabase.googleapis.com"];
const REQUEST_TIMEOUT_MS = 15_000;

function usageError(message) {
  return new Error(`${message} Usage: node scripts/verify-appcheck-enforcement.mjs --project <project-id>`);
}

export function projectIdFromArgs(argv) {
  const projectFlagIndex = argv.indexOf("--project");
  if (projectFlagIndex === -1 || !argv[projectFlagIndex + 1]) {
    throw usageError("Missing --project.");
  }
  return argv[projectFlagIndex + 1];
}

export function projectNumberFromMetadata(metadata) {
  const projectNumber = metadata?.projectNumber ?? metadata?.name?.split("/").pop();
  if (!projectNumber || !/^\d+$/.test(String(projectNumber))) {
    throw new Error("Firebase project metadata did not include a valid project number.");
  }
  return String(projectNumber);
}

export function assertEnforced(service, serviceId) {
  if (service?.enforcementMode !== "ENFORCED") {
    throw new Error(
      `Firebase App Check is not enforced for ${serviceId} (mode: ${service?.enforcementMode ?? "UNKNOWN"}).`,
    );
  }
  return service;
}

async function getJson(url, token, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Firebase API request failed (${response.status}) for ${new URL(url).pathname}.`);
  }
  return response.json();
}

export async function verifyAppCheckEnforcement({ projectId, token, fetchImpl = fetch }) {
  if (!projectId) throw usageError("Missing Firebase project ID.");
  if (!token) throw new Error("FIREBASE_TOKEN is required to verify App Check enforcement.");

  const metadata = await getJson(
    `${FIREBASE_MANAGEMENT_API}/projects/${encodeURIComponent(projectId)}`,
    token,
    fetchImpl,
  );
  const projectNumber = projectNumberFromMetadata(metadata);

  const services = await Promise.all(
    REQUIRED_SERVICES.map(async (serviceId) => {
      const service = await getJson(
        `${APP_CHECK_API}/projects/${projectNumber}/services/${encodeURIComponent(serviceId)}`,
        token,
        fetchImpl,
      );
      return assertEnforced(service, serviceId);
    }),
  );

  return { projectId, projectNumber, services };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    const projectId = projectIdFromArgs(process.argv.slice(2));
    const result = await verifyAppCheckEnforcement({
      projectId,
      token: process.env.FIREBASE_TOKEN,
    });
    console.log(
      `Firebase App Check enforcement verified for ${result.projectId}: ${REQUIRED_SERVICES.join(", ")}.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
