import TransitArtwork from "@/components/shared/TransitArtwork";
import {
  passengerNavClassName,
  passengerNavFrameClassName,
  passengerPanelClassName,
  passengerPanelStyle,
  passengerTopSpacerStyle,
} from "./passengerFrame";

export default function PassengerLoadingShell() {
  return (
    <div
      className="relative overflow-hidden"
      style={{ height: "100dvh", backgroundColor: "var(--surface-0)" }}
      aria-hidden="true"
    >
      <TransitArtwork />

      <div data-passenger-loading-placeholder className="passenger-home absolute inset-0 z-10 flex flex-col pt-safe">
        <div
          className="shrink-0"
          style={passengerTopSpacerStyle}
          aria-hidden="true"
        />

        <div
          className={passengerPanelClassName}
          style={passengerPanelStyle}
        >
          <div className="passenger-home-heading pp-home-heading mx-6 mb-3 shrink-0 pb-5">
            <h1 className="pp-title">Live routes</h1>
            <p className="pp-subtitle">Restoring your transit session…</p>
            <hr className="pp-rule" aria-hidden="true" />
          </div>

          <div className="pp-empty mx-5">
            <p className="pp-empty-detail">Loading live route information</p>
          </div>
        </div>
      </div>

      <div
        data-passenger-loading-placeholder
        className={`${passengerNavFrameClassName} z-20`}
        aria-hidden="true"
      >
        <div className={passengerNavClassName}>
          <div className="h-[52px] w-[120px] rounded-[16px] bg-[var(--surface-4)]" />
          <div className="h-[60px] w-[140px] rounded-[20px]" />
        </div>
      </div>
    </div>
  );
}
