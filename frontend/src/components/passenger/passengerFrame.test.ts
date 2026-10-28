import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PASSENGER_NAV_HEIGHT_PX,
  PASSENGER_PANEL_NAV_GAP_PX,
  passengerNavClearance,
  passengerPanelStyle,
} from "./passengerFrame";

describe("passenger frame geometry", () => {
  it("derives panel clearance from the navigation height plus the bottom safe area", () => {
    expect(passengerNavClearance).toBe(`calc(${PASSENGER_NAV_HEIGHT_PX}px + var(--safe-area-bottom))`);
    expect(passengerPanelStyle.marginBottom)
      .toBe(`calc(${PASSENGER_NAV_HEIGHT_PX + PASSENGER_PANEL_NAV_GAP_PX}px + var(--safe-area-bottom))`);
    expect(PASSENGER_PANEL_NAV_GAP_PX).toBeGreaterThan(0);
  });
  it("feeds safe-area utilities and clearance from one shared inset value", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/--safe-area-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)/);
    expect(css).toMatch(/\.pb-safe\s*{\s*padding-bottom:\s*var\(--safe-area-bottom\)/);
    expect(css).toMatch(/\.pt-safe\s*{\s*padding-top:\s*var\(--safe-area-top\)/);
  });
});
