import { isDeepStrictEqual } from "node:util";
import { liveProjectionWriterRtdb, rtdb } from "../lib/firebaseAdmin";
import { isRtdbPermissionDenied, workerRtdbFencedUpdate, workerRtdbTransaction } from "../lib/workerFence";
import { LruCache } from "../lib/lruCache";

export const projectionRouteKey = (routeId: string) => `route:${routeId}`;
/** The one place a route's destination path is built. */
const routePath = (routeId: string) => `publicRouteBuses/${projectionRouteKey(routeId)}`;

type Buses = Record<string, Record<string, unknown>>;
/** A `publicRouteBuses/route:{routeId}` node as stored. */
export type RouteNode = { buses?: Buses; revision?: number; _workerGeneration?: number };
/**
 * The leader's copy of one route's public buses and revision, as last confirmed
 * by the database. `epoch` is the recovery pass in which the claim behind it
 * began. Copies are replaced, never edited in place.
 */
type RouteView = Readonly<{ buses: Readonly<Buses>; revision: number; epoch: number }>;
/**
 * The route a publication leaves for the catalog to count (null when the node
 * is absent), or null when this leader may not publish the catalog: a newer
 * generation owns the route, or the claim did not commit.
 */
export type Publication = { route: { buses?: Buses; revision?: number } | null } | null;

const isMap = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The smallest multi-path update that turns `previous` into `next` at `path`:
 * changed leaves, `null` for removed ones, and a whole value where there was
 * none (or an array, which is replaced as a unit). Every leaf repeats its full
 * path on the wire, so a map most of whose fields changed is replaced whole
 * when that serializes smaller. No returned path is an ancestor of another,
 * as a multi-path update requires.
 */
export function projectionLeafChanges(path: string, previous: unknown, next: unknown, changes: Record<string, unknown> = {}): Record<string, unknown> {
  if (isMap(previous) && isMap(next)) {
    const leaves: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      projectionLeafChanges(`${path}/${key}`, Object.hasOwn(previous, key) ? previous[key] : null, Object.hasOwn(next, key) ? next[key] : null, leaves);
    }
    if (Object.keys(leaves).length === 0) return changes;
    if (JSON.stringify(leaves).length > JSON.stringify({ [path]: next }).length) changes[path] = next;
    else Object.assign(changes, leaves);
  } else if (!isDeepStrictEqual(previous ?? null, next ?? null)) changes[path] = next ?? null;
  return changes;
}

/** After the rules refuse a valid leaf write, use whole-node transactions this long before trying leaf writes again. */
export const LEAF_WRITE_RETRY_MS = 5 * 60_000;

export type ProjectionWriterCounters = {
  transactionAttempts: number; committed: number; publicBytes: number;
  routeClaims: number; leafWriteAttempts: number; leafWrites: number; leafWriteDenials: number; leafWriteFallbacks: number; leafWriteDrifts: number;
};
export type ProjectionWriteMode = "leaf" | "transaction" | "transaction-fallback";

/**
 * Writes the public projection of each route for one worker generation.
 *
 * A route is claimed with a whole-node transaction that stamps the
 * generation; each publication then sends only the fields that changed for
 * one bus, through the rules-bound writer. `database.rules.json` accepts that
 * update only with the stored generation and the stored revision plus 1, so a
 * successor's claim refuses every later write from this generation at the
 * destination. Callers serialize publications per route.
 */
