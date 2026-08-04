"use client";

import { useAuth } from "@/hooks/useAuth";
import { useDrivers } from "@/hooks/useDrivers";
import { CircleUserRound as User, BadgeCheck, MapPinned } from "lucide-react";

interface Props {
  driverId: string;
  busId: string;
  isTracking: boolean;
}

export default function DriverProfileTab({ driverId, busId, isTracking }: Props) {
  const { user } = useAuth();
  const { drivers } = useDrivers();
  
  const currentDriver = drivers.find(d => d.id === driverId);
  const displayPhotoUrl = currentDriver?.photoUrl || user?.photoURL;

  return (
    <div className="flex-1 overflow-y-auto flex flex-col pt-safe px-5" style={{ background: "var(--surface-0)" }}>
      <div className="w-full max-w-lg mx-auto space-y-6 mt-10 pb-32">
        
        {/* Profile Header */}
        <div className="p-6 rounded-2xl relative overflow-hidden"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
          <div className="flex flex-col items-center gap-5 relative z-10">
            
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center overflow-hidden relative"
              style={{ background: "var(--surface-3)", border: "1px solid var(--border-default)" }}
            >
              {displayPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayPhotoUrl} alt="Driver" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <User className="w-9 h-9" style={{ color: "var(--text-ghost)" }} />
              )}

            </div>

            <div className="text-center">
              <h2 className="text-xl font-extrabold tracking-tight mb-1.5" style={{ color: "var(--text-primary)" }}>
                {currentDriver?.name || `Driver ${driverId.replace("drv_", "#")}`}
              </h2>
              <div className="flex items-center justify-center gap-1.5">
                <BadgeCheck className="w-3.5 h-3.5" style={{ color: "#60A5FA" }} />
                <span className="text-[10px] font-semibold" style={{ color: "var(--text-ghost)", letterSpacing: "0.08em" }}>
                  AUTHORIZED OPERATOR
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Assignment Metrics */}
        <div className="rounded-xl overflow-hidden"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
          <div className="p-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <span className="text-[10px] font-semibold" style={{ color: "var(--text-ghost)" }}>
              Assignment
            </span>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-[13px] font-medium" style={{ color: "var(--text-tertiary)" }}>Active unit</span>
              <span className="font-semibold tabular-nums text-[13px] tracking-wide" style={{ color: "var(--text-secondary)" }}>
                {busId}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[13px] font-medium" style={{ color: "var(--text-tertiary)" }}>Duty status</span>
              {isTracking ? (
                <div className="status-live" style={{ fontSize: "10px", padding: "3px 10px" }}>
                  On shift
                </div>
              ) : (
                <span className="text-[10px] font-semibold px-2.5 py-1 rounded-md"
                  style={{ background: "var(--surface-3)", color: "var(--text-ghost)" }}>
                  Off duty
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl p-4 flex items-start gap-3"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
          <div className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center"
            style={{ background: "var(--status-live-bg)" }}>
            <MapPinned className="w-4 h-4" style={{ color: "var(--status-live)" }} />
          </div>
          <div>
            <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
              GNSS-controlled ride
            </p>
            <p className="mt-1 text-[11px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
              {isTracking
                ? "The ride stays active through signal or power interruptions and ends automatically after the final ordered stop."
                : "Select the assigned route and arm the ride before departure."}
            </p>
          </div>
        </div>
        
        <p className="text-center text-[10px] font-semibold pt-2" style={{ color: "var(--text-ghost)" }}>
          Operator ID: {driverId.toUpperCase()}
        </p>
      </div>
    </div>
  );
}
