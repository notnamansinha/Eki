import type { CSSProperties } from "react";

/**
 * Fallback navigation height above the safe area: 1px border + 80px bar.
 * globals.css sets `--passenger-nav-height` to the height the current input
 * device actually gets (69px on touch screens, 81px for the desktop dock).
 */
export const PASSENGER_NAV_HEIGHT_PX = 81;
/** Navigation height above the safe area, following the CSS media query. */
export const passengerNavHeight = `var(--passenger-nav-height, ${PASSENGER_NAV_HEIGHT_PX}px)`;
/** Visible gap between the transit panel and the bottom navigation. */
export const PASSENGER_PANEL_NAV_GAP_PX = 29;
/** Distance from the viewport bottom to the navigation's top edge. */
export const passengerNavClearance = `calc(${passengerNavHeight} + var(--safe-area-bottom))`;

export const passengerTopSpacerStyle: CSSProperties = {
  height: "var(--passenger-home-art-height, 34vh)",
  minHeight: "var(--passenger-home-art-min-height, min(250px, 20dvh))",
};

export const passengerPanelClassName =
  "passenger-home-panel relative mx-4 flex flex-1 flex-col overflow-hidden rounded-[32px] pt-8 shadow-2xl";

export const passengerPanelStyle: CSSProperties = {
  marginBottom: `var(--passenger-home-panel-bottom, calc(${passengerNavHeight} + ${PASSENGER_PANEL_NAV_GAP_PX}px + var(--safe-area-bottom)))`,
  background: "linear-gradient(180deg, #1c1c1e 0%, #151517 100%)",
  borderTop: "1px solid rgba(255, 255, 255, 0.12)",
  borderLeft: "1px solid rgba(255, 255, 255, 0.04)",
  borderRight: "1px solid rgba(255, 255, 255, 0.04)",
  boxShadow: "0 12px 48px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.05)",
};

// The frame owns the surface colour so the safe-area padding beneath the bar
// is painted too, instead of exposing the illustration behind it.
export const passengerNavFrameClassName =
  "passenger-nav-frame absolute inset-x-0 bottom-0 flex justify-center rounded-t-[24px] pb-safe";

export const passengerNavClassName = "passenger-nav-bar flex h-20 w-full items-center justify-around px-2 py-2.5";
