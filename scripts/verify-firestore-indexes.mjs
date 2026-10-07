import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { accessTokenFromFirebaseToken, projectIdFromArgs } from "./verify-appcheck-enforcement.mjs";

const fieldFilter = (fieldPath, op, value) => ({ fieldFilter: { field: { fieldPath }, op, value } });
// Match the indexed query shapes in retentionSweeper and privacyDeletionWorker.
// Read only document names, at most one per query; never delete or log records.
export function requiredQueries(now = Date.now()) {
  return [
    {
      name: "ride-session retention",
      query: {
        from: [{ collectionId: "ride_sessions" }],
        where: { compositeFilter: { op: "AND", filters: [
          fieldFilter("status", "IN", { arrayValue: { values: ["completed", "failed", "interrupted"].map(stringValue => ({ stringValue })) } }),
          fieldFilter("endTime", "LESS_THAN", { integerValue: String(now - 180 * 86_400_000) }),
        ] } },
        orderBy: ["endTime", "__name__"].map(fieldPath => ({ field: { fieldPath }, direction: "ASCENDING" })),
      },
    },
    ...[["messages", "senderId"], ["messageRateLimits", "userId"]].map(([collectionId, field]) => ({
      name: `${collectionId} privacy deletion`,
      query: {
        from: [{ collectionId, allDescendants: true }],
        where: fieldFilter(field, "EQUAL", { stringValue: "__eki_index_readiness_probe__" }),
      },
    })),
  ].map(({ name, query }) => ({ name, query: { ...query, select: { fields: [{ fieldPath: "__name__" }] }, limit: 1 } }));
}

function validReadTime(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function validQueryResult(item, projectId, query) {
  if (!item || typeof item !== "object" || Array.isArray(item) || "error" in item) return false;
  if ("readTime" in item && !validReadTime(item.readTime)) return false;
  if (!("document" in item)) return validReadTime(item.readTime);
  const document = item.document;
  if (!document || typeof document !== "object" || Array.isArray(document) || typeof document.name !== "string") return false;
  const prefix = `projects/${projectId}/databases/(default)/documents/`;
  if (!document.name.startsWith(prefix)) return false;
  const path = document.name.slice(prefix.length).split("/");
  const collection = query.from[0];
  return path.length >= 2 && path.length % 2 === 0 && path.every(segment => segment.length > 0) &&
    path.at(-2) === collection.collectionId && (collection.allDescendants || path.length === 2);
}

export async function verifyFirestoreIndexes({
  projectId, token, fetchImpl = fetch, wait = sleep, clock = () => performance.now(),
  timeoutMs = 30 * 60_000, pollMs = 10_000, log = console.log,
}) {
  if (!projectId || !/^[a-z][a-z0-9-]{4,62}$/.test(projectId)) throw new Error("A valid explicit --project is required.");
  if (!token) throw new Error("FIREBASE_TOKEN is required to verify Firestore indexes.");
  if (!(timeoutMs > 0) || !(pollMs > 0)) throw new Error("Readiness budgets must be positive.");
  const deadline = clock() + timeoutMs;
  const accessToken = await accessTokenFromFirebaseToken(token, fetchImpl);
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  let pending = requiredQueries();
  while (pending.length) {
    const retry = [];
    for (const probe of pending) {
      const remaining = deadline - clock();
      if (remaining <= 0) throw new Error(`Firestore index readiness timed out: ${pending.map(p => p.name).join(", ")}.`);
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ structuredQuery: probe.query }),
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(15_000, remaining)))),
      });
      let payload;
      try { payload = await response.json(); }
      catch { throw new Error(`Invalid Firestore readiness response for ${probe.name}.`); }
      if (clock() >= deadline) throw new Error(`Firestore index readiness timed out: ${probe.name}.`);
      if (!response.ok) {
        if (payload?.error?.status === "FAILED_PRECONDITION" && /index/i.test(payload.error.message ?? "")) {
          retry.push(probe);
          continue;
        }
        // Never print server response bodies: they can contain record identifiers.
        throw new Error(`Firestore readiness query ${probe.name} failed (HTTP ${response.status}).`);
      }
      if (!Array.isArray(payload) || !payload.length || payload.some(item => !validQueryResult(item, projectId, probe.query))) {
        throw new Error(`Invalid Firestore readiness response for ${probe.name}.`);
      }
    }
    pending = retry;
    if (pending.length) {
      const remaining = deadline - clock();
      if (remaining <= 0) throw new Error(`Firestore index readiness timed out: ${pending.map(p => p.name).join(", ")}.`);
      log(`Waiting for Firestore indexes: ${pending.map(p => p.name).join(", ")}.`);
      await wait(Math.min(pollMs, remaining));
    }
  }
  log(`Firestore retention and privacy queries ready for ${projectId}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await verifyFirestoreIndexes({ projectId: projectIdFromArgs(process.argv.slice(2)), token: process.env.FIREBASE_TOKEN });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
