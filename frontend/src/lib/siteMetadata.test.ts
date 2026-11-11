import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSiteOrigin } from "./siteMetadata";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
afterEach(() => vi.unstubAllEnvs());
describe("canonical public origin", () => {
  it("retains the documented primary Hosting fallback", () => {
    expect(resolveSiteOrigin(undefined)).toBe("https://bustrack-be165.web.app");
  });
  it("normalizes an HTTPS custom origin", () => {
    expect(resolveSiteOrigin(" https://BUS.example.edu:443/ ")).toBe("https://bus.example.edu");
  });
  it.each(["invalid", "https://user:pass@example.edu", "https://example.edu/path",
    "https://example.edu?x=1", "https://example.edu#x", "http://example.edu",
    "javascript:alert(1)", "http://localhost:3000"])("rejects invalid production origins: %s", value => {
      expect(() => resolveSiteOrigin(value, true)).toThrow();
    });
  it("permits HTTP loopback only outside production", () => {
    expect(resolveSiteOrigin("http://localhost:3000", false)).toBe("http://localhost:3000");
  });
  it("uses the same configured origin for robots and sitemap", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bus.example.edu");
    vi.stubEnv("NEXT_PUBLIC_SITE_INDEXING", "true");
    expect(robots().sitemap).toBe("https://bus.example.edu/sitemap.xml");
    expect(sitemap()[0].url).toBe("https://bus.example.edu/");
  });
  it("lists the landing page and the public install guide in the sitemap", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bus.example.edu");
    vi.stubEnv("NEXT_PUBLIC_SITE_INDEXING", "true");
    expect(sitemap().map(entry => entry.url)).toEqual(["https://bus.example.edu/", "https://bus.example.edu/install"]);
    expect(robots().rules).toMatchObject({ allow: "/" });
    expect(JSON.stringify(robots().rules)).not.toContain("/install");
  });
  it("excludes staging builds from indexing and sitemap discovery", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_INDEXING", "false");
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    expect(sitemap()).toEqual([]);
  });
});
