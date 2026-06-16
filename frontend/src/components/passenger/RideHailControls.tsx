"use client";

import { useState, useCallback } from "react";
import { MapPin, MapPinned, Loader2, CheckCircle, Navigation, X } from "lucide-react";

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
      const { io } = await import("socket.io-client");
      const socket = io(process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000", {
        transports: ["websocket"],
      });
      socket.emit("passenger:request", {
        passengerId: `pax_${Date.now()}`,
        busId,
        type: mode === "pickup" ? "pickup" : "dropoff",
        lat: pendingLocation.lat,
        lng: pendingLocation.lng,
      });
      socket.on("request:updated", () => setStatus("accepted"));
      setTimeout(() => setStatus("accepted"), 1500);
    } catch {
      setStatus("idle");
    }
  }, [mode, pendingLocation, busId]);

  const cancel = () => {
    setMode(null);
    setStatus("idle");
    onModeChange?.(null);
  };

  const statusLabels: Record<RequestStatus, { label: string; color: string; icon: any }> = {
    idle:     { label: "Define Precise Location", color: "text-white/40", icon: MapPin },
    pending:  { label: "Dispatching Request...",    color: "text-amber-400", icon: Loader2 },
    accepted: { label: "Operator En Route",   color: "text-emerald-400", icon: Navigation },
    completed:{ label: "Request Finalized",           color: "text-emerald-400", icon: CheckCircle },
  };

  const current = statusLabels[status];
  const Icon = current.icon;

  return (
    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[1000] w-full max-w-sm px-6">
      <div className="bg-brand-surface/90 backdrop-blur-2xl rounded-[1.5rem] border border-white/5 shadow-3xl overflow-hidden animate-slide-up">

        {/* Mode Selector - Charcoal Mono Style */}
        <div className="flex bg-white/5 p-1 rounded-2xl m-3 gap-1">
          {(["pickup", "dropoff"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => selectMode(mode === m ? null : m)}
              className={`flex-1 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2 ${
                mode === m
                  ? "bg-white text-brand-dark shadow-xl"
                  : "text-white/30 hover:text-white/60"
              }`}
            >
              {m === "pickup" ? <MapPin className="w-3.5 h-3.5" /> : <MapPinned className="w-3.5 h-3.5" />}
              {m === "pickup" ? "Pickup" : "Drop-off"}
            </button>
          ))}
        </div>

        {/* Status Area */}
        <div className="px-8 pb-8 pt-4">
          {mode ? (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center ${current.color}`}>
                   <Icon className={`w-5 h-5 ${status === 'pending' ? 'animate-spin' : ''}`} />
                </div>
                <div>
                   <p className={`text-xs font-bold uppercase tracking-widest ${current.color}`}>
                    {current.label}
                  </p>
                  {pendingLocation && status === "idle" && (
                    <div className="text-[10px] text-white/20 font-mono tracking-tight mt-1">
                      {pendingLocation.lat.toFixed(5)}, {pendingLocation.lng.toFixed(5)}
                    </div>
                  )}
                </div>
              </div>

              {pendingLocation && status === "idle" && (
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={confirmRequest}
                    className="flex-1 py-4 rounded-2xl text-xs font-black uppercase tracking-widest bg-white text-brand-dark transition transform active:scale-95 shadow-xl"
                  >
                    Confirm Request
                  </button>
                  <button
                    onClick={cancel}
                    className="w-14 h-14 rounded-2xl flex items-center justify-center bg-white/5 border border-white/5 text-white/30 hover:text-red-400 hover:bg-white/10 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              )}

              {status === "accepted" && (
                <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-2xl">
                  <span className="text-[10px] text-emerald-400 font-black uppercase tracking-widest">Operator Synchronized</span>
                  <button onClick={cancel} className="text-[10px] font-black text-white/20 hover:text-white/40 uppercase tracking-widest transition-colors">
                    Close
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center py-4 opacity-20">
               <div className="w-1 h-1 rounded-full bg-white mb-2" />
               <p className="text-[10px] font-black text-white uppercase tracking-[0.3em]">Select Operation Type</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
