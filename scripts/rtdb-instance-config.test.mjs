import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseRtdbInstanceUrl,
  verifyMatchingRtdbInstances,
} from "./rtdb-instance-config.mjs";

describe("RTDB instance configuration", () => {
  it("recognizes the supported Iowa and Singapore URL formats", () => {
    assert.deepEqual(
      parseRtdbInstanceUrl("https://eki-default-rtdb.firebaseio.com"),
      {
        databaseName: "eki-default-rtdb",
        hostname: "eki-default-rtdb.firebaseio.com",
        region: "us-central1",
      },
    );
    assert.equal(
      parseRtdbInstanceUrl(
        "https://eki-live.asia-southeast1.firebasedatabase.app/",
      ).region,
      "asia-southeast1",
    );
  });

  it("rejects credentials, paths, insecure schemes, and unrelated hosts", () => {
    for (const value of [
      "http://eki-default-rtdb.firebaseio.com",
      "https://user:secret@eki-default-rtdb.firebaseio.com",
      "https://eki-default-rtdb.firebaseio.com:444",
      "https://eki-default-rtdb.firebaseio.com/activeBuses",
      "https://example.com",
    ]) {
      assert.throws(() => parseRtdbInstanceUrl(value));
    }
  });

  it("fails closed when backend, frontend, or the approved region differs", () => {
    const iowa = "https://eki-default-rtdb.firebaseio.com";
    const singapore = "https://eki-live.asia-southeast1.firebasedatabase.app";
    assert.throws(() => verifyMatchingRtdbInstances({
      backendUrl: iowa,
      frontendUrl: singapore,
    }), /do not match/);
    assert.throws(() => verifyMatchingRtdbInstances({
      backendUrl: iowa,
      frontendUrl: iowa,
      expectedRegion: "asia-southeast1",
    }), /does not match expected region/);
    assert.deepEqual(verifyMatchingRtdbInstances({
      backendUrl: singapore,
      frontendUrl: singapore,
      expectedRegion: "asia-southeast1",
    }), { region: "asia-southeast1" });
  });
});
