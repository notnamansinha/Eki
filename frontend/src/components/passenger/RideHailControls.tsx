"use client";

import { useState, useCallback } from "react";
import { MapPin, MapPinned, Loader2, CheckCircle, Navigation, X, AlertCircle } from "lucide-react";
import { db } from "@/lib/firebase";
import { collection, addDoc } from "firebase/firestore";

type Mode = "pickup" | "dropoff" | null;
type RequestStatus = "idle" | "pending" | "accepted" | "completed";

interface Props {
  onModeChange?: (mode: Mode) => void;
  pendingLocation?: { lat: number; lng: number } | null;
}

export default function RideHailControls({ onModeChange, pendingLocation }: Props) {
  const [mode, setMode] = useState<Mode>(null);
  const [status, setStatus] = useState<RequestStatus>("idle");
  const [busId] = useState("BUS-001"); 

  function selectMode(m: Mode) {
    setMode(m);
    onModeChange?.(m);
    setStatus("idle");
  }

  const confirmRequest = useCallback(async () => {
    if (!pendingLocation) return;
    setStatus("pending");

    try {
      await addDoc(collection(db, "passenger_requests"), {
        passengerId: `pax_${Date.now()}`,
        busId,
        type: mode === "pickup" ? "pickup" : "dropoff",
        lat: pendingLocation.lat,
        lng: pendingLocation.lng,
        status: "pending",
        createdAt: Date.now(),
      });
      // Simulate real-time operator sync
      setTimeout(() => setStatus("accepted"), 1500);
    } catch (err) {
      console.error("Failed to request ride:", err);
      setStatus("idle");
    }
  }, [mode, pendingLocation, busId]);

  const cancel = () => {
    setMode(null);
    setStatus("idle");
    onModeChange?.(null);
  };

  const statusLabels: Record<RequestStatus, { label: string; color: string; bg: string; icon: any; message: string }> = {
    idle:     { label: "Set Location", color: "text-white/70", bg: "bg-white/5", icon: MapPin, message: "Tap map to pinpoint." },
    pending:  { label: "Dispatching...", color: "text-brand-accent", bg: "bg-brand-accent/20", icon: Loader2, message: "Syncing with operator" },
    accepted: { label: "Accepted", color: "text-emerald-400", bg: "bg-emerald-500/20", icon: Navigation, message: "Operator synchronized" },
    completed:{ label: "Completed", color: "text-emerald-400", bg: "bg-emerald-500/20", icon: CheckCircle, message: "Request finalized" },
  };

  const current = statusLabels[status];
  const Icon = current.icon;

  return (
    <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[1000] w-full max-w-sm px-6 pointer-events-auto">
      <div className="glass-panel rounded-[2rem] overflow-hidden animate-slide-up relative">

        {/* Ambient Glow for accepted state */}
        {status === "accepted" && (
          <div className="absolute inset-0 bg-emerald-500/10 blur-xl pointer-events-none" />
        )}

        {/* Mode Selector */}
        <div className="flex bg-black/40 p-1.5 rounded-[1.5rem] m-3 relative z-10">
          {(["pickup", "dropoff"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => selectMode(mode === m ? null : m)}
              disabled={status !== "idle"}
              className={`flex-1 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-[0.15em] transition-all duration-300 flex items-center justify-center gap-2 ${
                mode === m
                  ? "bg-white text-brand-dark shadow-xl scale-[1.02]"
                  : "text-white/50 hover:text-white/80 disabled:opacity-30 disabled:scale-100"
              }`}
            >
              {m === "pickup" ? <MapPin className="w-3.5 h-3.5" /> : <MapPinned className="w-3.5 h-3.5" />}
              {m === "pickup" ? "Pickup" : "Drop-off"}
            </button>
          ))}
        </div>

        {/* Status Area */}
        <div className="px-6 pb-6 pt-2 relative z-10">
          {mode ? (
            <div className="space-y-5 animate-scale-in">
              <div className="flex items-center gap-4 bg-white/5 p-4 rounded-[1.5rem] border border-white/10">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${current.bg} ${current.color} shadow-inner`}>
                   <Icon className={`w-6 h-6 ${status === 'pending' ? 'animate-spin' : ''}`} />
                </div>
                <div className="flex-1 min-w-0">
                   <p className={`text-xs font-black uppercase tracking-widest ${current.color} truncate`}>
                    {current.label}
                  </p>
                  <div className="text-[10px] text-white/50 font-semibold uppercase tracking-widest mt-1 flex items-center gap-1.5">
                    {status === "idle" && !pendingLocation ? (
                      <><AlertCircle className="w-3 h-3 text-amber-500" /> Tap map to select location</>
                    ) : (
                      current.message
                    )}
                  </div>
                </div>
              </div>

              {pendingLocation && status === "idle" && (
                <div className="flex gap-2">
                  <button
                    onClick={confirmRequest}
                    className="flex-1 py-4 rounded-2xl text-xs font-black uppercase tracking-[0.2em] bg-brand-accent text-brand-dark transition-all hover:bg-yellow-400 active:scale-95 shadow-glow"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={cancel}
                    className="w-14 h-14 rounded-2xl flex items-center justify-center bg-white/5 border border-white/10 text-white/50 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20 active:scale-95 transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              )}

              {(status === "accepted" || status === "completed") && (
                <button 
                  onClick={cancel} 
                  className="w-full py-3.5 rounded-xl text-[10px] font-black text-white/50 hover:text-white uppercase tracking-[0.2em] transition-all bg-white/5 hover:bg-white/10"
                >
                  Dismiss
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center py-6 opacity-30">
               <div className="w-1.5 h-1.5 rounded-full bg-white mb-3 shadow-[0_0_10px_rgba(255,255,255,0.5)]" />
               <p className="text-[10px] font-black text-white uppercase tracking-[0.3em]">Select Operation Type</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
