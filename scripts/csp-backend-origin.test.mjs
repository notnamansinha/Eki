import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backendOriginFromUrl } from "./csp-backend-origin.mjs";

describe("backendOriginFromUrl", () => {
  it("accepts production HTTPS and strips paths", () => {
    assert.equal(
      backendOriginFromUrl("https://api.example.test/v1/"),
      "https://api.example.test",
    );
  });

  it("allows HTTP only for loopback development hosts", () => {
    assert.equal(backendOriginFromUrl("http://localhost:3001"), "http://localhost:3001");
    assert.equal(backendOriginFromUrl("http://127.0.0.1:3001"), "http://127.0.0.1:3001");
    assert.equal(backendOriginFromUrl("http://[::1]:3001"), "http://[::1]:3001");
    assert.throws(() => backendOriginFromUrl("http://api.example.test"));
  });

  it("rejects non-HTTP schemes even on localhost", () => {
    assert.throws(() => backendOriginFromUrl("ws://localhost:3001"));
    assert.throws(() => backendOriginFromUrl("ftp://localhost/resource"));
  });

  it("rejects embedded credentials and accepts an unset value", () => {
    assert.throws(() => backendOriginFromUrl("https://user:secret@api.example.test"));
    assert.equal(backendOriginFromUrl(""), null);
    assert.equal(backendOriginFromUrl(undefined), null);
  });
});
