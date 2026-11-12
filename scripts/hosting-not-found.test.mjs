import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const firebase = JSON.parse(await readFile(new URL("../firebase.json", import.meta.url), "utf8"));
const rules = firebase.hosting.headers;

const withSlash = (source) => (source.startsWith("/") ? source : `/${source}`);
const matching = (pathname) => rules.filter((rule) => path.posix.matchesGlob(pathname, withSlash(rule.source)));

/**
 * The headers Hosting sends with its custom 404 page. Hosting matches header
 * rules against `404.html` for that page (Firebase documents `404.html` as the
 * `source` for it) and also against the requested path; the Hosting emulator
 * applies the requested path's rules last, so they win on a conflict.
 */
function notFoundHeaders(requestPath) {
  const headers = new Map();
  for (const rule of [...matching("/404.html"), ...matching(requestPath)]) {
    for (const { key, value } of rule.headers) headers.set(key.toLowerCase(), value);
  }
  return headers;
}

const directives = (value = "") => value.split(",").map((part) => part.trim().toLowerCase());

describe("Hosting 404 response", () => {
  it("gives the custom 404 page an explicit no-store cache policy", () => {
    const rule = rules.find((entry) => withSlash(entry.source) === "/404.html");
    assert.ok(rule, "firebase.json needs a header rule for 404.html");
    const cacheControl = rule.headers.find((header) => header.key === "Cache-Control")?.value;
    assert.ok(directives(cacheControl).includes("no-store"), `404.html Cache-Control is "${cacheControl}"`);
  });

  it("does not let a missing page fall back to the default one-hour cache", () => {
    for (const requestPath of ["/eki-no-such-page", "/passenger/no-such-page", "/install/extra/segment"]) {
      const cacheControl = notFoundHeaders(requestPath).get("cache-control");
      assert.ok(directives(cacheControl).includes("no-store"), `${requestPath}: Cache-Control is "${cacheControl}"`);
      assert.ok(!directives(cacheControl).some((d) => d.startsWith("max-age=") && d !== "max-age=0"), requestPath);
    }
  });

  it("keeps the security headers on the 404 page", () => {
    const headers = notFoundHeaders("/eki-no-such-page");
    for (const key of ["content-security-policy", "x-frame-options", "x-content-type-options", "strict-transport-security"]) {
      assert.ok(headers.has(key), `missing ${key}`);
    }
  });

  it("leaves long-lived caching of fingerprinted assets alone", () => {
    const assetRules = matching("/_next/static/chunks/app.js");
    assert.ok(assetRules.every((rule) => withSlash(rule.source) !== "/404.html"));
    const cacheControl = assetRules.flatMap((rule) => rule.headers).findLast((header) => header.key === "Cache-Control");
    assert.equal(cacheControl?.value, "public, max-age=31536000, immutable");
  });
});
