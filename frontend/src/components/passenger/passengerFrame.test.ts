import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PASSENGER_NAV_HEIGHT_PX,
  PASSENGER_PANEL_NAV_GAP_PX,
  passengerNavClearance,
  passengerNavHeight,
  passengerPanelStyle,
} from "./passengerFrame";

describe("passenger frame geometry", () => {
  it("derives panel clearance from the navigation height plus the bottom safe area", () => {
    expect(passengerNavHeight).toBe(`var(--passenger-nav-height, ${PASSENGER_NAV_HEIGHT_PX}px)`);
    expect(passengerNavClearance).toBe(`calc(${passengerNavHeight} + var(--safe-area-bottom))`);
    const mobilePanelBottom = `calc(${passengerNavHeight} + ${PASSENGER_PANEL_NAV_GAP_PX}px + var(--safe-area-bottom))`;
    expect(passengerPanelStyle.marginBottom)
      .toBe(`var(--passenger-home-panel-bottom, ${mobilePanelBottom})`);
    expect(PASSENGER_PANEL_NAV_GAP_PX).toBeGreaterThan(0);
  });
  it("feeds safe-area utilities and clearance from one shared inset value", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/--safe-area-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)/);
    expect(css).toMatch(/\.pb-safe\s*{\s*padding-bottom:\s*var\(--safe-area-bottom\)/);
    expect(css).toMatch(/\.pt-safe\s*{\s*padding-top:\s*var\(--safe-area-top\)/);
  });
  it("sizes the touch bar and its clearance in the same media query", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(css).toMatch(/:root\s*{\s*--passenger-nav-height:\s*81px;\s*}/);
    const touch = css.split("@media not all and (any-pointer: fine) {")[1] ?? "";
    expect(touch).toMatch(/^\s*:root\s*{\s*--passenger-nav-height:\s*69px;\s*}/);
    // The 68px bar plus the frame's 1px top border.
    expect(touch).toMatch(/\.passenger-nav-bar\s*{\s*height:\s*68px;/);
  });
});
