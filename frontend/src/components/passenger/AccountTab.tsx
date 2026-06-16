"use client";

import { useState } from "react";
import { User, LogOut, ChevronRight, LogIn, MessageSquare } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import FeedbackModal from "@/components/shared/FeedbackModal";

export default function AccountTab() {
  const { user, loginWithGoogle, logout } = useAuth();
  const [showFeedback, setShowFeedback] = useState(false);
  return (
    <div className="flex-1 overflow-y-auto bg-brand-dark p-8 flex flex-col items-center">
      <div className="w-full max-w-lg space-y-12 mt-12">
        {/* Profile Header */}
        <div className="flex flex-col items-center gap-6">
          <div className="w-28 h-28 rounded-[2.5rem] bg-brand-surface border border-white/5 flex items-center justify-center text-white/10 shadow-2xl relative overflow-hidden">
             <div className="absolute top-0 right-0 w-16 h-16 bg-white/5 blur-2xl" />
             {user?.photoURL ? (
               <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" />
             ) : (
               <User className="w-12 h-12 text-white/40" />
             )}
          </div>
          <div className="text-center">
            {user ? (
              <>
                <h2 className="text-3xl font-bold font-display tracking-tight text-white mb-1" style={{ fontFamily: "Outfit, sans-serif" }}>
                  {user.displayName || "Rider"}
                </h2>
                <div className="flex flex-col items-center">
                  <span className="text-xs font-black text-blue-400 uppercase tracking-[0.25em]">
                    {user.role?.toUpperCase() || "PASSENGER"}
                  </span>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-3xl font-bold font-display tracking-tight text-white mb-1" style={{ fontFamily: "Outfit, sans-serif" }}>
                  Guest Rider
                </h2>
                <span className="text-xs font-black text-white/20 uppercase tracking-[0.25em]">
                  UNVERIFIED
                </span>
              </>
            )}
          </div>
        </div>

        {/* Actions List - Refined Block */}
        <div className="bg-brand-surface border border-white/5 rounded-[2rem] overflow-hidden mt-8 shadow-3xl">
          <button
            onClick={() => setShowFeedback(true)}
            className="w-full flex items-center justify-between p-6 border-b border-white/5 bg-transparent hover:bg-white/5 transition-all group"
          >
            <div className="flex items-center gap-5">
              <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                  <MessageSquare className="w-5 h-5 text-white/60 group-hover:text-emerald-400" />
              </div>
              <span className="text-sm font-bold tracking-tight text-white/80 group-hover:text-white">Give Feedback</span>
            </div>
            <ChevronRight className="w-4 h-4 text-white/10 group-hover:text-white/40 transition-colors" />
          </button>

          {user ? (
            <button
              onClick={logout}
              className="w-full flex items-center justify-between p-6 bg-transparent hover:bg-white/5 transition-all group"
            >
              <div className="flex items-center gap-5">
                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-red-500/20 transition-colors">
                   <LogOut className="w-5 h-5 text-red-500/80" />
                </div>
                <span className="text-sm font-bold tracking-tight text-red-400">Log Out</span>
              </div>
              <ChevronRight className="w-4 h-4 text-white/10 group-hover:text-white/40 transition-colors" />
            </button>
          ) : (
            <button
              onClick={loginWithGoogle}
              className="w-full flex items-center justify-between p-6 bg-transparent hover:bg-[#0071e3]/20 transition-all group"
            >
              <div className="flex items-center gap-5">
                <div className="w-10 h-10 rounded-xl bg-[#0071e3]/20 flex items-center justify-center group-hover:bg-[#0071e3]/40 transition-colors">
                   <LogIn className="w-5 h-5 text-[#0071e3]" />
                </div>
                <span className="text-sm font-bold tracking-tight text-[#0071e3]">Sign in with Google</span>
              </div>
              <ChevronRight className="w-4 h-4 text-white/10 group-hover:text-white/40 transition-colors" />
            </button>
          )}
        </div>
        
        {showFeedback && (
          <FeedbackModal
            userId={user?.uid || "anonymous"}
            userName={user?.displayName || "Guest Rider"}
            onClose={() => setShowFeedback(false)}
          />
        )}
        
        {/* Version Info */}
        <p className="text-center text-[10px] text-white/10 font-bold uppercase tracking-widest pb-12">BusTrack v2.1.0 • Live</p>
      </div>
    </div>
  );
}