export function createLiveBusProjectionWriter(options: {
  generation: number;
  counters: ProjectionWriterCounters;
  isStopped: () => boolean;
  /** Unset or anything but `transaction`: leaf writes (`LIVE_PROJECTION_WRITE_MODE`). */
  mode?: string;
}) {
  const { generation, counters, isStopped } = options;
  // Leaf writes need a generation for the rules to compare.
  const leafCapable = generation > 0 && options.mode?.trim().toLowerCase() !== "transaction";
  let leafRetryAt = 0;
  const views = new LruCache<string, RouteView>(1000);
  // Advanced as each recovery pass starts. A copy whose claim began earlier can
  // miss an edit made without a revision, such as an erased bus or route, and a
  // replay that matches such a copy would write nothing. Publications therefore
  // claim each route afresh once per pass before comparing against it.
  let epoch = 0;

  /**
   * Claims the route for this generation's leaf writes and keeps the claimed
   * node as the copy. It never aborts: the SDK can resolve an abort from local
   * state that includes another transaction's unconfirmed output, while a
   * commit is accepted only against the server's current value. Returns null
   * when the route is not this generation's to write.
   */
  async function claim(routeId: string): Promise<RouteView | null> {
    counters.routeClaims++;
    const claimEpoch = epoch;
    const result = await workerRtdbTransaction(rtdb.ref(routePath(routeId)), current => {
      counters.transactionAttempts++;
      if (isStopped()) return;
      return { ...current, buses: current?.buses ?? {}, revision: current ? Number(current.revision ?? 0) : 1 };
    });
    const node = result.snapshot.val() as RouteNode | null;
    const view = result.committed && !isStopped() && node?._workerGeneration === generation && typeof node.revision === "number"
      ? { buses: { ...node.buses }, revision: node.revision, epoch: claimEpoch } : null;
    if (view) views.set(routeId, view); else views.delete(routeId);
    return view;
  }

  /** The original publication: replaces the route node, so every listener is resent every bus on the route. */
  async function publishByTransaction(routeId: string, busKey: string, value: Record<string, unknown> | null): Promise<Publication> {
    views.delete(routeId);
    const result = await workerRtdbTransaction(rtdb.ref(routePath(routeId)), current => {
      counters.transactionAttempts++;
      if (isStopped()) return;
      const previous = current?.buses?.[busKey] ?? null;
      if (isDeepStrictEqual(previous, value)) return current?._workerGeneration === generation ? undefined : { ...current };
      const buses = { ...(current?.buses ?? {}) };
      if (value) buses[busKey] = value; else delete buses[busKey];
      return { ...current, buses, revision: Number(current?.revision ?? 0) + 1 };
    });
    if (result.committed && !isStopped()) { counters.committed++; counters.publicBytes += Buffer.byteLength(JSON.stringify(value)); }
    // An abort can also mean a newer generation rejected the write; the catalog
    // transaction is fenced too, so publishing it from the snapshot is safe.
    return { route: result.snapshot.val() as RouteNode | null };
  }

  /**
   * After a denial straight after a confirmed claim, reads the stored fence.
   * The write was valid if the route still carries this generation and the
   * revision before it; only then can the rules be what refused it.
   */
  async function rulesRefusedValidWrite(routeId: string, attemptedRevision: number): Promise<boolean> {
    const [storedGeneration, storedRevision] = await Promise.all(["_workerGeneration", "revision"]
      .map(field => rtdb.ref(`${routePath(routeId)}/${field}`).once("value").then(snapshot => snapshot.val())));
    return storedGeneration === generation && storedRevision === attemptedRevision - 1;
  }

  return {
    leafCapable,
    writeMode(): ProjectionWriteMode {
      return !leafCapable ? "transaction" : performance.now() < leafRetryAt ? "transaction-fallback" : "leaf";
    },
    /** A recovery pass starts: every route is claimed afresh before its next comparison. */
    beginRecoveryPass() { epoch++; },

    /**
     * Restores a lost revision lineage above `floor` and stamps this
     * generation where an older one owns the node. Recovery runs beside
     * publications and must not replace a copy they may be changing, so it
     * discards the copy: the next publication claims afresh, which also
     * repairs a destination changed without a revision. Returns the node the
     * transaction settled on, as the catalog lineage to publish.
     */
    async restoreLineage(routeId: string, floor: number): Promise<RouteNode | null> {
      counters.routeClaims++;
      const result = await workerRtdbTransaction(rtdb.ref(routePath(routeId)), current => {
        counters.transactionAttempts++;
        if (isStopped()) return;
        const revision = Number(current?.revision ?? 0);
        const rebuilding = !current || revision < floor;
        if (!rebuilding && current?._workerGeneration === generation && typeof current.revision === "number") return;
        return { ...current, buses: current?.buses ?? {}, revision: rebuilding ? Math.max(revision, floor) + 1 : revision };
      });
      views.delete(routeId);
      return result.snapshot.val() as RouteNode | null;
    },

    /**
     * Publishes one bus as a multi-path update of only its changed leaves, so
     * a listener downloads those leaves rather than every bus on the route.
     */
    async publish(routeId: string, busKey: string, value: Record<string, unknown> | null): Promise<Publication> {
      if (!leafCapable || performance.now() < leafRetryAt) return publishByTransaction(routeId, busKey, value);
      let attempted = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        let view = views.get(routeId);
        // A copy from before the current recovery pass may still list a bus that
        // was erased since; comparing a replay against it could skip the repair.
        if (!view || view.epoch !== epoch) {
          const claimed = await claim(routeId);
          if (isStopped()) return null;
          // A newer generation owns the destination, or the claim could not
          // commit: only a confirmed owner may write it or the catalog.
          if (!claimed) return null;
          view = claimed;
        }
        const changes = projectionLeafChanges(`buses/${busKey}`, Object.hasOwn(view.buses, busKey) ? view.buses[busKey] : null, value);
        if (Object.keys(changes).length === 0) return { route: view };
        counters.leafWriteAttempts++;
        attempted = view.revision + 1;
        try {
          await workerRtdbFencedUpdate(liveProjectionWriterRtdb().ref(routePath(routeId)), { ...changes, revision: attempted });
        } catch (error) {
          // The copy can no longer be trusted, whatever failed.
          views.delete(routeId);
          if (!isRtdbPermissionDenied(error)) throw error;
          counters.leafWriteDenials++;
          if (isStopped()) return null;
          // Claim again: that tells a successor's takeover (stop writing) from a
          // drifted copy or a write the SDK resent after a lost acknowledgement.
          continue;
        }
        const buses = { ...view.buses };
        if (value) buses[busKey] = value; else delete buses[busKey];
        const written: RouteView = { buses, revision: attempted, epoch: view.epoch };
        // Recovery may have discarded the copy while the write was in flight. Keep
        // the cache empty then, so the next publication claims the route afresh.
        if (views.get(routeId) === view) views.set(routeId, written);
        counters.committed++; counters.leafWrites++; counters.publicBytes += Buffer.byteLength(JSON.stringify(changes));
        return { route: written };
      }
      // Denied twice, the second time straight after a confirmed claim. If the
      // stored fence matches that write, the rules refused a valid update: they
      // are not deployed, so pause leaf writes. Otherwise the route moved under
      // the claim; this publication goes by transaction and the next claims again.
      if (await rulesRefusedValidWrite(routeId, attempted)) {
        leafRetryAt = performance.now() + LEAF_WRITE_RETRY_MS;
        counters.leafWriteFallbacks++;
        console.warn("[LiveProjection] Rules refused a valid per-bus projection write after a confirmed claim; using whole-route transactions for 5 minutes. Deploy database.rules.json to restore leaf writes.");
      } else counters.leafWriteDrifts++;
      if (isStopped()) return null;
      return publishByTransaction(routeId, busKey, value);
    },
  };
}
