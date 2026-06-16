"use client";

import { useState, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useDrivers } from "@/hooks/useDrivers";
import { db, storage } from "@/lib/firebase";
import { doc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { User, ClipboardList, Settings, LogOut, ChevronRight, Wrench, BadgeCheck, Camera, Loader2 } from "lucide-react";

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
      alert("Failed to upload photo. Please check your network connection.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-brand-dark p-8 flex flex-col items-center">
      <div className="w-full max-w-lg space-y-12 mt-12">
        {/* Profile Header */}
        <div className="flex flex-col items-center gap-6">
          <div 
            className="w-28 h-28 rounded-[2.5rem] bg-brand-surface border border-white/5 flex items-center justify-center text-white/10 shadow-3xl relative overflow-hidden group cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
             <div className="absolute top-0 left-0 w-16 h-16 bg-white/5 blur-2xl z-0" />
             
             {displayPhotoUrl ? (
               <img src={displayPhotoUrl} alt="Driver" className="w-full h-full object-cover z-10 relative" referrerPolicy="no-referrer" />
             ) : (
               <User className="w-12 h-12 text-white/40 z-10 relative" />
             )}

             <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm z-20">
                {isUploading ? <Loader2 className="w-6 h-6 text-white animate-spin" /> : <Camera className="w-6 h-6 text-white/80" />}
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
            <h2 className="text-3xl font-bold font-display tracking-tight text-white mb-2" style={{ fontFamily: "Outfit, sans-serif" }}>
              Driver {driverId.replace("drv_", "#")}
            </h2>
            <div className="flex items-center justify-center gap-2">
               <BadgeCheck className="w-3.5 h-3.5 text-blue-500" />
               <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">Authorized Operator</p>
            </div>
          </div>
        </div>

        {/* Current Shift Info - Refined Block */}
        <div className="bg-brand-surface border border-white/5 rounded-[2rem] p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 blur-[50px] pointer-events-none" />
          <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-white/20 mb-6 px-1">Assignment Metrics</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center bg-brand-dark/40 p-4 rounded-2xl border border-white/5">
              <span className="text-white/40 text-xs font-bold uppercase tracking-widest">Active Unit</span>
              <span className="font-black font-mono tracking-widest text-white/80">{busId}</span>
            </div>
            <div className="flex justify-between items-center bg-brand-dark/40 p-4 rounded-2xl border border-white/5">
              <span className="text-white/40 text-xs font-bold uppercase tracking-widest">Duty Status</span>
              <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                 <span className="w-2 h-2 rounded-full bg-emerald-500" />
                 <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Active</span>
              </div>
            </div>
          </div>
        </div>



        {/* Actions List - Deep Charcoal Mono */}
        <div className="bg-brand-surface border border-white/5 rounded-[2rem] overflow-hidden mt-8 shadow-3xl">
          <button
            aria-label="End shift and go offline"
            disabled={!isTracking}
            onClick={() => {
              if (confirm("End your shift and go offline? Passengers will no longer see your bus.")) {
                onStopTracking();
              }
            }}
            className={`w-full flex items-center justify-between p-6 bg-transparent transition-all group ${
              isTracking
                ? 'hover:bg-red-500/10 cursor-pointer'
                : 'opacity-40 cursor-not-allowed'
            }`}
          >
            <div className="flex items-center gap-5">
              <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-red-500/10 transition-colors">
                <LogOut className="w-5 h-5 text-red-400" />
              </div>
              <span className="text-sm font-bold tracking-tight text-red-400">
                {isTracking ? "End Shift" : "Not On Shift"}
              </span>
            </div>
            <ChevronRight className="w-4 h-4 text-white/10 group-hover:text-white/40 transition-colors" />
          </button>
        </div>
        
        <p className="text-center text-[10px] text-white/10 font-bold uppercase tracking-widest pb-12">Operator ID: {driverId.toUpperCase()}</p>
      </div>
    </div>
  );
}
