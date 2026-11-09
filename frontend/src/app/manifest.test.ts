import { describe, expect, it, vi } from "vitest";
import manifest from "./manifest";

// layout.tsx loads next/font, which only runs inside the Next.js compiler, and
// mounts the app providers. Stub both so the test reads the exported viewport.
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "", className: "" });
  return { Roboto: font, Playfair_Display: font };
});
vi.mock("@/components/Providers", () => ({ default: () => null }));
vi.mock("@/components/ServiceWorkerRegistrar", () => ({ default: () => null }));

describe("web app manifest", () => {
  // Android paints the installed app's gesture-bar strip with the manifest
  // theme_color on every page. It must match the dark start page, or the
  // sign-in painting ends above a coloured band (the old orange #FA5D29).
  it("colours the installed app's system bars like the dark start page", async () => {
    const { theme_color, background_color, start_url } = manifest();
    expect(start_url).toBe("/");
    expect(theme_color).toBe("#09090b");
    expect(background_color).toBe(theme_color);
    const { viewport } = await import("./layout");
    expect(viewport.themeColor).toBe(theme_color);
  });
});
