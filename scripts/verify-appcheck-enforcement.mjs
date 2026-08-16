import { fileURLToPath } from "node:url";

const APP_CHECK_API = "https://firebaseappcheck.googleapis.com/v1beta";
const FIREBASE_MANAGEMENT_API = "https://firebase.googleapis.com/v1beta1";
const GOOGLE_OAUTH_API = "https://www.googleapis.com/oauth2/v3/token";
const REQUIRED_SERVICES = ["firestore.googleapis.com", "firebasedatabase.googleapis.com"];
const REQUEST_TIMEOUT_MS = 15_000;
// These are Firebase CLI's public OAuth client credentials. Installed-app
// OAuth clients cannot keep a client secret confidential; the refresh token
// remains the protected credential.
const FIREBASE_CLI_CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const FIREBASE_CLI_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";
const FIREBASE_CLI_SCOPES = [
  "email",
  "openid",
  "https://www.googleapis.com/auth/cloudplatformprojects.readonly",
  "https://www.googleapis.com/auth/firebase",
  "https://www.googleapis.com/auth/cloud-platform",
].join(" ");

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

export function shouldEnforceFromArgs(argv) {
  return argv.includes("--enforce");
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

async function requestJson(url, token, fetchImpl, init = {}) {
  const response = await fetchImpl(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Firebase API request failed (${response.status}) for ${new URL(url).pathname}.`);
  }
  return response.json();
}

async function getJson(url, token, fetchImpl) {
  return requestJson(url, token, fetchImpl);
}

export async function accessTokenFromFirebaseToken(firebaseToken, fetchImpl = fetch) {
  const response = await fetchImpl(GOOGLE_OAUTH_API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: firebaseToken,
      client_id: FIREBASE_CLI_CLIENT_ID,
      client_secret: FIREBASE_CLI_CLIENT_SECRET,
      grant_type: "refresh_token",
      scope: FIREBASE_CLI_SCOPES,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.ok) {
    const payload = await response.json();
    if (typeof payload.access_token !== "string" || !payload.access_token) {
      throw new Error("Firebase token refresh did not return an access token.");
    }
    return payload.access_token;
  }

  // Firebase CLI also accepts an already-issued access token through --token.
  // Preserve that compatibility while refresh-token deployments use the
  // short-lived token returned above.
  if (response.status === 400 || response.status === 401) return firebaseToken;
  throw new Error(`Firebase token refresh failed (${response.status}).`);
}

export async function verifyAppCheckEnforcement({ projectId, token, fetchImpl = fetch }) {
  if (!projectId) throw usageError("Missing Firebase project ID.");
  if (!token) throw new Error("FIREBASE_TOKEN is required to verify App Check enforcement.");

  const accessToken = await accessTokenFromFirebaseToken(token, fetchImpl);

  const metadata = await getJson(
    `${FIREBASE_MANAGEMENT_API}/projects/${encodeURIComponent(projectId)}`,
    accessToken,
    fetchImpl,
  );
  const projectNumber = projectNumberFromMetadata(metadata);

  const services = await Promise.all(
    REQUIRED_SERVICES.map(async (serviceId) => {
      const service = await getJson(
        `${APP_CHECK_API}/projects/${projectNumber}/services/${encodeURIComponent(serviceId)}`,
        accessToken,
        fetchImpl,
      );
      return assertEnforced(service, serviceId);
    }),
  );

  return { projectId, projectNumber, services };
}

export async function enforceAppCheckEnforcement({ projectId, token, fetchImpl = fetch }) {
  if (!projectId) throw usageError("Missing Firebase project ID.");
  if (!token) throw new Error("FIREBASE_TOKEN is required to enforce App Check.");

  const accessToken = await accessTokenFromFirebaseToken(token, fetchImpl);
  const metadata = await getJson(
    `${FIREBASE_MANAGEMENT_API}/projects/${encodeURIComponent(projectId)}`,
    accessToken,
    fetchImpl,
  );
  const projectNumber = projectNumberFromMetadata(metadata);

  const services = await Promise.all(
    REQUIRED_SERVICES.map(async (serviceId) => {
      const name = `projects/${projectNumber}/services/${serviceId}`;
      const service = await requestJson(
        `${APP_CHECK_API}/${name}?updateMask=enforcementMode`,
        accessToken,
        fetchImpl,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, enforcementMode: "ENFORCED" }),
        },
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
    const enforce = shouldEnforceFromArgs(process.argv.slice(2));
    const result = await (enforce ? enforceAppCheckEnforcement : verifyAppCheckEnforcement)({
      projectId,
      token: process.env.FIREBASE_TOKEN,
    });
    console.log(
      `Firebase App Check enforcement ${enforce ? "enabled" : "verified"} for ${result.projectId}: ${REQUIRED_SERVICES.join(", ")}.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
