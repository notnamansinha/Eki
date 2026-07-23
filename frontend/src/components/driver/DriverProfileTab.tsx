"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useDrivers } from "@/hooks/useDrivers";
import { CircleUserRound as User, LogOut, BadgeCheck } from "lucide-react";

interface Props {
  driverId: string;
  busId: string;
  onStopTracking: () => void;
  isTracking: boolean;
}

export default function DriverProfileTab({ driverId, busId, onStopTracking, isTracking }: Props) {
  const { user } = useAuth();
  const { drivers } = useDrivers();
  const [showEndShiftConfirm, setShowEndShiftConfirm] = useState(false);
  
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

        {/* Actions */}
        <div className="rounded-xl overflow-hidden"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
          <button
            aria-label="End shift and go offline"
            disabled={!isTracking}
            onClick={() => setShowEndShiftConfirm(true)}
            className="w-full flex items-center justify-between p-4 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: "transparent" }}
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: "var(--status-danger-bg)" }}>
                <LogOut className="w-4 h-4" style={{ color: "var(--status-danger)" }} />
              </div>
              <span className="text-[13px] font-semibold" style={{ color: isTracking ? "var(--status-danger)" : "var(--text-ghost)" }}>
                {isTracking ? "End Shift" : "Not on shift"}
              </span>
            </div>
          </button>
        </div>
        
        <p className="text-center text-[10px] font-semibold pt-2" style={{ color: "var(--text-ghost)" }}>
          Operator ID: {driverId.toUpperCase()}
        </p>
      </div>

      {showEndShiftConfirm && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowEndShiftConfirm(false)}>
          <div className="p-5 rounded-2xl w-[280px] text-center flex flex-col gap-4 shadow-2xl" 
               style={{ background: "var(--surface-1)", border: "1px solid var(--surface-2)" }} 
               onClick={e => e.stopPropagation()}>
            <div className="flex flex-col gap-2">
              <h3 className="font-bold text-base" style={{ color: "var(--text-primary)" }}>End Shift?</h3>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Are you sure you want to end your tracking session? Passengers will no longer see this bus.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowEndShiftConfirm(false)} className="flex-1 py-2.5 rounded-xl text-xs font-semibold"
                style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}>
                Cancel
              </button>
              <button onClick={() => { setShowEndShiftConfirm(false); onStopTracking(); }} className="flex-1 py-2.5 rounded-xl text-xs font-semibold"
                style={{ background: "var(--status-danger)", color: "white" }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
