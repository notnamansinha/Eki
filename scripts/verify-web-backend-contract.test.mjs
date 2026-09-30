import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertWebBackendContract,
  connectSourcesFromCsp,
} from "./verify-web-backend-contract.mjs";

function config(csp) {
  return {
    hosting: {
      headers: [{
        source: "**",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      }],
    },
  };
}

describe("web/backend deployment contract", () => {
  it("extracts only connect-src tokens", () => {
    assert.deepEqual(
      connectSourcesFromCsp("default-src 'self'; connect-src 'self' https://api.test; img-src data:;"),
      ["'self'", "https://api.test"],
    );
  });

  it("accepts the exact configured backend origin", () => {
    assert.deepEqual(
      assertWebBackendContract(
        config("default-src 'self'; connect-src 'self' https://api.test;"),
        "https://api.test/v1",
        true,
      ),
      { checked: true, origin: "https://api.test" },
    );
  });

  it("rejects a missing origin and an unset strict production URL", () => {
    assert.throws(() => assertWebBackendContract(
      config("connect-src 'self' https://old.test;"),
      "https://api.test",
      true,
    ));
    assert.throws(() => assertWebBackendContract(config("connect-src 'self';"), "", true));
  });
});
