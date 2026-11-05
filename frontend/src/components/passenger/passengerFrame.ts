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

// The variables let the desktop layout and short landscape touch screens retune
// the artwork band and the panel's bottom edge (globals.css).
export const passengerTopSpacerStyle: CSSProperties = {
  height: "var(--passenger-home-art-height, 34vh)",
  minHeight: "var(--passenger-home-art-min-height, min(250px, 20dvh))",
};

export const passengerPanelClassName =
  "passenger-home-panel relative mx-4 flex flex-1 flex-col overflow-hidden pt-8";

// Surface, border and shadow come from app/passenger/theme.css.
export const passengerPanelStyle: CSSProperties = {
  marginBottom: `var(--passenger-home-panel-bottom, calc(${passengerNavHeight} + var(--passenger-panel-nav-gap, ${PASSENGER_PANEL_NAV_GAP_PX}px) + var(--safe-area-bottom)))`,
};

// The frame owns the surface colour so the safe-area padding beneath the bar
// is painted too, instead of exposing the illustration behind it.
export const passengerNavFrameClassName =
  "passenger-nav-frame absolute inset-x-0 bottom-0 flex justify-center rounded-t-[24px] pb-safe";

export const passengerNavClassName = "passenger-nav-bar flex h-20 w-full items-center justify-around px-2 py-2.5";
