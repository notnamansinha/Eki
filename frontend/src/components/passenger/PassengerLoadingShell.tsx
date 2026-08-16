import {
  passengerPanelClassName,
  passengerPanelStyle,
  passengerTopSpacerStyle,
} from "./passengerFrame";

export default function PassengerLoadingShell() {
  return (
    <div
      className="relative overflow-hidden text-white"
      style={{ height: "100dvh", backgroundColor: "var(--surface-0)" }}
      aria-hidden="true"
    >
      <picture className="pointer-events-none absolute inset-0 block">
        <source media="(max-width: 600px)" srcSet="/userpanel-480.webp" />
        {/* The native picture element provides a responsive static-export
            source set, which Next/Image cannot generate without an image server. */}
        <img
          src="/userpanel.webp"
          alt=""
          fetchPriority="high"
          decoding="async"
          className="h-full w-full object-cover"
          style={{ objectPosition: "center -24px" }}
        />
      </picture>

      <div className="absolute inset-0 z-10 flex flex-col pt-safe">
        <div
          className="shrink-0"
          style={passengerTopSpacerStyle}
          aria-hidden="true"
        />

        <div
          className={passengerPanelClassName}
          style={passengerPanelStyle}
        >
          <div className="mx-6 mb-4 shrink-0 pb-6 text-center">
            <h1
              id="passenger-loading-title"
              className="mb-2 text-[32px] font-black leading-none tracking-tight"
              style={{ color: "var(--text-primary)" }}
            >
              Live Routes
            </h1>
            <p
              className="mt-2 text-[15px] font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
              Restoring your transit session…
            </p>
          </div>

          <div className="mx-5 rounded-xl border border-white/5 bg-white/[0.03] px-5 py-6 text-center">
            <p className="text-[13px] font-semibold" style={{ color: "var(--text-tertiary)" }}>
              Loading live route information
            </p>
          </div>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center pb-safe" aria-hidden="true">
        <div
          className="flex w-full items-center justify-around rounded-t-[24px] border-t border-white/15 px-2 py-2.5"
          style={{ background: "rgba(22, 22, 26, 0.98)" }}
        >
          <div className="h-[60px] w-[140px] rounded-[20px] bg-white/[0.08]" />
          <div className="h-[60px] w-[140px] rounded-[20px]" />
        </div>
      </div>
    </div>
  );
}
