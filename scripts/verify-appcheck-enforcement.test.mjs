import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertEnforced,
  projectIdFromArgs,
  projectNumberFromMetadata,
  verifyAppCheckEnforcement,
} from "./verify-appcheck-enforcement.mjs";

describe("verify-appcheck-enforcement", () => {
  it("requires an explicit project ID", () => {
    assert.equal(projectIdFromArgs(["--project", "eki-staging"]), "eki-staging");
    assert.throws(() => projectIdFromArgs([]), /Missing --project/);
  });

  it("extracts and validates a Firebase project number", () => {
    assert.equal(projectNumberFromMetadata({ projectNumber: "12345" }), "12345");
    assert.equal(projectNumberFromMetadata({ name: "projects/67890" }), "67890");
    assert.throws(() => projectNumberFromMetadata({ projectNumber: "not-a-number" }), /valid project number/);
  });

  it("fails closed when a required service is not enforced", () => {
    assert.throws(() => assertEnforced({ enforcementMode: "UNENFORCED" }, "firestore.googleapis.com"), /not enforced/);
  });

  it("verifies both required services using the project number", async () => {
    const requestedUrls = [];
    const fetchImpl = async (url) => {
      requestedUrls.push(url);
      if (url.includes("firebase.googleapis.com/v1beta1")) {
        return { ok: true, json: async () => ({ projectNumber: "12345" }) };
      }
      return { ok: true, json: async () => ({ enforcementMode: "ENFORCED" }) };
    };

    const result = await verifyAppCheckEnforcement({
      projectId: "eki-staging",
      token: "test-token",
      fetchImpl,
    });

    assert.equal(result.projectNumber, "12345");
    assert.equal(requestedUrls.length, 3);
    assert.ok(requestedUrls.some((url) => url.endsWith("projects/12345/services/firestore.googleapis.com")));
    assert.ok(requestedUrls.some((url) => url.endsWith("projects/12345/services/firebasedatabase.googleapis.com")));
  });
});
