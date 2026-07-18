"use client";

import { useState } from "react";
import { doc, updateDoc, arrayUnion } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { RouteData } from "@/hooks/useRoutes";
import { ChevronDown, Loader2, CheckCircle2 } from "lucide-react";

interface Props {
  sessionId: string;
  route: RouteData;
  userId: string;
  userName: string;
  onBoarded: () => void;
}

const formatStopName = (name: string) => {
  const parts = name.split(/[ ,-]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return name;
};

export default function PassengerBoardingView({ sessionId, route, userId, userName, onBoarded }: Props) {
  const [boardingStopId, setBoardingStopId] = useState<string>("");
  const [alightingStopId, setAlightingStopId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleJoin = async () => {
    if (!boardingStopId) return;
    setLoading(true);
    
    try {
      const sessionRef = doc(db, "ride_sessions", sessionId);
      await updateDoc(sessionRef, {
        passengers: arrayUnion({
          userId,
          userName,
          boardingStopId,
          alightingStopId: alightingStopId || null,
          joinedAt: Date.now()
        })
      });
      setSuccess(true);
      setTimeout(() => {
        onBoarded();
      }, 1500);
    } catch (error) {
      console.error("Failed to join ride", error);
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="mx-4 mt-6 p-4 rounded-2xl flex flex-col items-center justify-center animate-fade-in pointer-events-auto" style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}>
        <CheckCircle2 className="w-8 h-8 mb-2" style={{ color: "var(--status-live)" }} />
        <p className="text-[14px] font-bold" style={{ color: "var(--text-primary)" }}>You're on board!</p>
        <p className="text-[11px]" style={{ color: "var(--text-ghost)" }}>Have a safe journey.</p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 w-full animate-fade-in pointer-events-auto">
      <div className="flex flex-col flex-1 gap-1.5">
        <div className="relative">
          <select
            value={boardingStopId}
            onChange={(e) => setBoardingStopId(e.target.value)}
            className="w-full h-8 rounded-md pl-2 pr-6 text-[12px] font-semibold focus:outline-none appearance-none transition-all truncate"
            style={{ background: "rgba(255,255,255,0.15)", color: "white", border: "1px solid rgba(255,255,255,0.2)", backdropFilter: "blur(8px)" }}
          >
            <option value="" style={{ color: "#000" }}>From (Boarding)...</option>
            {route.stops?.map(stop => (
              <option key={stop.id} value={stop.id} style={{ color: "#000" }}>{formatStopName(stop.name)}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" style={{ color: "rgba(255,255,255,0.7)" }} />
        </div>
        <div className="relative">
          <select
            value={alightingStopId}
            onChange={(e) => setAlightingStopId(e.target.value)}
            className="w-full h-8 rounded-md pl-2 pr-6 text-[12px] font-semibold focus:outline-none appearance-none transition-all truncate"
            style={{ background: "rgba(255,255,255,0.15)", color: "white", border: "1px solid rgba(255,255,255,0.2)", backdropFilter: "blur(8px)" }}
          >
            <option value="" style={{ color: "#000" }}>To (Destination)...</option>
            {route.stops?.map(stop => (
              <option key={stop.id} value={stop.id} style={{ color: "#000" }}>{formatStopName(stop.name)}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" style={{ color: "rgba(255,255,255,0.7)" }} />
        </div>
      </div>

      <button
        onClick={handleJoin}
        disabled={!boardingStopId || loading}
        className="h-[70px] w-[60px] rounded-lg font-bold text-[13px] transition-all flex flex-col items-center justify-center shrink-0 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: "var(--accent)", color: "var(--surface-0)" }}
      >
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "JOIN"}
      </button>
    </div>
  );
}
