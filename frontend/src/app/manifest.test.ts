import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

// layout.tsx loads next/font, which only runs inside the Next.js compiler.
const layoutSource = readFileSync(join(__dirname, "layout.tsx"), "utf8");

describe("web app manifest", () => {
  // Android paints the installed app's gesture-bar strip with the manifest
  // theme_color on every page. It must match the dark start page, or the
  // sign-in painting ends above a coloured band (the old orange #FA5D29).
  it("colours the installed app's system bars like the dark start page", () => {
    const { theme_color, background_color, start_url } = manifest();
    expect(start_url).toBe("/");
    expect(theme_color).toBe("#09090b");
    expect(background_color).toBe(theme_color);
    expect(layoutSource).toMatch(/themeColor:\s*"#09090b"/);
  });
});
