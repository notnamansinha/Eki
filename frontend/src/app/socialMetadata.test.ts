import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";

// layout.tsx loads next/font, which only runs inside the Next.js compiler, and
// mounts the app providers. Stub both so the test reads the exported metadata.
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "", className: "" });
  return { Roboto: font, Playfair_Display: font };
});
vi.mock("@/components/Providers", () => ({ default: () => null }));
vi.mock("@/components/ServiceWorkerRegistrar", () => ({ default: () => null }));

type Image = { url: string; width?: number; height?: number; alt?: string; type?: string };
const asArray = (value: unknown): Image[] => (Array.isArray(value) ? value : value ? [value] : []) as Image[];

/** Width and height from a baseline or progressive JPEG start-of-frame marker. */
function jpegSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  let offset = 2;
  while (offset < bytes.length) {
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error("No JPEG start-of-frame marker");
}

function expectLandscapeCard(metadata: Metadata, path: string) {
  const og = metadata.openGraph as { url?: string; images?: unknown } | undefined;
  expect(og?.url).toBe(path);
  const [ogImage, ...extraOg] = asArray(og?.images);
  expect(extraOg).toEqual([]);
  expect(ogImage).toMatchObject({ url: "/images/social-card.jpg", width: 1200, height: 630, type: "image/jpeg" });
  expect(ogImage.alt).toMatch(/\S/);

  const twitter = metadata.twitter as { card?: string; images?: unknown } | undefined;
  expect(twitter?.card).toBe("summary_large_image");
  const [twitterImage, ...extraTwitter] = asArray(twitter?.images);
  expect(extraTwitter).toEqual([]);
  expect(twitterImage).toMatchObject({ url: ogImage.url, width: 1200, height: 630, alt: ogImage.alt });
}

describe("public page social cards", () => {
  it("advertises the landscape social card at the landing URL", async () => {
    const { metadata } = await import("./layout");
    expect(metadata.alternates?.canonical).toBe("/");
    expectLandscapeCard(metadata, "/");
  });

  it("gives /install its own canonical, og:url and card instead of the homepage's", async () => {
    const { metadata } = await import("./install/page");
    expect(metadata.alternates?.canonical).toBe("/install");
    expectLandscapeCard(metadata, "/install");
    const og = metadata.openGraph as { title?: string; description?: string };
    expect(og.title).toBe("Install Eki");
    expect(og.description).toBe(metadata.description);
  });

  it("ships a 1200x630 JPEG at the advertised path", () => {
    const file = fileURLToPath(new URL("../../public/images/social-card.jpg", import.meta.url));
    const bytes = readFileSync(file);
    expect(jpegSize(bytes)).toEqual({ width: 1200, height: 630 });
    // Keep the card quick to fetch for link-preview crawlers.
    expect(bytes.length).toBeLessThan(300 * 1024);
  });
});
