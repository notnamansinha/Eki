"use client";

import { useState, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useDrivers } from "@/hooks/useDrivers";
import { db, storage } from "@/lib/firebase";
import { doc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { CircleUserRound as User, LogOut, BadgeCheck, Camera, Loader2 } from "lucide-react";

interface Props {
  driverId: string;
  busId: string;
  onStopTracking: () => void;
  isTracking: boolean;
}

export default function DriverProfileTab({ driverId, busId, onStopTracking, isTracking }: Props) {
  const { user } = useAuth();
  const { drivers } = useDrivers();
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const currentDriver = drivers.find(d => d.id === driverId);
  const displayPhotoUrl = currentDriver?.photoUrl || user?.photoURL;

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      const storageRef = ref(storage, `drivers/${driverId}-profile`);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      
      await updateDoc(doc(db, "drivers", driverId), {
        photoUrl: downloadURL
      });
    } catch (error) {
      console.error("Error uploading photo:", error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto flex flex-col pt-safe px-5" style={{ background: "var(--surface-0)" }}>
      <div className="w-full max-w-lg mx-auto space-y-6 mt-10 pb-32">
        
        {/* Profile Header */}
        <div className="p-6 rounded-2xl relative overflow-hidden"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
          <div className="flex flex-col items-center gap-5 relative z-10">
            
            <div 
              className="w-20 h-20 rounded-full flex items-center justify-center overflow-hidden relative cursor-pointer group"
              style={{ background: "var(--surface-3)", border: "1px solid var(--border-default)" }}
              onClick={() => fileInputRef.current?.click()}
            >
              {displayPhotoUrl ? (
                <img src={displayPhotoUrl} alt="Driver" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <User className="w-9 h-9" style={{ color: "var(--text-ghost)" }} />
              )}

              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: "rgba(0,0,0,0.55)" }}>
                {isUploading ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Camera className="w-5 h-5 text-white" />}
              </div>
              
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handlePhotoUpload} 
                accept="image/*" 
                className="hidden" 
              />
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
            onClick={() => {
              if (confirm("End your shift? Passengers will no longer see your bus.")) {
                onStopTracking();
              }
            }}
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
    </div>
  );
}
