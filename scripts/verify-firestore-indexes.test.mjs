import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { requiredQueries, verifyFirestoreIndexes } from "./verify-firestore-indexes.mjs";

const ready = { ok: true, json: async () => [{ readTime: "2026-10-06T00:00:00Z" }] };
const building = { ok: false, status: 400, json: async () => ({ error: { status: "FAILED_PRECONDITION", message: "The query requires an index that is building." } }) };
function harness(responses = []) {
  let now = 0;
  const requests = [];
  const waits = [];
  return {
    requests, waits,
    options: {
      projectId: "eki-test", token: "refresh-token", clock: () => now, log: () => {},
      timeoutMs: 30, pollMs: 10,
      wait: async ms => { waits.push(ms); now += ms; },
      fetchImpl: async (url, init) => {
        if (url.includes("oauth2/v3/token")) return { ok: true, json: async () => ({ access_token: "access-token" }) };
        requests.push({ url, init });
        return responses.shift() ?? ready;
      },
    },
  };
}

describe("Firestore deployed query readiness", () => {
  it("checks the retention IN/range/order shape and both collection-group filters with bounded name-only reads", () => {
    const probes = requiredQueries(180 * 86_400_000);
    assert.equal(probes.length, 3);
    assert.deepEqual(probes[0].query.where.compositeFilter.filters[0].fieldFilter.value.arrayValue.values,
      ["completed", "failed", "interrupted"].map(stringValue => ({ stringValue })));
    assert.equal(probes[0].query.where.compositeFilter.filters[1].fieldFilter.value.integerValue, "0");
    assert.deepEqual(probes[0].query.orderBy.map(o => o.field.fieldPath), ["endTime", "__name__"]);
    for (const [i, field] of [[1, "senderId"], [2, "userId"]]) {
      assert.equal(probes[i].query.from[0].allDescendants, true);
      assert.equal(probes[i].query.where.fieldFilter.field.fieldPath, field);
    }
    for (const probe of probes) {
      assert.equal(probe.query.limit, 1);
      assert.deepEqual(probe.query.select, { fields: [{ fieldPath: "__name__" }] });
    }
  });

  it("accepts an empty database response and uses the explicit project and refreshed credential", async () => {
    const h = harness();
    await verifyFirestoreIndexes(h.options);
    assert.equal(h.requests.length, 3);
    for (const { url, init } of h.requests) {
      assert.equal(url, "https://firestore.googleapis.com/v1/projects/eki-test/databases/(default)/documents:runQuery");
      assert.equal(init.headers.Authorization, "Bearer access-token");
      assert.equal(init.method, "POST");
      assert.ok(init.signal instanceof AbortSignal);
    }
    assert.deepEqual(h.waits, []);
  });

  it("retries only unavailable indexes and succeeds after their build completes", async () => {
    const h = harness([building, ready, building, ready, ready]);
    await verifyFirestoreIndexes(h.options);
    assert.equal(h.requests.length, 5);
    assert.deepEqual(h.waits, [10]);
    assert.equal(JSON.parse(h.requests[3].init.body).structuredQuery.from[0].collectionId, "ride_sessions");
    assert.equal(JSON.parse(h.requests[4].init.body).structuredQuery.from[0].collectionId, "messageRateLimits");
  });

  it("fails within the deadline when an index never becomes available", async () => {
    const h = harness(Array(20).fill(building));
    await assert.rejects(verifyFirestoreIndexes(h.options), /timed out/);
    assert.deepEqual(h.waits, [10, 10, 10]);
    assert.equal(h.requests.length, 9);
  });

  for (const status of [401, 403, 404, 500]) {
    it(`fails immediately on HTTP ${status} without printing provider data`, async () => {
      const h = harness([{ ok: false, status, json: async () => ({ error: { message: "sensitive-record" } }) }]);
      await assert.rejects(verifyFirestoreIndexes(h.options), error => error.message.includes(`HTTP ${status}`) && !error.message.includes("sensitive-record"));
      assert.equal(h.requests.length, 1);
      assert.deepEqual(h.waits, []);
    });
  }

  it("does not retry unrelated preconditions or accept malformed success responses", async () => {
    for (const response of [
      { ok: false, status: 400, json: async () => ({ error: { status: "FAILED_PRECONDITION", message: "Database disabled" } }) },
      ...[{}, [], [null], [{ error: {} }]].map(payload => ({ ok: true, json: async () => payload })),
    ]) {
      const h = harness([response]);
      await assert.rejects(verifyFirestoreIndexes(h.options));
      assert.deepEqual(h.waits, []);
    }
  });

  it("rejects malformed timestamps and documents even alongside other valid response fields", async () => {
    for (const payload of [
      [{ readTime: {} }], [{ readTime: 1 }], [{ readTime: "not-a-timestamp" }],
      [{ readTime: "2026-02-30T00:00:00Z" }], [{ readTime: "2026-10-06T25:00:00Z" }],
      [{ document: {} }], [{ document: null, readTime: "2026-10-06T00:00:00Z" }],
      [{ document: { name: "projects/other-project/databases/(default)/documents/ride_sessions/ride" } }],
      [{ document: { name: "projects/eki-test/databases/other/documents/ride_sessions/ride" } }],
      [{ document: { name: "projects/eki-test/databases/(default)/documents/messages/message" } }],
      [{ document: { name: "projects/eki-test/databases/(default)/documents/ride_sessions/" } }],
      [{ document: { name: "projects/eki-test/databases/(default)/documents/ride_sessions/ride/child" } }],
      [{ readTime: "2026-10-06T00:00:00Z", error: null }],
    ]) {
      const h = harness([{ ok: true, json: async () => payload }]);
      await assert.rejects(verifyFirestoreIndexes(h.options), /Invalid Firestore readiness response/);
      assert.deepEqual(h.waits, []);
      assert.equal(h.requests.length, 1);
    }
  });

  it("accepts real projected document names and valid empty-query RFC3339 times", async () => {
    const h = harness([
      { ok: true, json: async () => [{ document: { name: "projects/eki-test/databases/(default)/documents/ride_sessions/ride" }, readTime: "2024-02-29T00:00:00.123456789Z" }] },
      { ok: true, json: async () => [{ document: { name: "projects/eki-test/databases/(default)/documents/ride_sessions/ride/messages/message" }, readTime: "2026-10-06T05:30:00+05:30" }] },
      { ok: true, json: async () => [{ readTime: "2026-10-06T00:00:00Z" }] },
    ]);
    await verifyFirestoreIndexes(h.options);
    assert.equal(h.requests.length, 3);
    assert.deepEqual(h.waits, []);
  });

  it("does not expose malformed provider JSON in checker errors", async () => {
    const h = harness([{ ok: true, json: async () => { throw new SyntaxError('Unexpected token in "sensitive-record"'); } }]);
    await assert.rejects(verifyFirestoreIndexes(h.options), error => /Invalid Firestore readiness response/.test(error.message) && !error.message.includes("sensitive-record"));
    assert.deepEqual(h.waits, []);
  });

  it("rejects missing credentials and invalid projects before making requests", async () => {
    for (const override of [{ token: "" }, { projectId: "" }, { projectId: "../other" }]) {
      const h = harness();
      await assert.rejects(verifyFirestoreIndexes({ ...h.options, ...override }));
      assert.equal(h.requests.length, 0);
    }
  });

  it("fails on a stalled request or a response arriving after the total deadline", async () => {
    const h = harness();
    const authFetch = h.options.fetchImpl;
    h.options.fetchImpl = async (url, init) => {
      if (url.includes("oauth2/v3/token")) return authFetch(url, init);
      throw new DOMException("Request timed out", "TimeoutError");
    };
    await assert.rejects(verifyFirestoreIndexes(h.options), { name: "TimeoutError" });
    assert.deepEqual(h.waits, []);

    const late = harness();
    const originalFetch = late.options.fetchImpl;
    late.options.fetchImpl = async (url, init) => {
      if (!url.includes("oauth2/v3/token")) await late.options.wait(31);
      return originalFetch(url, init);
    };
    await assert.rejects(verifyFirestoreIndexes(late.options), /timed out/);
  });

  it("gates hosting on index deployment and readiness in both workflow jobs", () => {
    const workflow = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
    for (const [job, project] of [["deploy-staging", "bustrack-be165"], ["deploy-production", "eki-production"]]) {
      const section = workflow.split(`  ${job}:`)[1].split(/\n  deploy-/)[0];
      const deployIndex = section.indexOf("--only firestore:indexes");
      const readiness = section.indexOf(`node scripts/verify-firestore-indexes.mjs --project ${project}`);
      const hosting = section.indexOf("--only hosting,firestore:rules,database:rules");
      assert.ok(deployIndex > 0 && readiness > deployIndex && hosting > readiness);
      assert.ok(section.slice(0, deployIndex).endsWith(`--project ${project}\n          `) || section.slice(0, deployIndex).endsWith(`--project ${project}\r\n          `));
      assert.ok(section.includes("timeout-minutes: 32"));
      assert.ok(section.includes("--non-interactive"));
    }
  });
});
