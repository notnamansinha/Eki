import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { db } from "../lib/firebaseAdmin";
import { recordWorkerRun } from "../lib/metrics";
import { assertWorkerLeadership, bindWorkerContext, workerSet } from "../lib/workerFence";

/**
 * Route popularity for the passenger Routes tab.
 *
 * The leader counts `completed_trips` per route and publishes the totals to
 * `settings/routeUsage`, which any signed-in user may read. Passengers cannot
 * read ride history itself, so this document is the only usage signal they
 * see. Counts cover the trips still retained (180 days by default), and are
 * recomputed from scratch each run, so retention and history deletion are
 * reflected on the next run without any counter bookkeeping.
 */
export const ROUTE_USAGE_DOCUMENT = "routeUsage";
export const ROUTE_USAGE_INTERVAL_MS = 60 * 60 * 1000;
/** Matches the passenger-route approval limit; larger fleets are truncated by route ID. */
export const ROUTE_USAGE_MAX_ROUTES = 200;
const COUNT_CONCURRENCY = 8;

export interface RouteUsageSummary {
  completedRides: Record<string, number>;
  generatedAt: string;
  truncated: boolean;
}

/** One `count()` aggregation per existing route; each costs one read per 1,000 matches. */
export async function computeRouteUsage(store: Firestore = db, now: () => number = Date.now): Promise<RouteUsageSummary> {
  const routes = await store.collection("routes").select().orderBy(FieldPath.documentId()).limit(ROUTE_USAGE_MAX_ROUTES + 1).get();
  const routeIds = routes.docs.map(doc => doc.id);
  const truncated = routeIds.length > ROUTE_USAGE_MAX_ROUTES;
  const counted = routeIds.slice(0, ROUTE_USAGE_MAX_ROUTES);
  const completedRides: Record<string, number> = {};
  for (let offset = 0; offset < counted.length; offset += COUNT_CONCURRENCY) {
    assertWorkerLeadership();
    await Promise.all(counted.slice(offset, offset + COUNT_CONCURRENCY).map(async routeId => {
      const snapshot = await store.collection("completed_trips").where("routeId", "==", routeId).count().get();
      completedRides[routeId] = snapshot.data().count;
    }));
  }
  return { completedRides, generatedAt: new Date(now()).toISOString(), truncated };
}

/** Replaces the published summary, so counts for deleted routes disappear. */
export async function publishRouteUsage(store: Firestore = db, now: () => number = Date.now): Promise<RouteUsageSummary> {
  const summary = await computeRouteUsage(store, now);
  assertWorkerLeadership();
  await workerSet(store, store.collection("settings").doc(ROUTE_USAGE_DOCUMENT), { ...summary }, {});
  return summary;
}

/** Runs on leadership start and then hourly; overlapping runs are skipped. */
export function startRouteUsageSummary(store: Firestore = db): () => void {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  const run = bindWorkerContext(() => {
    if (stopped || inFlight) return;
    const running = publishRouteUsage(store).then(
      summary => {
        recordWorkerRun("route_usage", "success");
        if (summary.truncated) console.warn(`[RouteUsage] More than ${ROUTE_USAGE_MAX_ROUTES} routes; counted the first ${ROUTE_USAGE_MAX_ROUTES} by ID.`);
      },
      error => {
        recordWorkerRun("route_usage", "failure");
        if (!stopped) console.warn("[RouteUsage] Summary failed; the previous counts stay published:", error);
      },
    ).finally(() => { if (inFlight === running) inFlight = null; });
    inFlight = running;
  });
  run();
  const timer = setInterval(run, ROUTE_USAGE_INTERVAL_MS);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
