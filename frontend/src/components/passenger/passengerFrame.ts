import type { CSSProperties } from "react";

export const passengerTopSpacerStyle: CSSProperties = {
  height: "34vh",
  minHeight: "250px",
};

export const passengerPanelClassName =
  "relative mx-4 mb-[110px] flex flex-1 flex-col overflow-hidden rounded-[32px] pt-8 shadow-2xl";

export const passengerPanelStyle: CSSProperties = {
  background: "linear-gradient(180deg, #1c1c1e 0%, #151517 100%)",
  borderTop: "1px solid rgba(255, 255, 255, 0.12)",
  borderLeft: "1px solid rgba(255, 255, 255, 0.04)",
  borderRight: "1px solid rgba(255, 255, 255, 0.04)",
  boxShadow: "0 12px 48px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.05)",
};
