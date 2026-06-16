"use client";

import React from "react";
import {
  ArrowUp,
  CornerUpLeft as TurnLeft,
  CornerUpRight as TurnRight,
  RefreshCw,
  MapPin,
  Loader2,
} from "lucide-react";

export interface NavBannerProps {
  instruction: string;
  distanceToTurn: string;
  maneuver: string; // raw value from DirectionsStep.maneuver
  isRerouting: boolean;
}

function ManeuverIcon({ maneuver }: { maneuver: string }) {
  const cls = "w-6 h-6";
  const m = maneuver?.toLowerCase() || "";
  
  if (m.includes("left")) return <TurnLeft className={cls} />;
  if (m.includes("right")) return <TurnRight className={cls} />;
  if (m.includes("roundabout") || m.includes("u-turn")) return <RefreshCw className={cls} />;
  if (m.includes("destination")) return <MapPin className={cls} />;
  
  return <ArrowUp className={cls} />;
}

const NavInstructionBanner = React.memo(function NavInstructionBanner({
  instruction,
  distanceToTurn,
  maneuver,
  isRerouting,
}: NavBannerProps) {
  if (!instruction && !isRerouting) return null;

  return (
    <div
      className="absolute top-8 left-1/2 z-[1000]"
      style={{ transform: "translateX(-50%)", width: "calc(100% - 48px)", maxWidth: 460 }}
    >
      <div className="bg-brand-surface/95 border border-white/5 rounded-[1.5rem] shadow-3xl flex items-center gap-4 px-6 py-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 blur-[50px] pointer-events-none" />
        
        {isRerouting ? (
          <>
            <div className="shrink-0 w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
            </div>
            <div className="flex-1 min-w-0">
               <p className="text-[10px] font-black tracking-widest text-white/20 uppercase mb-1 leading-none">Topology Sync</p>
               <p className="text-white font-bold text-sm tracking-tight leading-snug truncate">
                Recalculating optimal path...
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="shrink-0 w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-xl">
               <div className="text-brand-dark">
                <ManeuverIcon maneuver={maneuver} />
               </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                 <p className="text-[10px] font-black tracking-widest text-white/20 uppercase leading-none">Instruction</p>
                 <p className="text-blue-400 text-[10px] font-black uppercase tracking-widest leading-none">{distanceToTurn || "—"}</p>
              </div>
              <p
                className="text-white font-bold text-sm tracking-tight leading-snug truncate"
                dangerouslySetInnerHTML={{ __html: instruction || "Continue straightforward" }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
});

export default NavInstructionBanner;
